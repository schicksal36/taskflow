"""[업무요청] views.py - 업무요청 앱 뷰.

역할: 업무요청 생성/조회/수락/거절/완료/승인 API 엔드포인트 처리
관련 모델: WorkRequest, WorkRequestComment, WorkRequestFile
관련 URL: /api/work-requests/
작성기준: DRF Generic/APIView 기반, JWT 인증 필수
"""

from datetime import timedelta
from io import BytesIO
from zipfile import ZipFile

from django.db.models import Q
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.views import APIView

from apps.common.responses import success_response
from apps.notifications.models import Notification
from apps.notifications.services import create_notification
from apps.todos.models import Todo

from .models import WorkRequest, WorkRequestComment, WorkRequestFile
from .serializers import (
    WorkRequestAssigneeSerializer,
    WorkRequestCommentSerializer,
    WorkRequestCreateSerializer,
    WorkRequestDeadlineSerializer,
    WorkRequestDetailSerializer,
    WorkRequestFileSerializer,
    WorkRequestListSerializer,
    WorkRequestPrioritySerializer,
    WorkRequestRejectSerializer,
    WorkRequestStatusSerializer,
    WorkRequestUpdateSerializer,
)


def work_request_assignees(work_request):
    """대표 담당자와 다중 담당자를 중복 없이 반환합니다."""
    assignees = list(work_request.assignees.all())
    if work_request.assignee and all(user.pk != work_request.assignee_id for user in assignees):
        assignees.insert(0, work_request.assignee)
    return assignees


def notify_work_request_assignees(work_request, title, content):
    """업무요청 담당자 전체에게 알림을 보냅니다."""
    for assignee in work_request_assignees(work_request):
        create_notification(
            assignee,
            Notification.Type.WORK_REQUEST,
            title,
            content,
            "WORK_REQUEST",
            work_request.id,
        )


class WorkRequestQuerysetMixin:
    """업무요청 API 공통 조회/권한 믹스인.

    업무요청은 요청자와 담당자만 볼 수 있습니다. 이 믹스인은 같은 필터와 역할 검사를
    모든 업무요청 View에서 재사용하게 해 권한 누락을 줄입니다.
    """

    permission_classes = [permissions.IsAuthenticated]

    def related_queryset(self):
        """로그인 사용자가 요청자 또는 담당자인 업무요청만 반환합니다."""
        user = self.request.user
        return WorkRequest.objects.filter(Q(requester=user) | Q(assignee=user) | Q(assignees=user)).distinct()

    def get_object_for_user(self, pk):
        """권한 범위 안에서만 단건 업무요청을 찾습니다."""
        return generics.get_object_or_404(self.related_queryset(), pk=pk)

    def ensure_requester(self, work_request):
        """요청자만 수행할 수 있는 수정/승인/반려/취소인지 확인합니다."""
        if work_request.requester != self.request.user:
            raise PermissionDenied("요청자만 처리할 수 있습니다.")

    def ensure_assignee(self, work_request):
        """담당자만 수행할 수 있는 완료 요청인지 확인합니다."""
        if work_request.assignee != self.request.user and not work_request.assignees.filter(pk=self.request.user.pk).exists():
            raise PermissionDenied("담당자만 처리할 수 있습니다.")


class WorkRequestListCreateView(WorkRequestQuerysetMixin, generics.ListCreateAPIView):
    """업무요청 목록 조회와 생성 API."""

    search_fields = ["title", "content"]
    ordering_fields = ["deadline_at", "created_at", "priority"]

    def get_queryset(self):
        return self.related_queryset()

    def get_serializer_class(self):
        if self.request.method == "POST":
            return WorkRequestCreateSerializer
        return WorkRequestListSerializer

    def perform_create(self, serializer):
        work_request = serializer.save()
        notify_work_request_assignees(work_request, "새 업무요청이 도착했습니다.", work_request.title)


