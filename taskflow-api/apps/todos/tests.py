from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Todo, TodoItem


class TodoApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user("todoer", "todoer@example.com", "StrongPass123!")
        self.client.force_authenticate(self.user)

    def test_create_todo_item_and_complete(self):
        create_response = self.client.post(
            "/api/todos/",
            {
                "title": "오늘 보고서 작성",
                "content": "퇴근 전까지 작성",
                "priority": "URGENT",
                "deadline_at": (timezone.now() + timezone.timedelta(hours=2)).isoformat(),
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        todo = Todo.objects.get(title="오늘 보고서 작성")

        item_response = self.client.post(
            f"/api/todos/{todo.id}/items/",
            {"content": "자료 모으기", "sort_order": 1},
            format="json",
        )
        self.assertEqual(item_response.status_code, status.HTTP_201_CREATED)
        item = TodoItem.objects.get(todo=todo)

        check_response = self.client.patch(f"/api/todos/items/{item.id}/check/", {}, format="json")
        self.assertEqual(check_response.status_code, status.HTTP_200_OK)
        item.refresh_from_db()
        self.assertTrue(item.is_checked)

        complete_response = self.client.patch(f"/api/todos/{todo.id}/complete/", {}, format="json")
        self.assertEqual(complete_response.status_code, status.HTTP_200_OK)
        todo.refresh_from_db()
        self.assertEqual(todo.status, Todo.Status.DONE)

    def test_create_todo_defaults_deadline_to_today(self):
        response = self.client.post(
            "/api/todos/",
            {
                "title": "오늘 할일",
                "content": "마감일을 생략하면 오늘로 저장",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        todo = Todo.objects.get(title="오늘 할일")
        self.assertIsNotNone(todo.deadline_at)
        self.assertEqual(timezone.localtime(todo.deadline_at).date(), timezone.localdate())

    def test_search_todos_with_filters(self):
        deadline = timezone.now() + timezone.timedelta(days=1)
        matching = Todo.objects.create(
            user=self.user,
            title="보고서 검토",
            content="월간 자료 확인",
            status=Todo.Status.DOING,
            priority="HIGH",
            deadline_at=deadline,
        )
        Todo.objects.create(
            user=self.user,
            title="보고서 초안",
            status=Todo.Status.TODO,
            priority="HIGH",
            deadline_at=deadline,
        )
        Todo.objects.create(
            user=self.user,
            title="회의 준비",
            status=Todo.Status.DOING,
            priority="NORMAL",
            deadline_at=deadline,
        )

        response = self.client.get(
            "/api/todos/search/",
            {
                "search": "보고서",
                "status": Todo.Status.DOING,
                "priority": "HIGH",
                "deadline_at__date": timezone.localdate(deadline).isoformat(),
            },
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [todo["id"] for todo in response.data]
        self.assertEqual(ids, [matching.id])
