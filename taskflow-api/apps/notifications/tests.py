from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Notification


class NotificationApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user("noti", "noti@example.com", "StrongPass123!")
        self.client.force_authenticate(self.user)
        self.notification = Notification.objects.create(
            user=self.user,
            notification_type=Notification.Type.SYSTEM,
            title="테스트 알림",
            message="알림 내용",
        )

    def test_count_and_read_notification(self):
        count_response = self.client.get("/api/notifications/count/")
        self.assertEqual(count_response.status_code, status.HTTP_200_OK)
        self.assertEqual(count_response.data["data"]["unread_count"], 1)

        read_response = self.client.patch(f"/api/notifications/{self.notification.id}/read/", {}, format="json")
        self.assertEqual(read_response.status_code, status.HTTP_200_OK)
        self.notification.refresh_from_db()
        self.assertTrue(self.notification.is_read)