class WorkRequestDetailUpdateDeleteView(WorkRequestQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """업무요청 상세 조회, 작성자 수정, 작성자 삭제 API."""

    def get_queryset(self):
        return self.related_queryset()

    def get_serializer_class(self):
        if self.request.method in {"PATCH", "PUT"}:
            return WorkRequestUpdateSerializer
        return WorkRequestDetailSerializer

    def perform_update(self, serializer):
        self.ensure_requester(self.get_object())
        serializer.save()

    def perform_destroy(self, instance):
        self.ensure_requester(instance)
        instance.delete()


class WorkRequestFieldUpdateView(WorkRequestQuerysetMixin, APIView):
    """단일 필드 PATCH API의 공통 부모.

    상태, 담당자, 마감일, 우선순위처럼 작은 변경은 전용 endpoint를 두면 프론트가
    부분 업데이트를 단순하게 호출할 수 있습니다.
    """

    serializer_class = None
    requester_only = False

    def patch(self, request, pk):
        work_request = self.get_object_for_user(pk)
        if self.requester_only:
            self.ensure_requester(work_request)
        serializer = self.serializer_class(work_request, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(WorkRequestDetailSerializer(work_request).data, "업무요청이 수정되었습니다.")


class WorkRequestStatusView(WorkRequestFieldUpdateView):
    """업무요청 status 단건 변경 API."""

    serializer_class = WorkRequestStatusSerializer


class WorkRequestAssigneeView(WorkRequestFieldUpdateView):
    """담당자 변경 API.

    담당자가 바뀌면 새 담당자가 수락/거절할 수 있도록 PENDING 상태로 되돌립니다.
    """

    serializer_class = WorkRequestAssigneeSerializer
    requester_only = True

    def patch(self, request, pk):
        response = super().patch(request, pk)
        work_request = self.get_object_for_user(pk)
        if work_request.assignee:
            work_request.status = WorkRequest.Status.PENDING
            work_request.save(update_fields=["status"])
            work_request.assignees.set([work_request.assignee])
        return response


class WorkRequestDeadlineView(WorkRequestFieldUpdateView):
    """마감일 변경 API."""

    serializer_class = WorkRequestDeadlineSerializer
    requester_only = True


class WorkRequestPriorityView(WorkRequestFieldUpdateView):
    """우선순위 변경 API."""

    serializer_class = WorkRequestPrioritySerializer
    requester_only = True


class MyCreatedWorkRequestView(WorkRequestQuerysetMixin, generics.ListAPIView):
    """내가 요청한 업무만 조회합니다."""

    serializer_class = WorkRequestListSerializer

    def get_queryset(self):
        return WorkRequest.objects.filter(requester=self.request.user)


class MyAssignedWorkRequestView(WorkRequestQuerysetMixin, generics.ListAPIView):
    """내가 담당자인 업무만 조회합니다."""

    serializer_class = WorkRequestListSerializer

    def get_queryset(self):
        return WorkRequest.objects.filter(Q(assignee=self.request.user) | Q(assignees=self.request.user)).distinct()


class WorkRequestInProgressView(WorkRequestQuerysetMixin, generics.ListAPIView):
    """진행중 상태 업무만 조회합니다."""

    serializer_class = WorkRequestListSerializer

    def get_queryset(self):
        return self.related_queryset().filter(status=WorkRequest.Status.IN_PROGRESS)


class WorkRequestDueSoonView(WorkRequestQuerysetMixin, generics.ListAPIView):
    """현재 시각부터 3일 안에 마감되는 업무를 조회합니다."""

    serializer_class = WorkRequestListSerializer

    def get_queryset(self):
        now = timezone.now()
        return self.related_queryset().filter(deadline_at__gte=now, deadline_at__lte=now + timedelta(days=3))


class WorkRequestOverdueView(WorkRequestQuerysetMixin, generics.ListAPIView):
    """마감일이 지났고 완료 승인/취소되지 않은 업무를 조회합니다."""

    serializer_class = WorkRequestListSerializer

    def get_queryset(self):
        return self.related_queryset().filter(
            deadline_at__lt=timezone.now(),
        ).exclude(status__in=[WorkRequest.Status.APPROVED, WorkRequest.Status.CANCELED])


class WorkRequestCompleteView(WorkRequestQuerysetMixin, APIView):
    """담당자가 업무를 완료 요청 상태로 전환합니다."""

    def patch(self, request, pk):
        work_request = self.get_object_for_user(pk)
        self.ensure_assignee(work_request)
        work_request.status = WorkRequest.Status.COMPLETED
        work_request.completed_at = timezone.now()
        work_request.save(update_fields=["status", "completed_at"])
        create_notification(
            work_request.requester,
            Notification.Type.WORK_REQUEST,
            "업무 완료 승인 요청이 도착했습니다.",
            work_request.title,
            "WORK_REQUEST",
            work_request.id,
        )
        return success_response(WorkRequestDetailSerializer(work_request).data, "업무 완료 요청을 보냈습니다.")


class WorkRequestAcceptView(WorkRequestQuerysetMixin, APIView):
    """업무요청 수락 API.

    지원 액션:
      - PATCH /api/work-requests/{id}/accept/

    권한:
      - 인증된 사용자만 접근 가능
      - 담당자(assignee) 본인만 수락 가능
    """

    @extend_schema(
        tags=["📋 업무요청"],
        summary="업무요청 수락",
        description="""
        업무요청을 수락합니다.
        - 상태가 PENDING인 경우에만 수락 가능
        - 수락 시 status=ACCEPTED로 변경
        - 담당자의 할일(Todo) 자동 생성
        - 권한: 담당자 본인만 가능
        """,
        responses={200: WorkRequestDetailSerializer, 400: None, 403: None, 404: None},
    )
    def patch(self, request, pk):
        """업무요청 수락 처리.

        동작 순서:
          1. pk로 WorkRequest 객체 조회
          2. 요청자가 담당자 본인인지 확인
          3. 현재 상태가 PENDING인지 확인
          4. status를 ACCEPTED로 변경
          5. 담당자의 Todo에 제목/내용/우선순위/마감일을 복사해 생성
          6. 요청자에게 수락 알림 생성 후 성공 응답 반환

        Args:
            request: JWT 인증된 HTTP 요청 객체
            pk: 수락할 업무요청 ID

        Returns:
            200: 수락 성공 및 업데이트된 업무요청 데이터
            400: 이미 처리된 요청
            403: 담당자가 아닌 사용자의 요청
            404: 접근 가능한 업무요청 없음
        """
        work_request = self.get_object_for_user(pk)
        # 담당자 본인 여부 확인: 요청자가 assignee가 아니면 처리 불가합니다.
        self.ensure_assignee(work_request)
        # 중복 처리 방지: PENDING 상태인 경우에만 수락을 허용합니다.
        if work_request.status != WorkRequest.Status.PENDING:
            return success_response(
                WorkRequestDetailSerializer(work_request).data,
                "이미 처리된 요청입니다.",
                status.HTTP_400_BAD_REQUEST,
            )

        work_request.status = WorkRequest.Status.ACCEPTED
        work_request.save(update_fields=["status"])
        # 수락 처리 후 담당자 할일 자동 생성: 업무요청의 핵심 필드를 그대로 복사합니다.
        Todo.objects.create(
            user=request.user,
            title=work_request.title,
            content=work_request.content,
            priority=work_request.priority,
            deadline_at=work_request.deadline_at,
        )
        create_notification(
            work_request.requester,
            Notification.Type.WORK_REQUEST,
            "업무요청이 수락되었습니다.",
            work_request.title,
            "WORK_REQUEST",
            work_request.id,
        )
        return success_response(WorkRequestDetailSerializer(work_request).data, "업무요청을 수락했습니다.")


class WorkRequestApproveView(WorkRequestQuerysetMixin, APIView):
    """요청자가 담당자의 완료 요청을 승인합니다."""

    def patch(self, request, pk):
        work_request = self.get_object_for_user(pk)
        self.ensure_requester(work_request)
        work_request.status = WorkRequest.Status.APPROVED
        work_request.approved_at = timezone.now()
        work_request.save(update_fields=["status", "approved_at"])
        notify_work_request_assignees(work_request, "업무 완료가 승인되었습니다.", work_request.title)
        return success_response(WorkRequestDetailSerializer(work_request).data, "업무 완료를 승인했습니다.")


class WorkRequestRejectView(WorkRequestQuerysetMixin, APIView):
    """업무요청 거절/완료요청 반려 API.

    PENDING 상태에서는 담당자가 요청 자체를 거절하고, 그 외 상태에서는 기존 완료요청
    반려 흐름처럼 요청자가 반려 사유를 남깁니다.
    """

    def patch(self, request, pk):
        work_request = self.get_object_for_user(pk)
        if work_request.status == WorkRequest.Status.PENDING:
            self.ensure_assignee(work_request)
            work_request.status = WorkRequest.Status.REJECTED
            work_request.rejected_reason = request.data.get("rejected_reason", "")
            work_request.save(update_fields=["status", "rejected_reason"])
            create_notification(
                work_request.requester,
                Notification.Type.WORK_REQUEST,
                "업무요청이 거절되었습니다.",
                work_request.rejected_reason or work_request.title,
                "WORK_REQUEST",
                work_request.id,
            )
            return success_response(WorkRequestDetailSerializer(work_request).data, "업무요청을 거절했습니다.")

        self.ensure_requester(work_request)
        serializer = WorkRequestRejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        work_request.status = WorkRequest.Status.REJECTED
        work_request.rejected_reason = serializer.validated_data["rejected_reason"]
        work_request.save(update_fields=["status", "rejected_reason"])
        notify_work_request_assignees(work_request, "업무 완료가 반려되었습니다.", work_request.rejected_reason)
        return success_response(WorkRequestDetailSerializer(work_request).data, "업무를 반려했습니다.")


class WorkRequestCancelView(WorkRequestQuerysetMixin, APIView):
    """요청자가 업무요청을 취소합니다."""

    def patch(self, request, pk):
        work_request = self.get_object_for_user(pk)
        self.ensure_requester(work_request)
        work_request.status = WorkRequest.Status.CANCELED
        work_request.save(update_fields=["status"])
        notify_work_request_assignees(work_request, "업무요청이 취소되었습니다.", work_request.title)
        return success_response(WorkRequestDetailSerializer(work_request).data, "업무요청을 취소했습니다.")


class WorkRequestSearchView(WorkRequestListCreateView):
    """업무요청 검색 API.

    ListCreateView의 search_fields 설정을 그대로 사용해 제목/내용 검색을 제공합니다.
    """

    pass


class WorkRequestCommentListCreateView(WorkRequestQuerysetMixin, generics.ListCreateAPIView):
    """업무요청 댓글 목록/작성 API."""

    serializer_class = WorkRequestCommentSerializer

    def get_queryset(self):
        work_request = self.get_object_for_user(self.kwargs["pk"])
        return WorkRequestComment.objects.filter(work_request=work_request)

    def perform_create(self, serializer):
        work_request = self.get_object_for_user(self.kwargs["pk"])
        serializer.save(work_request=work_request, author=self.request.user)


class WorkRequestCommentDetailView(generics.RetrieveUpdateDestroyAPIView):
    """업무요청 댓글 단건 조회/수정/삭제 API."""

    serializer_class = WorkRequestCommentSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_url_kwarg = "comment_id"

    def get_queryset(self):
        user = self.request.user
        return WorkRequestComment.objects.filter(
            Q(work_request__requester=user) | Q(work_request__assignee=user),
        ).distinct()

    def perform_update(self, serializer):
        if self.get_object().author != self.request.user:
            raise PermissionDenied("작성자만 수정할 수 있습니다.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.author != self.request.user:
            raise PermissionDenied("작성자만 삭제할 수 있습니다.")
        instance.delete()


class WorkRequestFileListCreateView(WorkRequestQuerysetMixin, generics.ListCreateAPIView):
    """업무요청 첨부파일 목록/연결 API."""

    serializer_class = WorkRequestFileSerializer

    def get_queryset(self):
        work_request = self.get_object_for_user(self.kwargs["pk"])
        return WorkRequestFile.objects.filter(work_request=work_request)

    def perform_create(self, serializer):
        work_request = self.get_object_for_user(self.kwargs["pk"])
        serializer.save(work_request=work_request, uploaded_by=self.request.user)


class WorkRequestFileDetailView(generics.RetrieveDestroyAPIView):
    """업무요청 첨부파일 연결 조회/삭제 API."""

    serializer_class = WorkRequestFileSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_url_kwarg = "file_id"

    def get_queryset(self):
        user = self.request.user
        return WorkRequestFile.objects.filter(
            Q(work_request__requester=user) | Q(work_request__assignee=user),
        ).distinct()

    def perform_destroy(self, instance):
        if instance.uploaded_by != self.request.user and instance.work_request.requester != self.request.user:
            raise PermissionDenied("업로드한 사용자 또는 요청자만 삭제할 수 있습니다.")
        instance.delete()


class WorkRequestFileDownloadView(WorkRequestQuerysetMixin, APIView):
    """업무요청 첨부파일 개별 다운로드 API."""

    def get(self, request, pk, file_id):
        work_request = self.get_object_for_user(pk)
        attachment = generics.get_object_or_404(WorkRequestFile.objects.filter(work_request=work_request), pk=file_id)
        media = attachment.media_file
        return FileResponse(media.file.open("rb"), as_attachment=True, filename=media.original_name)


class WorkRequestFileDownloadAllView(WorkRequestQuerysetMixin, APIView):
    """업무요청 첨부파일 전체 zip 다운로드 API."""

    def get(self, request, pk):
        work_request = self.get_object_for_user(pk)
        buffer = BytesIO()
        with ZipFile(buffer, "w") as zip_file:
            for attachment in WorkRequestFile.objects.filter(work_request=work_request).select_related("media_file"):
                media = attachment.media_file
                zip_file.writestr(media.original_name, media.file.read())
        buffer.seek(0)
        response = HttpResponse(buffer.getvalue(), content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="work-request-{work_request.id}-attachments.zip"'
        return response
