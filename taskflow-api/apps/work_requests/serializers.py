"""[업무요청] serializers.py - 업무요청 API serializer.

역할: 업무요청 생성/조회/상태 변경/첨부파일 연결 요청과 응답 변환
관련 모델: WorkRequest, WorkRequestComment, WorkRequestFile
관련 URL: /api/work-requests/
작성기준: DRF Serializer 기반, JWT 인증 View에서 사용
"""

from datetime import datetime, time

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from .models import WorkRequest, WorkRequestComment, WorkRequestFile, WorkRequestReadRecord


def user_display_label(user):
    """사용자 표시명을 이름과 조직 정보로 반환합니다."""
    if not user:
        return ""
    name = user.first_name or user.get_username()
    details = [user.department, user.position]
    detail_text = " / ".join([value for value in details if value])
    return f"{name} ({detail_text})" if detail_text else name


class WorkRequestReadRecordSerializer(serializers.ModelSerializer):
    """업무요청 담당자별 열람 상태."""

    name = serializers.SerializerMethodField()
    department = serializers.CharField(source="assignee.department", read_only=True)
    position = serializers.CharField(source="assignee.position", read_only=True)

    class Meta:
        model = WorkRequestReadRecord
        fields = ["id", "assignee", "name", "department", "position", "is_read", "read_at"]

    def get_name(self, obj):
        return obj.assignee.first_name or obj.assignee.get_username()


def sync_work_request_read_records(work_request):
    """담당자 목록과 열람 기록을 동기화합니다."""
    assignees = list(work_request.assignees.all())
    if work_request.assignee and all(user.pk != work_request.assignee_id for user in assignees):
        assignees.insert(0, work_request.assignee)
    for assignee in assignees:
        WorkRequestReadRecord.objects.get_or_create(work_request=work_request, assignee=assignee)
    if assignees:
        WorkRequestReadRecord.objects.filter(work_request=work_request).exclude(assignee__in=assignees).delete()


