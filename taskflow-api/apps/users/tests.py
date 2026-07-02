from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase


class UserApiTests(APITestCase):
    """회원 API 테스트.

    테스트는 사람이 브라우저에서 버튼을 누르는 일을 코드로 대신 해보는 것입니다.
    회원가입 버튼, 로그인 버튼, 내 정보 보기 버튼을 차례대로 눌러보는 식입니다.
    """

    def test_register_login_and_me(self):
        register_response = self.client.post(
            "/api/users/register/",
            {
                "email": "worker1@example.com",
                "password": "StrongPass123!",
                "password_confirm": "StrongPass123!",
            },
            format="json",
        )
        self.assertEqual(register_response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(register_response.data["success"])

        login_response = self.client.post(
            "/api/users/login/",
            {"email": "worker1@example.com", "password": "StrongPass123!"},
            format="json",
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        access = login_response.data["data"]["access"]

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        me_response = self.client.get("/api/users/me/")
        self.assertEqual(me_response.status_code, status.HTTP_200_OK)
        self.assertEqual(me_response.data["data"]["username"], "worker1@example.com")

    def test_password_reset_request_with_registered_email(self):
        User = get_user_model()
        User.objects.create_user(
            username="reset@example.com",
            email="reset@example.com",
            password="StrongPass123!",
        )

        response = self.client.post(
            "/api/users/password/reset/",
            {"email": "reset@example.com"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("dev_code", response.data["data"])

    def test_email_verify_flow_returns_dev_code(self):
        User = get_user_model()
        User.objects.create_user(username="mailuser", email="mailuser@example.com", password="StrongPass123!")

        send_response = self.client.post(
            "/api/users/email/verify/",
            {"email": "mailuser@example.com"},
            format="json",
        )
        self.assertEqual(send_response.status_code, status.HTTP_201_CREATED)
        code = send_response.data["data"]["dev_code"]

        confirm_response = self.client.post(
            "/api/users/email/verify/confirm/",
            {"email": "mailuser@example.com", "code": code},
            format="json",
        )
        self.assertEqual(confirm_response.status_code, status.HTTP_200_OK)
        self.assertTrue(User.objects.get(username="mailuser").is_email_verified)

    def test_admin_approval_request_and_ceo_approve(self):
        User = get_user_model()
        applicant = User.objects.create_user(
            username="applicant@example.com",
            email="applicant@example.com",
            password="StrongPass123!",
            role=User.UserRole.USER,
        )
        ceo = User.objects.create_user(
            username="ceo@example.com",
            email="ceo@example.com",
            password="StrongPass123!",
            role=User.UserRole.CEO,
        )

        self.client.force_authenticate(applicant)
        create_response = self.client.post(
            "/api/users/admin/approval-requests/",
            {"reason": "관리 기능이 필요합니다.", "experience": "팀 운영 경험이 있습니다."},
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(ceo)
        approve_response = self.client.patch(
            f"/api/users/admin/approval-requests/{create_response.data['id']}/approve/",
            {},
            format="json",
        )
        self.assertEqual(approve_response.status_code, status.HTTP_200_OK)
        applicant.refresh_from_db()
        self.assertEqual(applicant.role, User.UserRole.ADMIN)

    def test_my_admin_approval_request_returns_null_when_missing(self):
        User = get_user_model()
        user = User.objects.create_user(
            username="no-approval@example.com",
            email="no-approval@example.com",
            password="StrongPass123!",
            role=User.UserRole.USER,
        )

        self.client.force_authenticate(user)
        response = self.client.get("/api/users/admin/approval-requests/my/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["data"])

    def test_superuser_can_login_and_view_account_management(self):
        User = get_user_model()
        superuser = User.objects.create_superuser(
            username="super@example.com",
            email="super@example.com",
            password="StrongPass123!",
        )
        User.objects.create_user(
            username="managed@example.com",
            email="managed@example.com",
            password="StrongPass123!",
        )

        login_response = self.client.post(
            "/api/users/login/",
            {"email": "super@example.com", "password": "StrongPass123!"},
            format="json",
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        self.assertEqual(login_response.data["data"]["user"]["role"], User.UserRole.SUPERUSER)

        self.client.force_authenticate(superuser)
        list_response = self.client.get("/api/users/admin/users/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["email"] for item in list_response.data], ["managed@example.com"])

    def test_profile_patch_accepts_json(self):
        User = get_user_model()
        user = User.objects.create_user(
            username="profile-json@example.com",
            email="profile-json@example.com",
            password="StrongPass123!",
        )

        self.client.force_authenticate(user)
        response = self.client.patch(
            "/api/users/me/profile/",
            {"bio": "JSON으로 수정한 소개입니다."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["bio"], "JSON으로 수정한 소개입니다.")

    def test_my_info_patch_accepts_hire_date(self):
        User = get_user_model()
        user = User.objects.create_user(
            username="hire-date@example.com",
            email="hire-date@example.com",
            password="StrongPass123!",
        )

        self.client.force_authenticate(user)
        response = self.client.patch("/api/users/me/", {"hire_date": "2026-07-01"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertEqual(str(user.hire_date), "2026-07-01")
        self.assertEqual(response.data["data"]["hire_date"], "2026-07-01")

    def test_ceo_role_save_sets_position_and_staff(self):
        User = get_user_model()
        ceo = User.objects.create_user(
            username="ceo-role@example.com",
            email="ceo-role@example.com",
            password="StrongPass123!",
            role=User.UserRole.CEO,
            position="",
        )

        self.assertEqual(ceo.role, User.UserRole.CEO)
        self.assertEqual(ceo.position, "대표이사")
        self.assertTrue(ceo.is_staff)

    def test_user_search_includes_ceo_recipient_card(self):
        User = get_user_model()
        requester = User.objects.create_user(
            username="requester@example.com",
            email="requester@example.com",
            password="StrongPass123!",
        )
        ceo = User.objects.create_user(
            username="ceo-search@example.com",
            email="ceo-search@example.com",
            password="StrongPass123!",
            first_name="김대표",
            role=User.UserRole.CEO,
        )
        superuser = User.objects.create_superuser(
            username="root-search@example.com",
            email="root-search@example.com",
            password="StrongPass123!",
        )

        self.client.force_authenticate(requester)
        response = self.client.get("/api/users/search/", {"q": "대표"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        emails = [item["email"] for item in response.data]
        self.assertIn(ceo.email, emails)
        self.assertNotIn(superuser.email, emails)

    def test_normal_user_cannot_self_assign_ceo_position(self):
        User = get_user_model()
        user = User.objects.create_user(
            username="normal-position@example.com",
            email="normal-position@example.com",
            password="StrongPass123!",
        )

        self.client.force_authenticate(user)
        response = self.client.patch("/api/users/me/", {"position": "대표이사"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        user.refresh_from_db()
        self.assertNotEqual(user.position, "대표이사")
