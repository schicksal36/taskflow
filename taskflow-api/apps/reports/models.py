"""[업무보고] models.py - 업무보고/경비지출 모델.

역할: 업무보고, 수신자별 열람 추적, 경비지출 항목/증빙 파일 데이터 구조 정의
관련 모델: Report, ReportRecipient, ExpenseItem, ExpenseReceipt, ReportFile
관련 URL: /api/reports/
작성기준: Django Model 기반, JWT 인증 API에서 권한 검증
"""

from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel


class Report(TimeStampedModel):
    """보고서의 공통 헤더 모델.

    writer는 보고서를 작성하고 수정/삭제/제출할 수 있는 사용자입니다.
    approver는 제출된 보고서를 확인하거나 경비지출을 승인/반려하는 사용자입니다.

    일반 보고와 경비지출 보고가 같은 테이블을 사용하므로 status에는
    ReportStatus와 ExpenseStatus 값이 모두 들어올 수 있습니다. 뷰 레이어에서
    report_type을 보고 일반 보고 전용 API와 경비 전용 API를 분리합니다.
    """

    class ReportType(models.TextChoices):
        WORK_REPORT = "WORK_REPORT", "업무보고"
        WEEKLY_REPORT = "WEEKLY_REPORT", "주간보고"
        MONTHLY_REPORT = "MONTHLY_REPORT", "월간보고"
        EXPENSE_REPORT = "EXPENSE_REPORT", "경비지출"

    class ReportStatus(models.TextChoices):
        DRAFT = "DRAFT", "임시저장"
        SUBMITTED = "SUBMITTED", "제출"
        CONFIRMED = "CONFIRMED", "확인완료"
        RETURNED = "RETURNED", "보완요청"
        CANCELED = "CANCELED", "취소"

    class ExpenseStatus(models.TextChoices):
        DRAFT = "DRAFT", "임시저장"
        SUBMITTED = "SUBMITTED", "제출"
        REVIEWING = "REVIEWING", "검토중"
        APPROVED = "APPROVED", "승인"
        REJECTED = "REJECTED", "반려"
        CANCELED = "CANCELED", "취소"

    writer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="written_reports")
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approval_reports",
    )
    recipients = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="received_reports")
    report_type = models.CharField(max_length=30, choices=ReportType.choices)
    title = models.CharField(max_length=200)
    content = models.TextField(blank=True)
    status = models.CharField(max_length=20, default=ReportStatus.DRAFT)
    report_date = models.DateField()
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    submitted_at = models.DateTimeField(null=True, blank=True)
    viewed_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    returned_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejected_reason = models.TextField(blank=True)
    is_archived = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        # 목록 화면은 최신 보고일을 먼저 보여주는 업무 흐름이 자연스럽기 때문에
        # report_date 기준 내림차순, 같은 날짜에서는 생성순 내림차순으로 정렬합니다.
        ordering = ["-report_date", "-created_at"]
        # 작성자별 보고서 조회와 승인자별 대기 목록 조회가 자주 발생하므로
        # 복합 인덱스를 둬서 대시보드/목록 API의 필터 비용을 낮춥니다.
        indexes = [
            models.Index(fields=["writer", "report_type", "report_date"]),
            models.Index(fields=["approver", "status"]),
        ]

    def __str__(self):
        return self.title

    @property
    def is_expense(self):
        return self.report_type == self.ReportType.EXPENSE_REPORT


