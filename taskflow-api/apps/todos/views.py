"""할 일과 체크리스트 API View.

개인 Todo CRUD, 상태/마감/우선순위 단일 변경, 완료 처리, 오늘/마감임박/기한초과
필터, 체크리스트 항목 관리를 제공합니다.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework import generics, permissions
from rest_framework.views import APIView

from apps.common.models import Priority
from apps.common.responses import success_response

from .models import Todo, TodoItem
from .serializers import (
    TodoCreateUpdateSerializer,
    TodoDeadlineSerializer,
    TodoDetailSerializer,
    TodoItemSerializer,
    TodoListSerializer,
    TodoPrioritySerializer,
    TodoStatusSerializer,
)


class TodoQuerysetMixin:
    """Todo API 공통 조회 믹스인.

    할 일은 개인 데이터이므로 모든 조회는 request.user 기준으로 제한합니다.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """현재 로그인 사용자의 Todo만 반환합니다."""
        return Todo.objects.filter(user=self.request.user)

    def get_todo(self, pk):
        """현재 사용자 소유 Todo 안에서만 단건을 찾습니다."""
        return generics.get_object_or_404(Todo.objects.filter(user=self.request.user), pk=pk)


class TodoListCreateView(TodoQuerysetMixin, generics.ListCreateAPIView):
    """할 일 목록 조회와 생성 API."""

    search_fields = ["title", "content"]
    filterset_fields = {
        "status": ["exact"],
        "priority": ["exact"],
        "deadline_at": ["date", "gte", "lte"],
    }
    ordering_fields = ["deadline_at", "created_at", "priority"]

    def get_serializer_class(self):
        return TodoCreateUpdateSerializer if self.request.method == "POST" else TodoListSerializer


class TodoDetailUpdateDeleteView(TodoQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """할 일 상세 조회, 수정, 삭제 API."""

    def get_serializer_class(self):
        if self.request.method in {"PATCH", "PUT"}:
            return TodoCreateUpdateSerializer
        return TodoDetailSerializer


class TodoFieldUpdateView(TodoQuerysetMixin, APIView):
    """status/deadline/priority 단일 필드 수정 API의 공통 부모."""

    serializer_class = None

    def patch(self, request, pk):
        todo = self.get_todo(pk)
        serializer = self.serializer_class(todo, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(TodoDetailSerializer(todo).data, "할일이 수정되었습니다.")


class TodoStatusView(TodoFieldUpdateView):
    """할 일 상태 변경 API."""

    serializer_class = TodoStatusSerializer


class TodoDeadlineView(TodoFieldUpdateView):
    """할 일 마감일 변경 API."""

    serializer_class = TodoDeadlineSerializer


class TodoPriorityView(TodoFieldUpdateView):
    """할 일 우선순위 변경 API."""

    serializer_class = TodoPrioritySerializer


class TodoCompleteView(TodoQuerysetMixin, APIView):
    """할 일을 완료 처리하고 완료 시각을 기록합니다."""

    def patch(self, request, pk):
        todo = self.get_todo(pk)
        todo.status = Todo.Status.DONE
        todo.completed_at = timezone.now()
        todo.save(update_fields=["status", "completed_at"])
        return success_response(TodoDetailSerializer(todo).data, "할일을 완료했습니다.")


class TodoCancelCompleteView(TodoQuerysetMixin, APIView):
    """완료 처리된 할 일을 다시 TODO 상태로 되돌립니다."""

    def patch(self, request, pk):
        todo = self.get_todo(pk)
        todo.status = Todo.Status.TODO
        todo.completed_at = None
        todo.save(update_fields=["status", "completed_at"])
        return success_response(TodoDetailSerializer(todo).data, "완료를 취소했습니다.")


class TodayTodoListView(TodoQuerysetMixin, generics.ListAPIView):
    """오늘 생성했거나 오늘 마감인 할 일을 조회합니다."""

    serializer_class = TodoListSerializer

    def get_queryset(self):
        today = timezone.localdate()
        return super().get_queryset().filter(
            created_at__date=today,
        ) | super().get_queryset().filter(deadline_at__date=today)


class DoingTodoListView(TodoQuerysetMixin, generics.ListAPIView):
    """진행중 상태 할 일 목록."""

    serializer_class = TodoListSerializer

    def get_queryset(self):
        return super().get_queryset().filter(status=Todo.Status.DOING)


class DoneTodoListView(TodoQuerysetMixin, generics.ListAPIView):
    """완료 상태 할 일 목록."""

    serializer_class = TodoListSerializer

    def get_queryset(self):
        return super().get_queryset().filter(status=Todo.Status.DONE)


class ImportantTodoListView(TodoQuerysetMixin, generics.ListAPIView):
    """높음/긴급 우선순위 할 일 목록."""

    serializer_class = TodoListSerializer

    def get_queryset(self):
        return super().get_queryset().filter(priority__in=[Priority.HIGH, Priority.URGENT])


class TodoDueSoonView(TodoQuerysetMixin, generics.ListAPIView):
    """현재부터 3일 안에 마감되는 할 일 목록."""

    serializer_class = TodoListSerializer

    def get_queryset(self):
        now = timezone.now()
        return super().get_queryset().filter(deadline_at__gte=now, deadline_at__lte=now + timedelta(days=3))


class OverdueTodoListView(TodoQuerysetMixin, generics.ListAPIView):
    """마감일이 지났고 아직 DONE이 아닌 할 일 목록."""

    serializer_class = TodoListSerializer

    def get_queryset(self):
        return super().get_queryset().filter(deadline_at__lt=timezone.now()).exclude(status=Todo.Status.DONE)


class TodoSearchView(TodoListCreateView):
    """할 일 검색 API. 제목과 본문을 검색합니다."""

    pass


class TodoItemListCreateView(TodoQuerysetMixin, generics.ListCreateAPIView):
    """체크리스트 항목 목록/생성 API."""

    serializer_class = TodoItemSerializer

    def get_queryset(self):
        todo = self.get_todo(self.kwargs["pk"])
        return TodoItem.objects.filter(todo=todo)

    def perform_create(self, serializer):
        todo = self.get_todo(self.kwargs["pk"])
        serializer.save(todo=todo)


class TodoItemDetailView(TodoQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """체크리스트 항목 상세/수정/삭제 API."""

    serializer_class = TodoItemSerializer
    lookup_url_kwarg = "item_id"

    def get_queryset(self):
        return TodoItem.objects.filter(todo__user=self.request.user)


class TodoItemCheckView(TodoQuerysetMixin, APIView):
    """체크리스트 항목 체크/체크취소 공통 API.

    하위 클래스에서 checked 값을 바꿔 같은 로직으로 check와 uncheck를 처리합니다.
    """

    checked = True

    def patch(self, request, item_id):
        item = generics.get_object_or_404(TodoItem, pk=item_id, todo__user=request.user)
        item.is_checked = self.checked
        item.checked_at = timezone.now() if self.checked else None
        item.save(update_fields=["is_checked", "checked_at"])
        return success_response(TodoItemSerializer(item).data, "체크 상태가 변경되었습니다.")


class TodoItemUncheckView(TodoItemCheckView):
    """체크리스트 항목 체크 취소 API."""

    checked = False
