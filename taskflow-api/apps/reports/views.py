"""[업무보고] views.py - 보고서/경비지출 API View.

역할: 보고서 CRUD, 제출/확인/보완/취소, 경비 검토/승인/반려, 기간별 집계 처리
관련 모델: Report, ExpenseItem, ExpenseReceipt, ReportFile
관련 URL: /api/reports/
작성기준: DRF Generic/APIView 기반, JWT 인증 필수
"""

from datetime import datetime, timedelta
from uuid import uuid4

from django.http import FileResponse, HttpResponse
from django.db.models import Count, Q, Sum
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.views import APIView

from apps.common.responses import success_response
from apps.media_files.models import AsyncTaskLog
from apps.media_files.serializers import AsyncTaskLogSerializer
from apps.notifications.models import Notification
from apps.notifications.services import create_notification

from .models import ExpenseItem, ExpenseReceipt, Report, ReportFile, ReportRecipient
from .serializers import (
    ExpenseItemSerializer,
    ExpenseReceiptSerializer,
    ReportCancelSerializer,
    ReportCreateUpdateSerializer,
    ReportDetailSerializer,
    ReportFileSerializer,
    ReportListSerializer,
    ReportReturnSerializer,
)


class ReportQuerysetMixin:
    """보고서 API에서 공통으로 사용하는 권한/조회 보조 기능.

    대표이사/관리자는 전체 보고서를 조회하고, 일반 사용자는 작성자(writer),
    승인자(approver), 수신자인 보고서만 접근합니다. 이 믹스인은 각 View가 같은
    접근 규칙을 반복 구현하지 않도록 관련 보고서만 필터링하고, 상태 변경 API에서
    필요한 역할 검사를 제공합니다.
    """

    permission_classes = [permissions.IsAuthenticated]

    def related_queryset(self):
        """역할에 따라 접근 가능한 보고서 범위를 반환합니다."""
        user = self.request.user
        role = getattr(user, "role", "")
        if role in {"CEO", "ADMIN", "SUPERUSER"}:
            return Report.objects.all()
        return Report.objects.filter(Q(writer=user) | Q(approver=user) | Q(recipients=user) | Q(recipient_records__recipient=user)).distinct()

    def summary_queryset(self):
        """기간 집계용 보고서 조회 범위를 반환합니다.

        CEO/ADMIN은 전체 보고서를 집계하고, 일반 사용자는 본인이 작성한 보고서만
        집계합니다. 경비지출은 별도 summary가 있으므로 일반 보고만 포함합니다.
        """
        role = getattr(self.request.user, "role", "")
        qs = Report.objects.exclude(report_type=Report.ReportType.EXPENSE_REPORT)
        if role in {"CEO", "ADMIN"}:
            return qs
        return qs.filter(writer=self.request.user)

    def get_report(self, pk):
        """권한 범위 안에서만 단건 보고서를 찾습니다.

        존재하는 보고서라도 작성자/승인자가 아니면 404처럼 보이게 처리되어
        다른 사용자의 보고서 ID를 추측하는 상황을 줄입니다.
        """
        return generics.get_object_or_404(self.related_queryset(), pk=pk)

    def ensure_writer(self, report):
        """작성자 전용 동작인지 확인합니다.

        수정, 삭제, 제출, 취소, 경비 항목 등록은 작성자의 업무 흐름에 속합니다.
        """
        if report.writer != self.request.user:
            raise PermissionDenied("작성자만 처리할 수 있습니다.")

    def ensure_writer_action_allowed(self):
        role = getattr(self.request.user, "role", "")
        if role in {"CEO", "SUPERUSER"}:
            raise PermissionDenied("대표이사는 작성/수정/제출할 수 없습니다.")

    def ensure_approver(self, report):
        """승인자 전용 동작인지 확인합니다.

        확인완료, 보완요청, 경비 검토/승인/반려는 approver에게만 허용됩니다.
        """
        role = getattr(self.request.user, "role", "")
        if report.writer == self.request.user:
            raise PermissionDenied("본인 보고서는 확인완료/보완요청할 수 없습니다.")
        if (
            report.approver != self.request.user
            and not report.recipients.filter(pk=self.request.user.pk).exists()
            and not report.recipient_records.filter(recipient=self.request.user).exists()
            and role not in {"CEO", "SUPERUSER"}
        ):
            raise PermissionDenied("상급자/확인자만 처리할 수 있습니다.")

    def recipient_record(self, report):
        """현재 사용자 수신 기록을 반환하고 CEO는 작성자 외 첫 수신 기록을 대리 처리합니다."""
        record = report.recipient_records.filter(recipient=self.request.user).first()
        if record:
            return record
        role = getattr(self.request.user, "role", "")
        if role in {"CEO", "SUPERUSER"}:
            return report.recipient_records.first()
        return None

    def ensure_expense(self, report):
        """경비지출 보고서에서만 사용할 수 있는 API인지 확인합니다."""
        if not report.is_expense:
            raise ValidationError("경비지출 보고에서만 사용할 수 있는 기능입니다.")

    def ensure_recipient_records(self, report):
        """확인자/수신자 관계와 수신자별 상태 기록을 맞춥니다."""
        recipients = list(report.recipients.all())
        if report.approver and report.approver not in recipients:
            recipients.append(report.approver)
            report.recipients.add(report.approver)
        for recipient in recipients:
            ReportRecipient.objects.get_or_create(report=report, recipient=recipient)

    def recalculate_total(self, report):
        """경비 항목 합계를 다시 계산해 보고서 총액에 반영합니다.

        클라이언트가 total_amount를 직접 믿고 보내면 항목 합계와 어긋날 수 있으므로,
        ExpenseItem 생성/수정/삭제 뒤에는 서버가 항상 실제 항목 합계를 기준으로
        Report.total_amount를 갱신합니다.
        """
        total = report.expense_items.aggregate(total=Sum("amount"))["total"] or 0
        report.total_amount = total
        report.save(update_fields=["total_amount"])


