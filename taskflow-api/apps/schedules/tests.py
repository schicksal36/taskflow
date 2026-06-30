
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.todos.models import Todo

from .models import Schedule, ScheduleParticipant


class ScheduleApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user("owner", "owner@example.com", "StrongPass123!")
        self.owner.first_name = "김정훈"
        self.owner.department = "솔루션사업부"
        self.owner.position = "과장"
        self.owner.save(update_fields=["first_name", "department", "position"])
        self.member = User.objects.create_user("member", "member@example.com", "StrongPass123!")

    def test_create_shared_schedule_and_participant_response(self):
        self.client.force_authenticate(self.owner)
        start_at = timezone.now() + timezone.timedelta(days=1)
        create_response = self.client.post(
            "/api/schedules/",
            {
                "title": "주간 회의",
                "content": "업무 진행 상황 공유",
                "schedule_type": "MEETING",
                "start_at": start_at.isoformat(),
                "end_at": (start_at + timezone.timedelta(hours=1)).isoformat(),
                "participant_ids": [self.member.id],
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        schedule = Schedule.objects.get(title="주간 회의")
        self.assertEqual(schedule.created_by, self.owner)
        self.assertEqual(schedule.category, "MEETING")
        self.assertEqual(schedule.description, "업무 진행 상황 공유")
        self.assertTrue(ScheduleParticipant.objects.filter(schedule=schedule, user=self.member).exists())

        self.client.force_authenticate(self.member)
        response = self.client.patch(
            f"/api/schedules/{schedule.id}/response/",
            {"response": ScheduleParticipant.Response.ACCEPTED},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        participant = ScheduleParticipant.objects.get(schedule=schedule, user=self.member)
        self.assertEqual(participant.response, ScheduleParticipant.Response.ACCEPTED)

    def test_create_schedule_allows_blank_end_and_custom_type(self):
        self.client.force_authenticate(self.owner)
        start_at = timezone.now() + timezone.timedelta(days=1)

        response = self.client.post(
            "/api/schedules/",
            {
                "title": "거래처 미팅",
                "schedule_type": "현장 방문",
                "start_at": start_at.isoformat(),
                "end_at": None,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        schedule = Schedule.objects.get(title="거래처 미팅")
        self.assertEqual(schedule.category, "현장 방문")
        self.assertIsNone(schedule.end_at)

    def test_schedule_list_shows_other_users_events_without_edit_permission(self):
        start_at = timezone.now() + timezone.timedelta(days=1)
        schedule = Schedule.objects.create(
            created_by=self.owner,
            title="전체 캘린더 표시 일정",
            category="MEETING",
            start_at=start_at,
            end_at=start_at + timezone.timedelta(hours=1),
        )

        self.client.force_authenticate(self.member)
        list_response = self.client.get("/api/schedules/")

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertIn("전체 캘린더 표시 일정", [item["title"] for item in list_response.data])
        schedule_payload = next(item for item in list_response.data if item["id"] == schedule.id)
        self.assertEqual(schedule_payload["owner_name"], "김정훈")
        self.assertEqual(schedule_payload["owner_department"], "솔루션사업부")
        self.assertEqual(schedule_payload["owner_position"], "과장")
        self.assertEqual(schedule_payload["owner_email"], "owner@example.com")

        update_response = self.client.patch(
            f"/api/schedules/{schedule.id}/",
            {"title": "수정 시도"},
            format="json",
        )

        self.assertEqual(update_response.status_code, status.HTTP_404_NOT_FOUND)

    def test_integrated_calendar_returns_schedule_events(self):
        self.client.force_authenticate(self.owner)
        start_at = timezone.now() + timezone.timedelta(days=2)
        Schedule.objects.create(
            created_by=self.owner,
            title="달력 표시 일정",
            category="MEETING",
            start_at=start_at,
            end_at=start_at + timezone.timedelta(hours=1),
        )

        response = self.client.get("/api/calendar/integrated/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = [event["title"] for event in response.data["data"]]
        self.assertIn("달력 표시 일정", titles)

    def test_today_schedules_include_events_spanning_today(self):
        self.client.force_authenticate(self.owner)
        today = timezone.localdate()
        start_at = timezone.make_aware(timezone.datetime.combine(today - timezone.timedelta(days=1), timezone.datetime.min.time()))
        Schedule.objects.create(
            created_by=self.owner,
            title="오늘까지 이어지는 일정",
            category="WORK",
            start_at=start_at,
            end_at=start_at + timezone.timedelta(days=1, hours=12),
        )

        response = self.client.get("/api/schedules/today/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["title"] for item in response.data], ["오늘까지 이어지는 일정"])

    def test_google_calendar_subscription_feed_returns_ics(self):
        self.client.force_authenticate(self.owner)
        start_at = timezone.now() + timezone.timedelta(days=3)
        Schedule.objects.create(
            created_by=self.owner,
            title="구글 구독 일정",
            description="외부 캘린더 확인",
            category="MEETING",
            start_at=start_at,
            end_at=start_at + timezone.timedelta(hours=1),
        )
        Todo.objects.create(
            user=self.owner,
            title="구글 구독 할일",
            deadline_at=start_at + timezone.timedelta(days=1),
        )

        subscription_response = self.client.get("/api/schedules/google-calendar-subscription/")
        self.assertEqual(subscription_response.status_code, status.HTTP_200_OK)
        feed_url = subscription_response.data["data"]["feed_url"]
        token = feed_url.split("token=", 1)[1]

        self.client.force_authenticate(None)
        feed_response = self.client.get(f"/api/schedules/google-calendar.ics?token={token}")

        self.assertEqual(feed_response.status_code, status.HTTP_200_OK)
        self.assertEqual(feed_response["Content-Type"], "text/calendar; charset=utf-8")
        content = feed_response.content.decode()
        self.assertIn("BEGIN:VCALENDAR", content)
        self.assertIn("SUMMARY:구글 구독 일정", content)
        self.assertIn("SUMMARY:구글 구독 할일", content)
