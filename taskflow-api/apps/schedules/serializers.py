"""[일정] serializers.py - 공유 일정 API serializer.

역할: 공유 일정 생성/조회/수정 요청 검증과 응답 필드 변환
관련 모델: Schedule, ScheduleParticipant
관련 URL: /api/schedules/
작성기준: DRF Serializer 기반, JWT 인증 View에서 사용
"""

from rest_framework import serializers

from .models import Schedule, ScheduleParticipant


class ScheduleParticipantSerializer(serializers.ModelSerializer):
    """일정 참여자 serializer.

    user id와 함께 username을 내려줘 프론트가 별도 사용자 조회 없이 참여자 목록을
    표시할 수 있게 합니다.
    """

    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = ScheduleParticipant
        fields = ["id", "schedule", "user", "username", "response", "created_at"]
        read_only_fields = ["schedule", "created_at"]


class ScheduleListSerializer(serializers.ModelSerializer):
    """공유 일정 목록용 serializer.

    기존 프론트가 쓰던 owner/content/remind_at/schedule_type 이름도 읽기 전용 별칭으로
    내려줘 화면 변경 중에도 API 응답이 깨지지 않게 합니다.
    """

    owner = serializers.IntegerField(source="created_by_id", read_only=True)
    owner_name = serializers.CharField(source="created_by.username", read_only=True)
    content = serializers.CharField(source="description", read_only=True)
    schedule_type = serializers.CharField(source="category", read_only=True)
    is_shared = serializers.SerializerMethodField()
    remind_at = serializers.DateTimeField(source="alert_at", read_only=True)
    is_all_day = serializers.SerializerMethodField()
    repeat_type = serializers.SerializerMethodField()
    participant_count = serializers.IntegerField(source="participants.count", read_only=True)

    class Meta:
        model = Schedule
        fields = [
            "id",
            "title",
            "owner",
            "owner_name",
            "created_by",
            "created_by_name",
            "schedule_type",
            "category",
            "content",
            "description",
            "start_at",
            "end_at",
            "location",
            "is_shared",
            "remind_at",
            "alert_at",
            "color",
            "is_all_day",
            "repeat_type",
            "participant_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["owner", "created_by", "created_at", "updated_at"]

    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    def get_is_shared(self, obj):
        """모든 일정은 공유 일정이므로 항상 True를 반환합니다."""
        return True

    def get_is_all_day(self, obj):
        """현재 모델은 종일 여부를 저장하지 않으므로 False로 응답합니다."""
        return False

    def get_repeat_type(self, obj):
        """반복 일정 기능은 공유 일정 단일화 범위에서 제외되어 NONE으로 응답합니다."""
        return "NONE"


class ScheduleDetailSerializer(ScheduleListSerializer):
    """일정 상세 serializer. 참여자 목록과 반복/표시 정보를 함께 제공합니다."""

    participants = ScheduleParticipantSerializer(many=True, read_only=True)

    class Meta(ScheduleListSerializer.Meta):
        fields = ScheduleListSerializer.Meta.fields + ["participants"]


class ScheduleCreateUpdateSerializer(serializers.ModelSerializer):
    """공유 일정 생성/수정 serializer.

    participant_ids는 실제 Schedule 필드가 아니라 공유 대상 사용자 id 목록입니다.
    create()/update()에서 ScheduleParticipant를 생성하고, 개인 일정 관련 입력은
    무시하거나 공유 일정 필드로 변환합니다.
    """

    content = serializers.CharField(source="description", required=False, allow_blank=True)
    schedule_type = serializers.CharField(source="category", required=False, allow_blank=True)
    remind_at = serializers.DateTimeField(source="alert_at", required=False, allow_null=True)
    participant_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        write_only=True,
        help_text="일정을 공유할 사용자 id 목록",
    )
    is_shared = serializers.BooleanField(required=False, write_only=True)
    is_all_day = serializers.BooleanField(required=False, write_only=True)
    repeat_type = serializers.CharField(required=False, write_only=True)

    class Meta:
        model = Schedule
        fields = [
            "title",
            "description",
            "content",
            "category",
            "schedule_type",
            "start_at",
            "end_at",
            "location",
            "is_shared",
            "alert_at",
            "remind_at",
            "color",
            "is_all_day",
            "repeat_type",
            "participant_ids",
        ]
        extra_kwargs = {
            "category": {"required": False, "allow_blank": True},
            "end_at": {"required": False, "allow_null": True},
        }

    def validate(self, attrs):
        """종료일시가 시작일시보다 앞서지 않게 검증합니다."""
        start_at = attrs.get("start_at", getattr(self.instance, "start_at", None))
        end_at = attrs.get("end_at", getattr(self.instance, "end_at", None))
        if start_at and end_at and start_at > end_at:
            raise serializers.ValidationError("종료일시는 시작일시보다 늦어야 합니다.")
        return attrs

    def create(self, validated_data):
        """일정 생성 후 participant_ids를 참여자 테이블로 분리 저장합니다."""
        participant_ids = validated_data.pop("participant_ids", [])
        validated_data.pop("is_shared", None)
        validated_data.pop("is_all_day", None)
        validated_data.pop("repeat_type", None)
        schedule = Schedule.objects.create(created_by=self.context["request"].user, **validated_data)
        for user_id in participant_ids:
            ScheduleParticipant.objects.get_or_create(schedule=schedule, user_id=user_id)
        return schedule

    def update(self, instance, validated_data):
        """일정 본문 수정 후 participant_ids가 있으면 참여자 목록을 교체합니다."""
        participant_ids = validated_data.pop("participant_ids", None)
        validated_data.pop("is_shared", None)
        validated_data.pop("is_all_day", None)
        validated_data.pop("repeat_type", None)
        instance = super().update(instance, validated_data)
        if participant_ids is not None:
            instance.participants.exclude(user_id__in=participant_ids).delete()
            for user_id in participant_ids:
                ScheduleParticipant.objects.get_or_create(schedule=instance, user_id=user_id)
        return instance


class ScheduleResponseSerializer(serializers.ModelSerializer):
    """참여자의 참석 응답만 수정하는 serializer."""

    class Meta:
        model = ScheduleParticipant
        fields = ["response"]


class ScheduleReminderSerializer(serializers.ModelSerializer):
    """일정 알림 시간만 수정하는 serializer."""

    class Meta:
        model = Schedule
        fields = ["alert_at"]


class CalendarScheduleSerializer(ScheduleListSerializer):
    """캘린더 화면에서 일정 목록 형식을 재사용하기 위한 serializer."""

    pass


class CalendarMoveSerializer(serializers.ModelSerializer):
    """드래그 이동 결과로 start_at/end_at만 수정하는 serializer."""

    class Meta:
        model = Schedule
        fields = ["start_at", "end_at"]


class CalendarColorSerializer(serializers.ModelSerializer):
    """캘린더 색상만 수정하는 serializer."""

    class Meta:
        model = Schedule
        fields = ["color"]