class ReportListCreateView(ReportQuerysetMixin, generics.ListCreateAPIView):
    """보고서 목록 조회와 신규 보고서 생성을 처리합니다.

    GET은 로그인 사용자가 작성자 또는 승인자인 보고서 목록만 반환합니다.
    POST는 요청 사용자를 writer로 고정하고, 본문에 포함된 expense_items가 있으면
    보고서 생성과 함께 경비 항목도 같이 생성합니다.
    """

    search_fields = ["title", "content"]
    filterset_fields = ["status", "report_type"]
    ordering_fields = ["report_date", "created_at", "total_amount"]

    def get_queryset(self):
        qs = self.related_queryset()
        role = getattr(self.request.user, "role", "")
        if role not in {"CEO", "ADMIN", "SUPERUSER"}:
            qs = qs.exclude(Q(status=Report.ReportStatus.DRAFT) & ~Q(writer=self.request.user))
            qs = qs.exclude(Q(status=Report.ReportStatus.CANCELED) & ~Q(writer=self.request.user))
        writer_id = self.request.query_params.get("writer")
        department = self.request.query_params.get("department")
        if writer_id and writer_id.isdigit() and role in {"CEO", "ADMIN", "SUPERUSER"}:
            qs = qs.filter(writer_id=writer_id)
        if department and role in {"CEO", "ADMIN", "SUPERUSER"}:
            qs = qs.filter(writer__department=department)
        return qs

    def get_serializer_class(self):
        return ReportCreateUpdateSerializer if self.request.method == "POST" else ReportListSerializer

    def perform_create(self, serializer):
        self.ensure_writer_action_allowed()
        requested_type = self.request.data.get("report_type")
        report_type = Report.ReportType.EXPENSE_REPORT if requested_type == Report.ReportType.EXPENSE_REPORT else Report.ReportType.WORK_REPORT
        serializer.save(report_type=report_type)


def parse_summary_date(value):
    """YYYY-MM-DD 문자열을 date로 변환합니다.

    Args:
        value: 쿼리 파라미터 date 값
    Returns:
        date 객체
    """
    if not value:
        return timezone.localdate()
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValidationError("date는 YYYY-MM-DD 형식이어야 합니다.") from exc


def summary_query_range(query_params, unit):
    """요약 조회 범위를 계산합니다.

    start_date/end_date가 있으면 해당 기간을 우선 사용하고, 없으면 기존 date+unit
    방식으로 기간을 계산합니다.
    """
    start_value = query_params.get("start_date")
    end_value = query_params.get("end_date")
    if start_value or end_value:
        start_date = parse_summary_date(start_value)
        end_date = parse_summary_date(end_value)
        if start_date > end_date:
            raise ValidationError("start_date는 end_date보다 늦을 수 없습니다.")
        label = start_date.isoformat() if start_date == end_date else f"{start_date.isoformat()} ~ {end_date.isoformat()}"
        return start_date, end_date, label

    base_date = parse_summary_date(query_params.get("date"))
    return summary_range(unit, base_date)


def summary_range(unit, base_date):
    """집계 단위별 시작일/종료일과 응답용 날짜 라벨을 계산합니다.

    Args:
        unit: year, month, day 중 하나
        base_date: 기준일
    Returns:
        (start_date, end_date, label) 튜플
    """
    if unit == "year":
        return base_date.replace(month=1, day=1), base_date.replace(month=12, day=31), f"{base_date.year}"
    if unit == "month":
        start = base_date.replace(day=1)
        next_month = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
        return start, next_month - timedelta(days=1), base_date.strftime("%Y-%m")
    if unit == "day":
        return base_date, base_date, base_date.isoformat()
    raise ValidationError("unit은 year, month, day 중 하나여야 합니다.")


