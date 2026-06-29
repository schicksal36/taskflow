"""알림 API의 serializer."""

from rest_framework import serializers

from .models import Notification, NotificationSetting


class NotificationSerializer(serializers.ModelSerializer):
    """알림 목록/상세 응답 serializer."""

    class Meta:
        model = Notification
        fields = [
            "id",
            "notification_type",
            "title",
            "message",
            "target_type",
            "target_id",
            "is_read",
            "created_at",
        ]


class NotificationSettingSerializer(serializers.ModelSerializer):
    """알림 설정 조회/수정 serializer."""

    class Meta:
        model = NotificationSetting
        fields = [
            "work_request_enabled",
            "todo_enabled",
            "schedule_enabled",
            "board_enabled",
            "report_enabled",
            "email_enabled",
            "realtime_enabled",
        ]


class NotificationCountSerializer(serializers.Serializer):
    """읽지 않은 알림 수 응답 serializer."""

    unread_count = serializers.IntegerField()
