"""[업무보고] serializers.py - 보고서/경비지출 API serializer.

역할: 업무보고/경비지출 요청 검증과 응답 JSON 변환
관련 모델: Report, ReportRecipient, ExpenseItem, ExpenseReceipt, ReportFile
관련 URL: /api/reports/
작성기준: DRF Serializer 기반, JWT 인증 View에서 사용
"""

from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import serializers

from .models import ExpenseItem, ExpenseReceipt, Report, ReportFile, ReportRecipient


class ReportRecipientSerializer(serializers.ModelSerializer):
    """업무보고 수신자별 열람/확인/보완요청 상태 serializer.

    응답 필드:
      - name/department/position: 프론트 수신자 표시용 사용자 정보
      - is_read/read_at: 최초 열람 추적 정보
      - confirmed_at/returned_at/return_reason: 수신자 처리 상태
    """

    name = serializers.SerializerMethodField()
    department = serializers.CharField(source="recipient.department", read_only=True)
    position = serializers.CharField(source="recipient.position", read_only=True)

    class Meta:
        model = ReportRecipient
        fields = [
            "id",
            "recipient",
            "name",
            "department",
            "position",
            "is_read",
            "read_at",
            "confirmed_at",
            "returned_at",
            "return_reason",
        ]

    def get_name(self, obj):
        """수신자 표시명을 반환합니다.

        Args:
            obj: ReportRecipient 인스턴스

        Returns:
            사용자 이름이 있으면 이름, 없으면 email 순서의 표시 문자열
        """
        return obj.recipient.first_name or obj.recipient.email


class ExpenseItemSerializer(serializers.ModelSerializer):
    """경비 항목 요청/응답 serializer.

    report는 URL의 <pk>에서 서버가 결정하므로 클라이언트가 직접 넘기지 않습니다.
    receipt_file은 대표 영수증을 표시하기 위한 읽기/쓰기 가능 참조이고, 다중 영수증은
    ExpenseReceiptSerializer를 통해 별도 연결합니다.
    """

    class Meta:
        model = ExpenseItem
        fields = [
            "id",
            "report",
            "expense_date",
            "category",
            "description",
            "amount",
            "payment_method",
            "receipt_file",
            "created_at",
        ]
        read_only_fields = ["report", "created_at"]


class ExpenseReceiptSerializer(serializers.ModelSerializer):
    """경비 항목과 MediaFile을 연결하는 serializer.

    클라이언트는 media_file ID만 전달하고, expense_item과 uploaded_by는 URL과
    로그인 사용자 기준으로 서버가 채웁니다.
    """

    class Meta:
        model = ExpenseReceipt
        fields = ["id", "expense_item", "media_file", "uploaded_by", "created_at"]
        read_only_fields = ["expense_item", "uploaded_by", "created_at"]


class ReportFileSerializer(serializers.ModelSerializer):
    """보고서 일반 첨부파일 연결 serializer."""

    original_name = serializers.CharField(source="media_file.original_name", read_only=True)

    class Meta:
        model = ReportFile
        fields = ["id", "report", "media_file", "original_name", "uploaded_by", "file_category", "created_at"]
        read_only_fields = ["report", "uploaded_by", "created_at"]