class ReportSummaryView(ReportQuerysetMixin, APIView):
    """기간별 업무보고 집계 API.

    GET /api/reports/summary/?start_date=2026-06-01&end_date=2026-06-30 형식으로 호출하며,
    DRAFT/CANCELED 상태는 집계 대상에서 제외합니다.
    """

    def get(self, request):
        unit = request.query_params.get("unit", "month")
        start_date, end_date, label = summary_query_range(request.query_params, unit)
        qs = self.summary_queryset().filter(report_date__range=[start_date, end_date]).exclude(
            status__in=[Report.ReportStatus.DRAFT, Report.ReportStatus.CANCELED],
        )
        counts = qs.aggregate(
            total_count=Count("id"),
            submitted_count=Count("id", filter=Q(status=Report.ReportStatus.SUBMITTED)),
            confirmed_count=Count("id", filter=Q(status=Report.ReportStatus.CONFIRMED)),
            returned_count=Count("id", filter=Q(status=Report.ReportStatus.RETURNED)),
            canceled_count=Count("id", filter=Q(status=Report.ReportStatus.CANCELED)),
        )
        return success_response(
            {
                "unit": unit,
                "date": label,
                "total_count": counts["total_count"] or 0,
                "submitted_count": counts["submitted_count"] or 0,
                "confirmed_count": counts["confirmed_count"] or 0,
                "returned_count": counts["returned_count"] or 0,
                "canceled_count": counts["canceled_count"] or 0,
            },
            "보고서 기간 집계를 조회했습니다.",
        )


