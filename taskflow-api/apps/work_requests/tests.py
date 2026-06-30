from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.todos.models import Todo

from .models import WorkRequest


class WorkRequestApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.requester = User.objects.create_user("requester", "requester@example.com", "StrongPass123!")
        self.assignee = User.objects.create_user("assignee", "assignee@example.com", "StrongPass123!")
        self.second_assignee = User.objects.create_user("assignee2", "assignee2@example.com", "StrongPass123!")

    def test_create_complete_and_approve_work_request(self):
        self.requester.first_name = "김정훈"
        self.requester.department = "개발팀"
        self.requester.position = "과장"
        self.requester.save(update_fields=["first_name", "department", "position"])
        self.assignee.first_name = "부평맛남"
        self.assignee.department = "운영팀"
        self.assignee.position = "대표이사"
        self.assignee.save(update_fields=["first_name", "department", "position"])
        self.client.force_authenticate(self.requester)
        create_response = self.client.post(
            "/api/work-requests/",
            {
                "title": "견적서 정리",
                "content": "금요일까지 견적서를 정리해주세요.",
                "assignee": self.assignee.id,
                "priority": "HIGH",
                "deadline_at": (timezone.now() + timezone.timedelta(days=1)).isoformat(),
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        work = WorkRequest.objects.get(title="견적서 정리")
        self.assertEqual(create_response.data["id"], work.id)
        self.assertEqual(work.status, WorkRequest.Status.PENDING)

        list_response = self.client.get("/api/work-requests/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(list_response.data[0]["content"], "금요일까지 견적서를 정리해주세요.")
        self.assertEqual(list_response.data[0]["requester_name"], "김정훈 (개발팀 / 과장)")
        self.assertEqual(list_response.data[0]["assignee_name"], "부평맛남 (운영팀 / 대표이사)")
        self.assertEqual(list_response.data[0]["assignee_names"], ["부평맛남 (운영팀 / 대표이사)"])

        self.client.force_authenticate(self.assignee)
        accept_response = self.client.patch(f"/api/work-requests/{work.id}/accept/", {}, format="json")
        self.assertEqual(accept_response.status_code, status.HTTP_200_OK)
        work.refresh_from_db()
        self.assertEqual(work.status, WorkRequest.Status.ACCEPTED)
        self.assertTrue(Todo.objects.filter(user=self.assignee, title=work.title).exists())

        self.client.force_authenticate(self.assignee)
        complete_response = self.client.patch(f"/api/work-requests/{work.id}/complete/", {}, format="json")
        self.assertEqual(complete_response.status_code, status.HTTP_200_OK)
        work.refresh_from_db()
        self.assertEqual(work.status, WorkRequest.Status.COMPLETED)

        self.client.force_authenticate(self.requester)
        approve_response = self.client.patch(f"/api/work-requests/{work.id}/approve/", {}, format="json")
        self.assertEqual(approve_response.status_code, status.HTTP_200_OK)
        work.refresh_from_db()
        self.assertEqual(work.status, WorkRequest.Status.APPROVED)

    def test_create_work_request_accepts_manual_assignee_input(self):
        self.client.force_authenticate(self.requester)
        create_response = self.client.post(
            "/api/work-requests/",
            {
                "title": "수기 담당자 업무",
                "content": "담당자를 이메일로 직접 입력합니다.",
                "assignee_input": self.assignee.email,
                "priority": "NORMAL",
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        work = WorkRequest.objects.get(title="수기 담당자 업무")
        self.assertEqual(work.assignee, self.assignee)

    def test_only_assignee_can_patch_work_request_status(self):
        self.client.force_authenticate(self.requester)
        create_response = self.client.post(
            "/api/work-requests/",
            {
                "title": "상태 변경 권한",
                "content": "담당자만 상태를 바꿀 수 있습니다.",
                "assignee": self.assignee.id,
                "priority": "NORMAL",
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        work = WorkRequest.objects.get(title="상태 변경 권한")

        requester_response = self.client.patch(
            f"/api/work-requests/{work.id}/status/",
            {"status": WorkRequest.Status.IN_PROGRESS},
            format="json",
        )
        self.assertEqual(requester_response.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(self.assignee)
        assignee_response = self.client.patch(
            f"/api/work-requests/{work.id}/status/",
            {"status": WorkRequest.Status.IN_PROGRESS},
            format="json",
        )
        self.assertEqual(assignee_response.status_code, status.HTTP_200_OK)
        work.refresh_from_db()
        self.assertEqual(work.status, WorkRequest.Status.IN_PROGRESS)

    def test_create_work_request_accepts_multiple_assignees(self):
        self.client.force_authenticate(self.requester)
        create_response = self.client.post(
            "/api/work-requests/",
            {
                "title": "다중 담당자 업무",
                "content": "담당자를 여러 명 지정합니다.",
                "assignee_ids": [self.assignee.id],
                "assignee_inputs": [self.second_assignee.email],
                "priority": "HIGH",
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        work = WorkRequest.objects.get(title="다중 담당자 업무")
        self.assertEqual(work.assignee, self.assignee)
        self.assertEqual(set(work.assignees.values_list("id", flat=True)), {self.assignee.id, self.second_assignee.id})

        self.client.force_authenticate(self.second_assignee)
        accept_response = self.client.patch(f"/api/work-requests/{work.id}/accept/", {}, format="json")
        self.assertEqual(accept_response.status_code, status.HTTP_200_OK)
        self.assertTrue(Todo.objects.filter(user=self.second_assignee, title=work.title).exists())

    def test_create_work_request_rejects_self_assignee(self):
        self.client.force_authenticate(self.requester)
        create_response = self.client.post(
            "/api/work-requests/",
            {
                "title": "셀프 업무요청 차단",
                "content": "자기 자신에게 요청할 수 없습니다.",
                "assignee_ids": [self.requester.id],
                "priority": "NORMAL",
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(WorkRequest.objects.filter(title="셀프 업무요청 차단").exists())

    def test_create_work_request_rejects_self_manual_assignee(self):
        self.client.force_authenticate(self.requester)
        create_response = self.client.post(
            "/api/work-requests/",
            {
                "title": "셀프 수기 업무요청 차단",
                "content": "자기 자신 이메일 입력도 막습니다.",
                "assignee_inputs": [self.requester.email],
                "priority": "NORMAL",
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(WorkRequest.objects.filter(title="셀프 수기 업무요청 차단").exists())

    def test_create_work_request_allows_blank_deadline(self):
        self.client.force_authenticate(self.requester)
        create_response = self.client.post(
            "/api/work-requests/",
            {
                "title": "마감일 없는 업무",
                "content": "마감일 없이 등록합니다.",
                "assignee": self.assignee.id,
                "priority": "NORMAL",
                "deadline_at": None,
                "due_date": None,
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        work = WorkRequest.objects.get(title="마감일 없는 업무")
        self.assertIsNone(work.deadline_at)