class ReportListSerializer(serializers.ModelSerializer):
    """목록 화면에서 필요한 최소 보고서 정보 serializer."""

    writer_name = serializers.SerializerMethodField()
    writer_department = serializers.CharField(source="writer.department", read_only=True)
    writer_position = serializers.CharField(source="writer.position", read_only=True)
    approver_name = serializers.CharField(source="approver.username", read_only=True)
    recipient_ids = serializers.PrimaryKeyRelatedField(source="recipients", many=True, read_only=True)
    recipients = ReportRecipientSerializer(source="recipient_records", many=True, read_only=True)
    files = ReportFileSerializer(many=True, read_only=True)
    expense_place = serializers.SerializerMethodField()
    is_viewed = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = [
            "id",
            "writer",
            "writer_name",
            "writer_department",
            "writer_position",
            "approver",
            "approver_name",
            "recipient_ids",
            "recipients",
            "files",
            "report_type",
            "title",
            "status",
            "report_date",
            "total_amount",
            "expense_place",
            "is_viewed",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["writer", "status", "created_at", "updated_at"]

    def get_writer_name(self, obj):
        """작성자 표시명을 이름과 조직 정보로 반환합니다."""
        writer = obj.writer
        name = writer.first_name or writer.get_username()
        details = [writer.department, writer.position]
        detail_text = " / ".join([value for value in details if value])
        return f"{name} ({detail_text})" if detail_text else name

    def get_expense_place(self, obj):
        """경비지출 목록에서 대표 지출처를 표시합니다."""
        if not obj.is_expense:
            return ""
        first_item = obj.expense_items.order_by("expense_date", "id").first()
        return first_item.description if first_item else obj.content

    def get_is_viewed(self, obj):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            record = obj.recipient_records.filter(recipient=request.user).first()
            if record:
                return record.is_read
        return bool(obj.viewed_at)


class ReportDetailSerializer(ReportListSerializer):
    """상세 화면용 serializer.

    목록 필드에 본문, 상태 변경 시각, 경비 항목, 첨부파일을 더해서 한 번의 조회로
    상세 화면을 구성할 수 있게 합니다.
    """

    expense_items = ExpenseItemSerializer(many=True, read_only=True)
    class Meta(ReportListSerializer.Meta):
        fields = ReportListSerializer.Meta.fields + [
            "content",
            "submitted_at",
            "viewed_at",
            "confirmed_at",
            "returned_at",
            "approved_at",
            "rejected_at",
            "rejected_reason",
            "is_archived",
            "archived_at",
            "expense_items",
        ]


class ReportCreateUpdateSerializer(serializers.ModelSerializer):
    """보고서 생성/수정 serializer.

    생성 시에는 request.user를 writer로 고정합니다. expense_items가 함께 들어오면
    초기 경비 항목까지 한 번에 생성하지만, 수정 시에는 보고서 헤더만 수정하고 항목은
    전용 ExpenseItem API에서 관리합니다.
    """

    expense_items = ExpenseItemSerializer(many=True, required=False)
    recipient_ids = serializers.PrimaryKeyRelatedField(
        source="recipients",
        many=True,
        queryset=Report._meta.get_field("writer").remote_field.model.objects.all(),
        required=False,
    )
    recipient_inputs = serializers.ListField(
        child=serializers.CharField(allow_blank=False),
        required=False,
        write_only=True,
        help_text="수기로 입력한 수신자 이메일, 아이디, 이름 목록",
    )

    class Meta:
        model = Report
        fields = [
            "id",
            "approver",
            "recipient_ids",
            "recipient_inputs",
            "report_type",
            "title",
            "content",
            "report_date",
            "total_amount",
            "expense_items",
        ]
        read_only_fields = ["id"]

    def resolve_recipient_inputs(self, values):
        """수기로 입력한 이메일/아이디/이름을 사용자 객체 목록으로 변환합니다."""
        User = get_user_model()
        recipients = []
        for raw_value in values:
            value = raw_value.strip()
            if not value:
                continue
            matches = User.objects.filter(
                Q(email__iexact=value)
                | Q(username__iexact=value)
                | Q(first_name__iexact=value)
            )
            if not matches.exists():
                raise serializers.ValidationError({"recipient_inputs": f"'{value}' 수신자를 찾을 수 없습니다."})
            if matches.count() > 1:
                raise serializers.ValidationError({"recipient_inputs": f"'{value}' 수신자가 여러 명입니다. 이메일로 입력해주세요."})
            recipients.append(matches.first())
        return recipients

    def merge_recipients(self, selected_recipients, manual_inputs):
        """검색 선택 수신자와 수기 입력 수신자를 중복 없이 합칩니다."""
        merged = []
        seen = set()
        for recipient in [*selected_recipients, *self.resolve_recipient_inputs(manual_inputs)]:
            if recipient.pk in seen:
                continue
            seen.add(recipient.pk)
            merged.append(recipient)
        return merged

    def include_approver_recipient(self, recipients, approver):
        """확인자만 전달된 예전/단순 요청도 수신자 기록으로 남기도록 합칩니다."""
        merged = []
        seen = set()
        for recipient in [*recipients, approver]:
            if not recipient or recipient.pk in seen:
                continue
            seen.add(recipient.pk)
            merged.append(recipient)
        return merged

    def validate_no_self_recipient(self, recipients, approver=None):
        """작성자가 자기 자신을 수신자/확인자로 지정하지 못하게 막습니다."""
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return
        if approver and approver == user:
            raise serializers.ValidationError({"approver": "자기 자신에게 보고할 수 없습니다."})
        if any(recipient == user for recipient in recipients):
            raise serializers.ValidationError({"recipient_ids": "자기 자신을 수신자로 지정할 수 없습니다."})

    def create(self, validated_data):
        items = validated_data.pop("expense_items", [])
        recipients = validated_data.pop("recipients", [])
        recipient_inputs = validated_data.pop("recipient_inputs", [])
        recipients = self.merge_recipients(recipients, recipient_inputs)
        recipients = self.include_approver_recipient(recipients, validated_data.get("approver"))
        self.validate_no_self_recipient(recipients, validated_data.get("approver"))
        report = Report.objects.create(writer=self.context["request"].user, **validated_data)
        if recipients:
            report.recipients.set(recipients)
            for recipient in recipients:
                ReportRecipient.objects.get_or_create(report=report, recipient=recipient)
            if not report.approver:
                report.approver = recipients[0]
                report.save(update_fields=["approver"])
        for item in items:
            ExpenseItem.objects.create(report=report, **item)
        if items:
            report.total_amount = sum(item["amount"] for item in items)
            report.save(update_fields=["total_amount"])
        return report

    def update(self, instance, validated_data):
        validated_data.pop("expense_items", None)
        recipients = validated_data.pop("recipients", None)
        recipient_inputs = validated_data.pop("recipient_inputs", [])
        approver_updated = "approver" in validated_data
        if recipients is not None or recipient_inputs:
            recipients = self.merge_recipients(recipients or [], recipient_inputs)
        self.validate_no_self_recipient(recipients or [], validated_data.get("approver", instance.approver))
        instance = super().update(instance, validated_data)
        if recipients is not None or approver_updated:
            recipients = self.include_approver_recipient(recipients if recipients is not None else list(instance.recipients.all()), instance.approver)
            instance.recipients.set(recipients)
            instance.recipient_records.exclude(recipient__in=recipients).delete()
            for recipient in recipients:
                ReportRecipient.objects.get_or_create(report=instance, recipient=recipient)
            if recipients and not instance.approver:
                instance.approver = recipients[0]
                instance.save(update_fields=["approver"])
        return instance


class ReportReturnSerializer(serializers.Serializer):
    """보완요청/반려 사유 입력 serializer."""

    reason = serializers.CharField()


class ReportCancelSerializer(serializers.Serializer):
    """취소 사유 입력 serializer.

    현재 모델에는 별도 cancel_reason 필드가 없으므로 검증 용도로만 사용합니다.
    추후 이력 테이블이 생기면 reason을 상태 변경 이력에 저장하면 됩니다.
    """

    reason = serializers.CharField(required=False, allow_blank=True)