class ReportDetailUpdateDeleteView(ReportQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """보고서 상세 조회, 수정, 삭제 API.

    수정은 작성자만 가능하고, 아직 제출 전이거나 보완/반려되어 다시 작성해야 하는
    상태에서만 허용합니다. 이미 확인/승인된 보고서는 이 API로 내용을 바꾸지 못합니다.
    """

    def get_queryset(self):
        return self.related_queryset()

    def get_serializer_class(self):
        if self.request.method in {"PATCH", "PUT"}:
            return ReportCreateUpdateSerializer
        return ReportDetailSerializer

    def retrieve(self, request, *args, **kwargs):
        report = self.get_object()
        self.ensure_recipient_records(report)
        record = report.recipient_records.filter(recipient=request.user).first()
        if record and not record.is_read:
            record.is_read = True
            record.read_at = timezone.now()
            record.save(update_fields=["is_read", "read_at"])
        if report.writer != request.user and not report.viewed_at:
            report.viewed_at = timezone.now()
            report.save(update_fields=["viewed_at"])
        return success_response(self.get_serializer(report).data)

    def can_update_report(self, report):
        """작성자가 수정 가능한 상태인지 확인합니다."""
        editable_statuses = {
            Report.ReportStatus.DRAFT,
            Report.ReportStatus.RETURNED,
            Report.ExpenseStatus.REJECTED,
        }
        if report.status in editable_statuses:
            return True
        if report.status == Report.ReportStatus.SUBMITTED:
            return not report.recipient_records.filter(is_read=True).exists()
        return False

    def perform_update(self, serializer):
        report = self.get_object()
        self.ensure_writer_action_allowed()
        self.ensure_writer(report)
        if not self.can_update_report(report):
            raise ValidationError("수신자가 읽은 보고서는 수정할 수 없습니다.")
        serializer.save()

    def perform_destroy(self, instance):
        role = getattr(self.request.user, "role", "")
        if role not in {"CEO", "SUPERUSER"}:
            self.ensure_writer(instance)
        instance.delete()


class ReportSubmitView(ReportQuerysetMixin, APIView):
    """업무보고 제출 API.

    지원 액션:
      - POST/PATCH /api/reports/{id}/submit/

    권한:
      - 작성자만 제출 가능
      - 대표이사/SUPERUSER는 작성자 액션 수행 불가
    """

    @extend_schema(
        tags=["📝 업무보고"],
        summary="업무보고 제출",
        description="""
        임시저장 또는 보완요청 상태의 업무보고를 제출합니다.
        - 제출 시 status=SUBMITTED
        - 수신자별 ReportRecipient 기록 생성
        - 수신자에게 보고서 제출 알림 발송
        """,
        responses={200: ReportDetailSerializer, 403: None, 404: None},
    )
    def post(self, request, pk):
        """업무보고 제출 처리.

        Args:
            request: JWT 인증된 HTTP 요청 객체
            pk: 제출할 보고서 ID

        Returns:
            200: 제출 성공 및 보고서 상세 데이터
            403: 작성자가 아니거나 대표이사 작성 액션인 경우
            404: 접근 가능한 보고서 없음
        """
        report = self.get_report(pk)
        self.ensure_writer_action_allowed()
        self.ensure_writer(report)
        # 제출 시각은 수신자 대기 시간과 목록 이력 표시 기준으로 사용합니다.
        report.status = Report.ReportStatus.SUBMITTED
        report.submitted_at = timezone.now()
        report.save(update_fields=["status", "submitted_at"])
        # 기존 ManyToMany 수신자와 수신자별 열람 추적 테이블을 동기화합니다.
        for recipient in report.recipients.all():
            ReportRecipient.objects.get_or_create(report=report, recipient=recipient)
        # 제출 이벤트는 수신자의 알림 목록과 실시간 알림 흐름에서 사용됩니다.
        for recipient in report.recipients.all():
            create_notification(recipient, Notification.Type.REPORT, "보고서가 제출되었습니다.", report.title, "REPORT", report.id)
        return success_response(ReportDetailSerializer(report).data, "보고서를 제출했습니다.")

    patch = post


class ReportConfirmView(ReportQuerysetMixin, APIView):
    """수신자가 업무보고를 확인완료 처리하는 API."""

    @extend_schema(
        tags=["📝 업무보고"],
        summary="업무보고 확인완료",
        description="""
        수신자가 제출된 업무보고를 확인완료 처리합니다.
        - 수신자별 confirmed_at 저장
        - 모든 수신자가 확인완료하면 보고서 status=CONFIRMED
        - 작성자는 본인 보고서를 확인완료 처리할 수 없음
        """,
        responses={200: ReportDetailSerializer, 403: None, 404: None},
    )
    def post(self, request, pk):
        """업무보고 확인완료 처리.

        Args:
            request: JWT 인증된 HTTP 요청 객체
            pk: 확인완료 처리할 보고서 ID

        Returns:
            200: 수신자 확인 상태가 반영된 보고서 상세 데이터
            403: 수신자/대표이사가 아니거나 작성자 본인인 경우
            404: 접근 가능한 보고서 없음
        """
        report = self.get_report(pk)
        self.ensure_approver(report)
        if report.is_expense:
            raise ValidationError("경비지출은 승인 API를 사용해주세요.")
        record = self.recipient_record(report)
        now = timezone.now()
        if record:
            record.confirmed_at = now
            record.returned_at = None
            record.return_reason = ""
            record.save(update_fields=["confirmed_at", "returned_at", "return_reason"])
        if not report.recipient_records.filter(confirmed_at__isnull=True).exists():
            report.status = Report.ReportStatus.CONFIRMED
            report.confirmed_at = now
            report.save(update_fields=["status", "confirmed_at"])
        create_notification(report.writer, Notification.Type.REPORT, "보고서가 확인완료되었습니다.", report.title, "REPORT", report.id)
        return success_response(ReportDetailSerializer(report).data, "보고서를 확인완료 처리했습니다.")

    patch = post


class ReportReturnView(ReportQuerysetMixin, APIView):
    """수신자가 업무보고에 보완요청 사유를 남기는 API."""

    @extend_schema(
        tags=["📝 업무보고"],
        summary="업무보고 보완요청",
        description="""
        수신자가 업무보고에 보완요청을 남깁니다.
        - 사유(reason)는 필수
        - 수신자별 returned_at/return_reason 저장
        - 수신자 1명이라도 보완요청하면 보고서 status=RETURNED
        """,
        responses={200: ReportDetailSerializer, 400: None, 403: None, 404: None},
    )
    def post(self, request, pk):
        """업무보고 보완요청 처리.

        Args:
            request: reason 필드를 포함한 JWT 인증 HTTP 요청 객체
            pk: 보완요청할 보고서 ID

        Returns:
            200: 보완요청 상태가 반영된 보고서 상세 데이터
            400: reason 누락 또는 경비지출 보고서인 경우
            403: 수신자/대표이사가 아니거나 작성자 본인인 경우
            404: 접근 가능한 보고서 없음
        """
        report = self.get_report(pk)
        self.ensure_approver(report)
        if report.is_expense:
            raise ValidationError("경비지출은 반려 API를 사용해주세요.")
        serializer = ReportReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        record = self.recipient_record(report)
        now = timezone.now()
        if record:
            record.returned_at = now
            record.return_reason = serializer.validated_data["reason"]
            record.save(update_fields=["returned_at", "return_reason"])
        report.status = Report.ReportStatus.RETURNED
        report.returned_at = now
        report.rejected_reason = serializer.validated_data["reason"]
        report.save(update_fields=["status", "returned_at", "rejected_reason"])
        create_notification(report.writer, Notification.Type.REPORT, "보고서 보완요청이 도착했습니다.", report.rejected_reason, "REPORT", report.id)
        return success_response(ReportDetailSerializer(report).data, "보완요청을 보냈습니다.")

    patch = post


class ReportResubmitView(ReportQuerysetMixin, APIView):
    """작성자가 보완요청 보고서를 재제출하고 수신자 상태를 초기화합니다."""

    @extend_schema(
        tags=["📝 업무보고"],
        summary="업무보고 재제출",
        description="""
        RETURNED 상태의 업무보고를 재제출합니다.
        - status=SUBMITTED로 변경
        - 모든 수신자 읽음/확인/보완요청 상태 초기화
        - 작성자만 가능
        """,
        responses={200: ReportDetailSerializer, 400: None, 403: None, 404: None},
    )
    def post(self, request, pk):
        """업무보고 재제출 처리.

        Args:
            request: JWT 인증된 HTTP 요청 객체
            pk: 재제출할 보고서 ID

        Returns:
            200: 재제출 성공 및 초기화된 수신자 상태
            400: RETURNED 상태가 아닌 경우
            403: 작성자가 아니거나 대표이사 작성 액션인 경우
            404: 접근 가능한 보고서 없음
        """
        report = self.get_report(pk)
        self.ensure_writer_action_allowed()
        self.ensure_writer(report)
        if report.status != Report.ReportStatus.RETURNED:
            raise ValidationError("보완요청 상태에서만 재제출할 수 있습니다.")
        report.status = Report.ReportStatus.SUBMITTED
        report.submitted_at = timezone.now()
        report.viewed_at = None
        report.confirmed_at = None
        report.returned_at = None
        report.rejected_reason = ""
        report.save(update_fields=["status", "submitted_at", "viewed_at", "confirmed_at", "returned_at", "rejected_reason"])
        report.recipient_records.update(
            is_read=False,
            read_at=None,
            confirmed_at=None,
            returned_at=None,
            return_reason="",
        )
        return success_response(ReportDetailSerializer(report).data, "보고서를 재제출했습니다.")

    patch = post


class ExpenseReviewView(ReportQuerysetMixin, APIView):
    """기존 검토중 API를 정산중 전환으로 호환 처리합니다."""

    def patch(self, request, pk):
        report = self.get_report(pk)
        self.ensure_approver(report)
        self.ensure_expense(report)
        if report.status != Report.ExpenseStatus.APPROVED:
            raise ValidationError("승인 상태의 경비지출만 정산중으로 변경할 수 있습니다.")
        report.status = Report.ExpenseStatus.SETTLING
        report.save(update_fields=["status"])
        create_notification(report.writer, Notification.Type.EXPENSE, "경비지출 보고가 정산중입니다.", report.title, "REPORT", report.id)
        return success_response(ReportDetailSerializer(report).data, "경비지출 보고를 정산중으로 변경했습니다.")


class ExpenseApproveView(ReportQuerysetMixin, APIView):
    """경비지출 보고서를 승인 처리합니다."""

    def patch(self, request, pk):
        report = self.get_report(pk)
        self.ensure_approver(report)
        self.ensure_expense(report)
        if report.status != Report.ExpenseStatus.SUBMITTED:
            raise ValidationError("제출 상태의 경비지출만 승인할 수 있습니다.")
        report.status = Report.ExpenseStatus.APPROVED
        report.approved_at = timezone.now()
        report.save(update_fields=["status", "approved_at"])
        create_notification(report.writer, Notification.Type.EXPENSE, "경비지출 보고가 승인되었습니다.", report.title, "REPORT", report.id)
        return success_response(ReportDetailSerializer(report).data, "경비지출 보고를 승인했습니다.")


class ExpenseRejectView(ReportQuerysetMixin, APIView):
    """경비지출 보고서를 반려하고 사유를 저장합니다."""

    def patch(self, request, pk):
        report = self.get_report(pk)
        self.ensure_approver(report)
        self.ensure_expense(report)
        if report.status != Report.ExpenseStatus.SUBMITTED:
            raise ValidationError("제출 상태의 경비지출만 반려할 수 있습니다.")
        serializer = ReportReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        report.status = Report.ExpenseStatus.REJECTED
        report.rejected_at = timezone.now()
        report.rejected_reason = serializer.validated_data["reason"]
        report.save(update_fields=["status", "rejected_at", "rejected_reason"])
        create_notification(report.writer, Notification.Type.EXPENSE, "경비지출 보고가 반려되었습니다.", report.rejected_reason, "REPORT", report.id)
        return success_response(ReportDetailSerializer(report).data, "경비지출 보고를 반려했습니다.")


class ExpenseSettleView(ReportQuerysetMixin, APIView):
    """승인된 경비지출 보고서를 정산중 상태로 변경합니다."""

    def patch(self, request, pk):
        report = self.get_report(pk)
        self.ensure_approver(report)
        self.ensure_expense(report)
        if report.status != Report.ExpenseStatus.APPROVED:
            raise ValidationError("승인 상태의 경비지출만 정산중으로 변경할 수 있습니다.")
        report.status = Report.ExpenseStatus.SETTLING
        report.save(update_fields=["status"])
        create_notification(report.writer, Notification.Type.EXPENSE, "경비지출 보고가 정산중입니다.", report.title, "REPORT", report.id)
        return success_response(ReportDetailSerializer(report).data, "경비지출 보고를 정산중으로 변경했습니다.")


class ExpenseSettleCompleteView(ReportQuerysetMixin, APIView):
    """정산중 경비지출 보고서를 정산완료 상태로 변경합니다."""

    def patch(self, request, pk):
        report = self.get_report(pk)
        self.ensure_approver(report)
        self.ensure_expense(report)
        if report.status not in {Report.ExpenseStatus.SETTLING, Report.ExpenseStatus.REVIEWING}:
            raise ValidationError("정산중 상태의 경비지출만 정산완료로 변경할 수 있습니다.")
        report.status = Report.ExpenseStatus.SETTLED
        report.confirmed_at = timezone.now()
        report.save(update_fields=["status", "confirmed_at"])
        create_notification(report.writer, Notification.Type.EXPENSE, "경비지출 보고가 정산완료되었습니다.", report.title, "REPORT", report.id)
        return success_response(ReportDetailSerializer(report).data, "경비지출 보고를 정산완료로 변경했습니다.")


class ReportCancelView(ReportQuerysetMixin, APIView):
    """작성자가 보고서를 취소 상태로 변경합니다.

    일반 보고와 경비지출 보고는 상태 선택지가 다르므로 report_type을 기준으로
    CANCELED 값을 각각의 상태 그룹에서 선택합니다.
    """

    def patch(self, request, pk):
        report = self.get_report(pk)
        self.ensure_writer_action_allowed()
        self.ensure_writer(report)
        serializer = ReportCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if report.status != Report.ReportStatus.SUBMITTED:
            raise ValidationError("제출 상태의 보고서만 취소할 수 있습니다.")
        if report.recipient_records.filter(is_read=True).exists():
            raise ValidationError("수신자가 읽은 보고서는 취소할 수 없습니다.")
        report.status = Report.ExpenseStatus.CANCELED if report.is_expense else Report.ReportStatus.CANCELED
        report.save(update_fields=["status"])
        return success_response(ReportDetailSerializer(report).data, "보고서를 취소했습니다.")


class MyCreatedReportView(ReportQuerysetMixin, generics.ListAPIView):
    """내가 작성한 보고서만 조회합니다."""

    serializer_class = ReportListSerializer

    def get_queryset(self):
        return Report.objects.filter(writer=self.request.user)


class MyApprovalReportView(ReportQuerysetMixin, generics.ListAPIView):
    """내가 승인자로 지정된 보고서만 조회합니다."""

    serializer_class = ReportListSerializer

    def get_queryset(self):
        return Report.objects.filter(approver=self.request.user)


class ReportTypeListView(ReportQuerysetMixin, generics.ListAPIView):
    """보고서 유형별 목록 API의 공통 부모 클래스."""

    serializer_class = ReportListSerializer
    search_fields = ["title", "content", "writer__username", "approver__username"]
    filterset_fields = ["status"]
    report_type = None

    def get_queryset(self):
        qs = self.related_queryset().filter(report_type=self.report_type)
        role = getattr(self.request.user, "role", "")
        if role not in {"CEO", "SUPERUSER"}:
            qs = qs.exclude(Q(status=Report.ReportStatus.DRAFT) & ~Q(writer=self.request.user))
            qs = qs.exclude(Q(status=Report.ReportStatus.CANCELED) & ~Q(writer=self.request.user))
        start_date = self.request.query_params.get("start_date")
        end_date = self.request.query_params.get("end_date")
        if start_date:
            qs = qs.filter(report_date__gte=start_date)
        if end_date:
            qs = qs.filter(report_date__lte=end_date)
        return qs


class WorkReportAliasListView(ReportTypeListView):
    report_type = Report.ReportType.WORK_REPORT


class WorkReportListView(ReportTypeListView):
    report_type = Report.ReportType.WORK_REPORT


class ExpenseReportListView(ReportTypeListView):
    report_type = Report.ReportType.EXPENSE_REPORT


class ExpenseSummaryView(ReportQuerysetMixin, APIView):
    """경비지출 기간별 총액 요약 API."""

    def get(self, request):
        unit = request.query_params.get("unit", "month")
        start_date, end_date, label = summary_query_range(request.query_params, unit)
        qs = self.related_queryset().filter(
            report_type=Report.ReportType.EXPENSE_REPORT,
            report_date__range=[start_date, end_date],
        ).exclude(status=Report.ExpenseStatus.CANCELED)
        summary = qs.aggregate(total_amount=Sum("total_amount"), total_count=Count("id"))
        return success_response(
            {
                "unit": unit,
                "date": label,
                "total_amount": summary["total_amount"] or 0,
                "total_count": summary["total_count"] or 0,
            },
            "경비지출 요약을 조회했습니다.",
        )


class ExpenseBulkStatusView(ReportQuerysetMixin, APIView):
    """승인권자가 여러 경비지출 보고서 상태를 일괄 처리합니다."""

    transition_rules = {
        Report.ExpenseStatus.APPROVED: {Report.ExpenseStatus.SUBMITTED},
        Report.ExpenseStatus.REJECTED: {Report.ExpenseStatus.SUBMITTED},
        Report.ExpenseStatus.SETTLING: {Report.ExpenseStatus.APPROVED},
        Report.ExpenseStatus.SETTLED: {Report.ExpenseStatus.SETTLING, Report.ExpenseStatus.REVIEWING},
    }

    def patch(self, request):
        role = getattr(request.user, "role", "")

        ids = request.data.get("ids", [])
        next_status = request.data.get("status")
        reason = request.data.get("reason", "")
        if next_status not in self.transition_rules:
            raise ValidationError("지원하지 않는 경비지출 상태입니다.")
        if not isinstance(ids, list) or not ids:
            raise ValidationError("처리할 경비보고서를 선택해주세요.")

        qs = self.related_queryset().filter(id__in=ids, report_type=Report.ReportType.EXPENSE_REPORT)
        if role not in {"CEO", "SUPERUSER"}:
            qs = qs.filter(Q(approver=request.user) | Q(recipients=request.user) | Q(recipient_records__recipient=request.user)).exclude(writer=request.user).distinct()
        if qs.count() != len(set(ids)):
            raise PermissionDenied("선택한 경비지출 중 처리 권한이 없는 항목이 있습니다.")
        invalid = qs.exclude(status__in=self.transition_rules[next_status]).exists()
        if invalid:
            raise ValidationError("현재 상태에서 선택한 상태로 변경할 수 없는 항목이 있습니다.")

        now = timezone.now()
        update_fields = {"status": next_status}
        if next_status == Report.ExpenseStatus.APPROVED:
            update_fields["approved_at"] = now
        elif next_status == Report.ExpenseStatus.REJECTED:
            update_fields["rejected_at"] = now
            update_fields["rejected_reason"] = reason
        elif next_status == Report.ExpenseStatus.SETTLED:
            update_fields["confirmed_at"] = now
        updated = qs.update(**update_fields)
        return success_response({"updated_count": updated}, "경비지출 상태를 일괄 처리했습니다.")


class ExpenseItemListCreateView(ReportQuerysetMixin, generics.ListCreateAPIView):
    """경비지출 보고서의 경비 항목 목록/생성 API."""

    serializer_class = ExpenseItemSerializer

    def get_queryset(self):
        report = self.get_report(self.kwargs["pk"])
        self.ensure_expense(report)
        return ExpenseItem.objects.filter(report=report)

    def perform_create(self, serializer):
        report = self.get_report(self.kwargs["pk"])
        self.ensure_writer(report)
        self.ensure_expense(report)
        item = serializer.save(report=report)
        # 항목 추가 즉시 총액을 다시 계산해서 목록/상세 화면의 금액을 일관되게 유지합니다.
        self.recalculate_total(report)
        return item


class ExpenseItemDetailView(ReportQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """경비 항목 단건 수정/삭제 API."""

    serializer_class = ExpenseItemSerializer
    lookup_url_kwarg = "item_id"

    def get_queryset(self):
        return ExpenseItem.objects.filter(report__writer=self.request.user)

    def perform_update(self, serializer):
        item = serializer.save()
        self.recalculate_total(item.report)

    def perform_destroy(self, instance):
        report = instance.report
        instance.delete()
        self.recalculate_total(report)


class ExpenseReceiptListCreateView(ReportQuerysetMixin, generics.ListCreateAPIView):
    """경비 항목에 영수증 파일을 연결합니다.

    클라이언트는 먼저 /api/media/files/로 파일을 업로드해 MediaFile ID를 얻고,
    이 API에 media_file ID를 전달합니다. 서버는 ExpenseReceipt 연결 레코드를 만들고
    대표 영수증이 비어 있으면 ExpenseItem.receipt_file에도 같은 파일을 지정합니다.
    """

    serializer_class = ExpenseReceiptSerializer

    def get_queryset(self):
        item = generics.get_object_or_404(ExpenseItem, pk=self.kwargs["item_id"], report__writer=self.request.user)
        return ExpenseReceipt.objects.filter(expense_item=item)

    def perform_create(self, serializer):
        item = generics.get_object_or_404(ExpenseItem, pk=self.kwargs["item_id"], report__writer=self.request.user)
        receipt = serializer.save(expense_item=item, uploaded_by=self.request.user)
        if not item.receipt_file_id:
            # 첫 번째 영수증은 목록에서 바로 보여줄 대표 파일로도 사용합니다.
            item.receipt_file = receipt.media_file
            item.save(update_fields=["receipt_file"])


class ExpenseReceiptDetailView(ReportQuerysetMixin, generics.RetrieveDestroyAPIView):
    """영수증 연결 정보 조회/삭제 API."""

    serializer_class = ExpenseReceiptSerializer
    lookup_url_kwarg = "receipt_id"

    def get_queryset(self):
        user = self.request.user
        return ExpenseReceipt.objects.filter(
            Q(expense_item__report__writer=user) | Q(expense_item__report__approver=user),
        ).distinct()

    def perform_destroy(self, instance):
        if instance.uploaded_by != self.request.user and instance.expense_item.report.writer != self.request.user:
            raise PermissionDenied("업로드한 사용자 또는 작성자만 삭제할 수 있습니다.")
        instance.delete()


class ExpenseReceiptDownloadView(ReportQuerysetMixin, APIView):
    """권한이 있는 사용자가 영수증 원본 파일을 다운로드합니다."""

    def get(self, request, receipt_id):
        user = request.user
        receipt = generics.get_object_or_404(
            ExpenseReceipt.objects.filter(
                Q(expense_item__report__writer=user) | Q(expense_item__report__approver=user),
            ).distinct(),
            pk=receipt_id,
        )
        media = receipt.media_file
        return FileResponse(media.file.open("rb"), as_attachment=True, filename=media.original_name)


class ReportFileListCreateView(ReportQuerysetMixin, generics.ListCreateAPIView):
    """보고서 일반 첨부파일 목록/연결 API."""

    serializer_class = ReportFileSerializer

    def get_queryset(self):
        report = self.get_report(self.kwargs["pk"])
        return ReportFile.objects.filter(report=report)

    def perform_create(self, serializer):
        report = self.get_report(self.kwargs["pk"])
        self.ensure_writer(report)
        serializer.save(report=report, uploaded_by=self.request.user)


class ReportFileDetailView(ReportQuerysetMixin, generics.RetrieveDestroyAPIView):
    """보고서 첨부파일 연결 정보 조회/삭제 API."""

    serializer_class = ReportFileSerializer
    lookup_url_kwarg = "file_id"

    def get_queryset(self):
        user = self.request.user
        return ReportFile.objects.filter(Q(report__writer=user) | Q(report__approver=user)).distinct()

    def perform_destroy(self, instance):
        if instance.uploaded_by != self.request.user and instance.report.writer != self.request.user:
            raise PermissionDenied("업로드한 사용자 또는 작성자만 삭제할 수 있습니다.")
        instance.delete()


class ReportFileDownloadView(ReportQuerysetMixin, APIView):
    """보고서 첨부파일의 실제 파일 스트림을 반환합니다."""

    def get(self, request, file_id):
        user = request.user
        report_file = generics.get_object_or_404(
            ReportFile.objects.filter(Q(report__writer=user) | Q(report__approver=user)).distinct(),
            pk=file_id,
        )
        media = report_file.media_file
        return FileResponse(media.file.open("rb"), as_attachment=True, filename=media.original_name)


class ReportAsyncGenerateView(ReportQuerysetMixin, APIView):
    """PDF/Excel 생성 요청을 비동기 작업 로그로 접수하는 공통 API.

    현재 API는 작업 ID와 PENDING 상태를 먼저 반환합니다. 실제 파일 생성은 Celery 작업이
    task_id를 기준으로 이어받는 구조를 염두에 둔 진입점입니다.
    """

    task_type = None
    message = "작업이 접수되었습니다."

    def post(self, request, pk):
        self.get_report(pk)
        task = AsyncTaskLog.objects.create(
            task_id=uuid4().hex,
            task_type=self.task_type,
            status=AsyncTaskLog.Status.PENDING,
        )
        return success_response(AsyncTaskLogSerializer(task).data, self.message, status.HTTP_202_ACCEPTED)


class ReportPdfGenerateView(ReportAsyncGenerateView):
    task_type = AsyncTaskLog.TaskType.PDF_GENERATE
    message = "보고서 PDF 생성 작업이 접수되었습니다."


class ExpenseExcelGenerateView(ReportAsyncGenerateView):
    task_type = AsyncTaskLog.TaskType.EXCEL_GENERATE
    message = "경비 Excel 생성 작업이 접수되었습니다."


class ReportPdfDownloadView(ReportQuerysetMixin, APIView):
    """보고서 내용을 즉시 PDF로 만들어 다운로드합니다.

    간단한 서버 사이드 생성 방식입니다. reportlab이 설치되어 있어야 하며, 생성된 PDF는
    디스크에 저장하지 않고 BytesIO에 만든 뒤 바로 HTTP 응답으로 내려보냅니다.
    """

    def get(self, request, pk):
        report = self.get_report(pk)
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.pdfgen import canvas
        except ImportError as exc:
            raise ValidationError("PDF 다운로드 라이브러리가 설치되어 있지 않습니다.") from exc

        from io import BytesIO

        buffer = BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=A4)
        _, height = A4
        y = height - 72
        lines = [
            f"TaskFlow Report #{report.id}",
            f"Title: {report.title}",
            f"Type: {report.report_type}",
            f"Status: {report.status}",
            f"Report Date: {report.report_date}",
            f"Writer: {report.writer.username}",
            f"Approver: {report.approver.username if report.approver else '-'}",
            "",
            report.content or "",
        ]
        for line in lines:
            pdf.drawString(72, y, str(line)[:110])
            y -= 18
            if y < 72:
                # 페이지 하단에 도달하면 새 페이지를 열어 긴 본문도 잘리지 않게 합니다.
                pdf.showPage()
                y = height - 72
        pdf.save()
        buffer.seek(0)
        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="report-{report.id}.pdf"'
        return response


class ExpenseExcelDownloadView(ReportQuerysetMixin, APIView):
    """경비 항목을 Excel 파일로 즉시 생성해 다운로드합니다.

    openpyxl Workbook을 메모리에 만들고 ExpenseItem 목록을 행으로 기록한 뒤,
    .xlsx MIME 타입으로 응답합니다.
    """

    def get(self, request, pk):
        report = self.get_report(pk)
        self.ensure_expense(report)
        try:
            from openpyxl import Workbook
        except ImportError as exc:
            raise ValidationError("Excel 다운로드 라이브러리가 설치되어 있지 않습니다.") from exc

        from io import BytesIO

        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Expenses"
        sheet.append(["사용일", "분류", "내용", "결제수단", "금액"])
        for item in report.expense_items.all():
            sheet.append([item.expense_date, item.category, item.description, item.payment_method, item.amount])

        buffer = BytesIO()
        workbook.save(buffer)
        buffer.seek(0)
        response = HttpResponse(
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="expense-{report.id}.xlsx"'
        return response


class ReportHistoryView(ReportQuerysetMixin, generics.ListAPIView):
    """보고서 이력 조회 API.

    start_date/end_date 쿼리 파라미터가 있으면 보고일 기준 기간 필터를 적용합니다.
    """

    serializer_class = ReportListSerializer

    def get_queryset(self):
        qs = self.related_queryset()
        start_date = self.request.query_params.get("start_date")
        end_date = self.request.query_params.get("end_date")
        if start_date:
            qs = qs.filter(report_date__gte=start_date)
        if end_date:
            qs = qs.filter(report_date__lte=end_date)
        return qs
