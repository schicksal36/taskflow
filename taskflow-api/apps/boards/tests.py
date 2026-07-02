from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from .models import BoardComment, BoardLike, BoardPost


class BoardApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.author = User.objects.create_user("author", "author@example.com", "StrongPass123!")
        self.reader = User.objects.create_user("reader", "reader@example.com", "StrongPass123!")
        self.admin = User.objects.create_user("admin", "admin@example.com", "StrongPass123!", role=User.UserRole.ADMIN)

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

    def test_admin_can_update_and_delete_other_users_post(self):
        post = BoardPost.objects.create(
            author=self.author,
            board_type=BoardPost.BoardType.DATA_ROOM,
            title="관리자 삭제 대상",
            content="관리자는 삭제만 가능합니다.",
        )

        self.client.force_authenticate(self.admin)
        update_response = self.client.patch(
            f"/api/boards/posts/{post.id}/",
            {"title": "관리자가 수정"},
            format="json",
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)

        delete_response = self.client.delete(f"/api/boards/posts/{post.id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        post.refresh_from_db()
        self.assertTrue(post.is_deleted)

    def test_data_room_comments_are_disabled(self):
        post = BoardPost.objects.create(
            author=self.author,
            board_type=BoardPost.BoardType.DATA_ROOM,
            title="자료",
            content="자료실 댓글은 사용하지 않습니다.",
        )

        self.client.force_authenticate(self.reader)
        response = self.client.post(
            f"/api/boards/posts/{post.id}/comments/",
            {"content": "댓글"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(BoardComment.objects.filter(post=post).exists())

    def test_freeboard_alias_creates_free_post(self):
        self.client.force_authenticate(self.author)
        response = self.client.post(
            "/api/freeboard/",
            {"title": "자유 글", "content": "자유롭게 공유합니다."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(BoardPost.objects.filter(title="자유 글", board_type=BoardPost.BoardType.FREE).exists())
