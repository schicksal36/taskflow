"""할 일과 체크리스트 API의 serializer."""

from django.utils import timezone
from rest_framework import serializers

from .models import Todo, TodoItem


class TodoItemSerializer(serializers.ModelSerializer):
    """체크리스트 항목 serializer.

    todo는 URL의 상위 Todo에서 결정하고 checked_at은 체크/체크취소 API가 자동으로
    관리하므로 클라이언트 입력에서 제외합니다.
    """

    class Meta:
        model = TodoItem
        fields = ["id", "todo", "content", "is_checked", "checked_at", "sort_order"]
        read_only_fields = ["todo", "checked_at"]


class TodoListSerializer(serializers.ModelSerializer):
    """할 일 목록용 serializer.

    목록에서는 본문 전체 대신 체크리스트 개수(item_count)와 상태/마감 정보를 보여줍니다.
    """

    item_count = serializers.IntegerField(source="items.count", read_only=True)

    class Meta:
        model = Todo
        fields = [
            "id",
            "title",
            "status",
            "priority",
            "deadline_at",
            "remind_at",
            "completed_at",
            "item_count",
            "created_at",
            "updated_at",
        ]


class TodoDetailSerializer(TodoListSerializer):
    """할 일 상세 serializer. 본문과 체크리스트 항목을 함께 내려줍니다."""

    items = TodoItemSerializer(many=True, read_only=True)

    class Meta(TodoListSerializer.Meta):
        fields = TodoListSerializer.Meta.fields + ["content", "items"]


class TodoCreateUpdateSerializer(serializers.ModelSerializer):
    """할 일 생성/수정 serializer.

    생성 시 user는 request.user로 고정해 다른 사람의 할 일을 대신 만들 수 없게 합니다.
    """

    class Meta:
        model = Todo
        fields = [
            "id",
            "title",
            "content",
            "status",
            "priority",
            "deadline_at",
            "remind_at",
            "completed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "completed_at", "created_at", "updated_at"]

    def create(self, validated_data):
        validated_data.setdefault("deadline_at", default_deadline_at())
        return Todo.objects.create(user=self.context["request"].user, **validated_data)


class TodoStatusSerializer(serializers.ModelSerializer):
    """status 필드만 수정하는 serializer."""

    class Meta:
        model = Todo
        fields = ["status"]


class TodoDeadlineSerializer(serializers.ModelSerializer):
    """deadline_at 필드만 수정하는 serializer."""

    class Meta:
        model = Todo
        fields = ["deadline_at"]


class TodoPrioritySerializer(serializers.ModelSerializer):
    """priority 필드만 수정하는 serializer."""

    class Meta:
        model = Todo
        fields = ["priority"]


def default_deadline_at():
    """마감일을 생략한 새 할 일은 오늘 안에 끝나는 항목으로 봅니다."""
    return timezone.localtime().replace(hour=23, minute=59, second=59, microsecond=0)