class WorkRequestListSerializer(serializers.ModelSerializer):
    """업무요청 목록 화면용 serializer.

    목록 화면에서 바로 수정 폼을 채우므로 content도 함께 제공합니다.
    """

    requester_name = serializers.SerializerMethodField()
    assignee_name = serializers.SerializerMethodField()
    assignee_ids = serializers.PrimaryKeyRelatedField(source="assignees", many=True, read_only=True)
    assignee_names = serializers.SerializerMethodField()
    read_records = serializers.SerializerMethodField()
    has_read_assignee = serializers.SerializerMethodField()
    due_date = serializers.SerializerMethodField()
    reminder_date = serializers.SerializerMethodField()
    files = serializers.SerializerMethodField()

    class Meta:
        model = WorkRequest
        fields = [
            "id",
            "title",
            "content",
            "requester",
            "requester_name",
            "assignee",
            "assignee_name",
            "assignee_ids",
            "assignee_names",
            "read_records",
            "has_read_assignee",
            "status",
            "priority",
            "deadline_at",
            "due_date",
            "reminder_date",
            "files",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["requester", "created_at", "updated_at"]

    def get_due_date(self, obj):
        """deadline_at을 프롬프트의 due_date 응답 필드로 변환합니다."""
        return obj.deadline_at.date() if obj.deadline_at else None

    def get_reminder_date(self, obj):
        """별도 알림일 필드가 없으면 마감일을 알림일 기본값으로 내려줍니다."""
        return obj.deadline_at.date() if obj.deadline_at else None

    def get_files(self, obj):
        return WorkRequestFileSerializer(obj.files.all(), many=True, context=self.context).data

    def get_requester_name(self, obj):
        return user_display_label(obj.requester)

    def get_assignee_name(self, obj):
        return user_display_label(obj.assignee)

    def get_assignee_names(self, obj):
        return [user_display_label(assignee) for assignee in obj.assignees.all()]

    def get_read_records(self, obj):
        sync_work_request_read_records(obj)
        return WorkRequestReadRecordSerializer(obj.read_records.select_related("assignee"), many=True).data

    def get_has_read_assignee(self, obj):
        return obj.read_records.filter(is_read=True).exists()


class WorkRequestDetailSerializer(WorkRequestListSerializer):
    """업무요청 상세 화면용 serializer."""

    class Meta(WorkRequestListSerializer.Meta):
        fields = WorkRequestListSerializer.Meta.fields + [
            "content",
            "completed_at",
            "approved_at",
            "rejected_reason",
        ]


class WorkRequestCreateSerializer(serializers.ModelSerializer):
    """업무요청 생성 serializer.

    requester는 로그인 사용자로 고정합니다. 담당자가 포함되어 있어도 새 요청은
    PENDING 상태로 시작하고, 담당자가 수락해야 실제 Todo로 전환됩니다.
    """

    due_date = serializers.DateField(required=False, allow_null=True, write_only=True)
    reminder_date = serializers.DateField(required=False, allow_null=True, write_only=True)
    assignee_input = serializers.CharField(required=False, allow_blank=True, write_only=True)
    assignee_ids = serializers.PrimaryKeyRelatedField(
        source="assignees",
        many=True,
        queryset=WorkRequest._meta.get_field("requester").remote_field.model.objects.all(),
        required=False,
        write_only=True,
    )
    assignee_inputs = serializers.ListField(
        child=serializers.CharField(allow_blank=False),
        required=False,
        write_only=True,
    )

    class Meta:
        model = WorkRequest
        fields = [
            "id",
            "title",
            "content",
            "assignee",
            "assignee_ids",
            "assignee_input",
            "assignee_inputs",
            "priority",
            "deadline_at",
            "due_date",
            "reminder_date",
        ]
        read_only_fields = ["id"]

    def resolve_assignee_input(self, value):
        """수기로 입력한 이메일/아이디/이름을 담당자 사용자로 변환합니다."""
        value = (value or "").strip()
        if not value:
            return None
        User = get_user_model()
        matches = User.objects.filter(
            Q(email__iexact=value)
            | Q(username__iexact=value)
            | Q(first_name__iexact=value)
        )
        if not matches.exists():
            raise serializers.ValidationError({"assignee_input": f"'{value}' 담당자를 찾을 수 없습니다."})
        if matches.count() > 1:
            raise serializers.ValidationError({"assignee_input": f"'{value}' 담당자가 여러 명입니다. 이메일로 입력해주세요."})
        return matches.first()

    def merge_assignees(self, selected_assignees, manual_input, manual_inputs):
        merged = []
        seen = set()
        manual_values = [manual_input] if manual_input else []
        manual_values.extend(manual_inputs or [])
        for assignee in [*selected_assignees, *[self.resolve_assignee_input(value) for value in manual_values]]:
            if not assignee or assignee.pk in seen:
                continue
            seen.add(assignee.pk)
            merged.append(assignee)
        return merged

    def validate_no_self_assignee(self, assignees, assignee=None):
        """요청자가 자기 자신을 담당자로 지정하지 못하게 막습니다."""
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return
        if assignee and assignee == user:
            raise serializers.ValidationError({"assignee": "자기 자신에게 업무요청할 수 없습니다."})
        if any(entry == user for entry in assignees):
            raise serializers.ValidationError({"assignee_ids": "자기 자신을 담당자로 지정할 수 없습니다."})

    def create(self, validated_data):
        # 요청자는 화면에서 받지 않고 현재 로그인한 사람으로 자동 저장합니다.
        request = self.context["request"]
        due_date = validated_data.pop("due_date", None)
        validated_data.pop("reminder_date", None)
        selected_assignees = validated_data.pop("assignees", [])
        assignee_input = validated_data.pop("assignee_input", "")
        assignee_inputs = validated_data.pop("assignee_inputs", [])
        assignees = self.merge_assignees(selected_assignees, assignee_input, assignee_inputs)
        self.validate_no_self_assignee(assignees, validated_data.get("assignee"))
        if assignees:
            validated_data["assignee"] = assignees[0]
        if due_date and not validated_data.get("deadline_at"):
            deadline = datetime.combine(due_date, time.max)
            validated_data["deadline_at"] = timezone.make_aware(deadline, timezone.get_current_timezone())
        validated_data["status"] = WorkRequest.Status.PENDING
        work_request = WorkRequest.objects.create(requester=request.user, **validated_data)
        if assignees:
            work_request.assignees.set(assignees)
        elif work_request.assignee:
            work_request.assignees.set([work_request.assignee])
        sync_work_request_read_records(work_request)
        return work_request


class WorkRequestUpdateSerializer(serializers.ModelSerializer):
    """업무요청 본문/담당자/우선순위/마감일 수정 serializer."""

    due_date = serializers.DateField(required=False, allow_null=True, write_only=True)
    reminder_date = serializers.DateField(required=False, allow_null=True, write_only=True)
    assignee_input = serializers.CharField(required=False, allow_blank=True, write_only=True)
    assignee_ids = serializers.PrimaryKeyRelatedField(
        source="assignees",
        many=True,
        queryset=WorkRequest._meta.get_field("requester").remote_field.model.objects.all(),
        required=False,
        write_only=True,
    )
    assignee_inputs = serializers.ListField(
        child=serializers.CharField(allow_blank=False),
        required=False,
        write_only=True,
    )

    class Meta:
        model = WorkRequest
        fields = [
            "id",
            "title",
            "content",
            "assignee",
            "assignee_ids",
            "assignee_input",
            "assignee_inputs",
            "priority",
            "deadline_at",
            "due_date",
            "reminder_date",
        ]
        read_only_fields = ["id"]

    def update(self, instance, validated_data):
        due_date = validated_data.pop("due_date", None)
        validated_data.pop("reminder_date", None)
        selected_assignees = validated_data.pop("assignees", None)
        assignee_input = validated_data.pop("assignee_input", "")
        assignee_inputs = validated_data.pop("assignee_inputs", [])
        if selected_assignees is not None or assignee_input or assignee_inputs:
            helper = WorkRequestCreateSerializer(context=self.context)
            assignees = helper.merge_assignees(
                selected_assignees or [],
                assignee_input,
                assignee_inputs,
            )
            helper.validate_no_self_assignee(assignees, validated_data.get("assignee", instance.assignee))
            validated_data["assignee"] = assignees[0] if assignees else None
        if due_date and not validated_data.get("deadline_at"):
            deadline = datetime.combine(due_date, time.max)
            validated_data["deadline_at"] = timezone.make_aware(deadline, timezone.get_current_timezone())
        instance = super().update(instance, validated_data)
        if selected_assignees is not None or assignee_input or assignee_inputs:
            instance.assignees.set(assignees)
            sync_work_request_read_records(instance)
        return instance


class WorkRequestStatusSerializer(serializers.ModelSerializer):
    """status 필드만 바꾸는 경량 serializer."""

    class Meta:
        model = WorkRequest
        fields = ["status"]


class WorkRequestAssigneeSerializer(serializers.ModelSerializer):
    """assignee 필드만 바꾸는 경량 serializer."""

    class Meta:
        model = WorkRequest
        fields = ["assignee"]


class WorkRequestDeadlineSerializer(serializers.ModelSerializer):
    """deadline_at 필드만 바꾸는 경량 serializer."""

    class Meta:
        model = WorkRequest
        fields = ["deadline_at"]


class WorkRequestPrioritySerializer(serializers.ModelSerializer):
    """priority 필드만 바꾸는 경량 serializer."""

    class Meta:
        model = WorkRequest
        fields = ["priority"]


class WorkRequestCompleteSerializer(serializers.Serializer):
    """완료 요청 시 담당자가 남길 수 있는 보조 메시지 serializer."""

    message = serializers.CharField(required=False, allow_blank=True)


class WorkRequestRejectSerializer(serializers.Serializer):
    """요청자가 완료 요청을 반려할 때 필요한 사유 serializer."""

    rejected_reason = serializers.CharField()


class WorkRequestCommentSerializer(serializers.ModelSerializer):
    """업무요청 댓글 serializer."""

    author_name = serializers.CharField(source="author.username", read_only=True)

    class Meta:
        model = WorkRequestComment
        fields = ["id", "work_request", "author", "author_name", "content", "created_at"]
        read_only_fields = ["work_request", "author", "created_at"]


class WorkRequestFileSerializer(serializers.ModelSerializer):
    """업무요청 첨부파일 연결 serializer.

    실제 파일은 MediaFile이 보관하고, 이 serializer는 연결 정보와 다운로드 URL을
    화면에 제공합니다.
    """

    original_name = serializers.CharField(source="media_file.original_name", read_only=True)
    file_url = serializers.SerializerMethodField()
    file_type = serializers.CharField(source="media_file.file_type", read_only=True)
    mime_type = serializers.CharField(source="media_file.mime_type", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = WorkRequestFile
        fields = ["id", "work_request", "media_file", "original_name", "file_url", "file_type", "mime_type", "download_url", "uploaded_by", "created_at"]
        read_only_fields = ["work_request", "uploaded_by", "created_at"]

    def get_file_url(self, obj):
        request = self.context.get("request")
        if not obj.media_file.file:
            return None
        url = obj.media_file.file.url
        return request.build_absolute_uri(url) if request else url

    def get_download_url(self, obj):
        """프론트가 바로 사용할 수 있는 다운로드 API 경로를 생성합니다."""
        request = self.context.get("request")
        url = f"/api/work-requests/{obj.work_request_id}/attachments/{obj.id}/download/"
        return request.build_absolute_uri(url) if request else url
