from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from .models import BoardComment, BoardLike, BoardPost


class BoardApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.author = User.objects.create_user("author", "author@example.com", "StrongPass123!")
        self.reader = User.objects.create_user("reader", "reader@example.com", "StrongPass123!")

    def test_create_post_returns_id_for_follow_up_actions(self):
        self.client.force_authenticate(self.author)
        response = self.client.post(
            "/api/boards/posts/",
            {"board_type": "FREE", "title": "업무 공유", "content": "오늘 배운 내용을 공유합니다."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("id", response.data)
        self.assertIsInstance(response.data["id"], int)

    def test_post_comment_and_like(self):
        self.client.force_authenticate(self.author)
        post_response = self.client.post(
            "/api/boards/posts/",
            {"board_type": "FREE", "title": "업무 공유", "content": "오늘 배운 내용을 공유합니다."},
            format="json",
        )
        self.assertEqual(post_response.status_code, status.HTTP_201_CREATED)
        post = BoardPost.objects.get(title="업무 공유")

        self.client.force_authenticate(self.reader)
        comment_response = self.client.post(
            f"/api/boards/posts/{post.id}/comments/",
            {"content": "좋은 공유 감사합니다."},
            format="json",
        )
        self.assertEqual(comment_response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(BoardComment.objects.filter(post=post, author=self.reader).exists())

        like_response = self.client.post(f"/api/boards/posts/{post.id}/like/", {}, format="json")
        self.assertEqual(like_response.status_code, status.HTTP_200_OK)
        self.assertTrue(BoardLike.objects.filter(post=post, user=self.reader).exists())