class ReportRecipient(TimeStampedModel):
    """업무보고 수신자별 열람/확인/보완요청 기록 모델.

    상태 의미:
      - is_read=False: 수신자가 아직 상세 조회하지 않음
      - is_read=True : 수신자가 최초 1회 이상 상세 조회함
      - confirmed_at: 수신자가 확인완료 처리한 시각
      - returned_at : 수신자가 보완요청 처리한 시각

    권한:
      - 수신자 본인 또는 대표이사가 확인완료/보완요청 처리 가능
      - 작성자는 수신자별 상태를 직접 변경하지 않음
    """

    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name="recipient_records")
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="report_recipient_records")
    is_read = models.BooleanField(default=False)  # 최초 상세 조회 여부. 재열람해도 read_at은 갱신하지 않습니다.
    read_at = models.DateTimeField(null=True, blank=True)  # 최초 상세 조회 시각
    confirmed_at = models.DateTimeField(null=True, blank=True)  # 수신자 확인완료 시각
    returned_at = models.DateTimeField(null=True, blank=True)  # 수신자 보완요청 시각
    return_reason = models.TextField(blank=True)  # 보완요청 사유

    class Meta:
        unique_together = ["report", "recipient"]
        indexes = [
            models.Index(fields=["recipient", "is_read"]),
            models.Index(fields=["report", "confirmed_at"]),
        ]


class ExpenseItem(TimeStampedModel):
    """경비지출 보고서의 개별 사용 내역.

    하나의 경비지출 Report에는 여러 ExpenseItem이 붙습니다. 항목이 생성/수정/삭제될
    때 views.py의 recalculate_total()이 다시 합계를 계산해서 Report.total_amount에
    반영합니다.

    receipt_file은 대표 영수증을 빠르게 표시하기 위한 단일 참조이고,
    ExpenseReceipt는 여러 증빙 파일을 관리하기 위한 상세 연결 테이블입니다.
    """

    class Category(models.TextChoices):
        MEAL = "MEAL", "식비"
        TRANSPORT = "TRANSPORT", "교통"
        SUPPLIES = "SUPPLIES", "비품"
        ACCOMMODATION = "ACCOMMODATION", "숙박"
        FUEL = "FUEL", "유류"
        ETC = "ETC", "기타"

    class PaymentMethod(models.TextChoices):
        CARD = "CARD", "카드"
        CASH = "CASH", "현금"
        TRANSFER = "TRANSFER", "계좌이체"
        COMPANY_CARD = "COMPANY_CARD", "법인카드"
        ETC = "ETC", "기타"

    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name="expense_items")
    expense_date = models.DateField()
    category = models.CharField(max_length=30, choices=Category.choices)
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_method = models.CharField(max_length=30, choices=PaymentMethod.choices, default=PaymentMethod.CARD)
    receipt_file = models.ForeignKey("media_files.MediaFile", null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        # 경비 내역 화면은 실제 사용일 순으로 보는 것이 회계 검토에 적합합니다.
        ordering = ["expense_date", "id"]
        # 특정 보고서 안에서 날짜/분류별로 내역을 찾는 조회를 빠르게 처리합니다.
        indexes = [models.Index(fields=["report", "expense_date", "category"])]


class ExpenseReceipt(TimeStampedModel):
    """경비 항목과 업로드된 미디어 파일을 연결하는 영수증 모델.

    실제 파일 바이너리는 media_files.MediaFile이 저장하고, 이 모델은 어떤 경비
    항목의 증빙인지와 누가 첨부했는지를 기록합니다.
    """

    expense_item = models.ForeignKey(ExpenseItem, on_delete=models.CASCADE, related_name="receipts")
    media_file = models.ForeignKey("media_files.MediaFile", on_delete=models.CASCADE)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)


class ReportFile(TimeStampedModel):
    """보고서에 직접 첨부되는 일반 파일 모델.

    경비 영수증은 ExpenseReceipt로 분리하고, 업무보고 등에 붙는 참고자료는
    ReportFile로 관리합니다. 파일 삭제 권한은 views.py에서 업로드한 사용자 또는
    보고서 작성자로 제한합니다.
    """

    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name="files")
    media_file = models.ForeignKey("media_files.MediaFile", on_delete=models.CASCADE)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    file_category = models.CharField(max_length=40, default="REPORT_ATTACHMENT")
