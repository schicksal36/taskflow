"""[사용자] views.py - 사용자/인증 앱 뷰.

역할: 회원가입/로그인, 프로필 관리, 비밀번호 변경, 관리자 승격 API 처리
관련 모델: User, Profile, AdminApprovalRequest
관련 URL: /api/users/
작성기준: DRF APIView/Generic 기반, JWT 인증 필요 API와 공개 API 분리
"""

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from apps.common.responses import success_response

from .models import EmailVerificationCode
from .serializers import (
    AdminApprovalRejectSerializer,
    AdminApprovalRequestSerializer,
    EmailVerifyConfirmSerializer,
    EmailVerifySendSerializer,
    LoginSerializer,
    LogoutSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileSerializer,
    RegisterSerializer,
    UserListSerializer,
    UserRestoreSerializer,
    UserSerializer,
    UserUpdateSerializer,
)

User = get_user_model()


class RegisterView(generics.CreateAPIView):
    """회원가입 API.

    입력 검증과 실제 User/Profile 생성은 RegisterSerializer가 담당하고, View는
    성공 응답 형식과 HTTP 201 상태만 맞춥니다.
    """

    permission_classes = [permissions.AllowAny]
    serializer_class = RegisterSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return success_response(UserSerializer(user).data, "회원가입이 완료되었습니다.", status.HTTP_201_CREATED)


class UserListView(generics.ListAPIView):
    """담당자/승인자 선택에 사용하는 사용자 목록 API."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = UserListSerializer

    def get_queryset(self):
        """비활성 계정과 슈퍼유저는 업무 배정 대상에서 제외하고 대표이사는 수신자로 노출합니다."""
        return (
            User.objects.filter(is_active=True, is_superuser=False)
            .filter(Q(is_staff=False) | Q(role=User.UserRole.CEO))
            .order_by("username")
        )


class UserSearchView(UserListView):
    """담당자 선택용 사용자 검색 API."""

    def get_queryset(self):
        qs = super().get_queryset()
        keyword = self.request.query_params.get("q", "").strip()
        if not keyword:
            return qs[:20]
        return qs.filter(
            Q(first_name__icontains=keyword)
            | Q(email__icontains=keyword)
            | Q(department__icontains=keyword)
            | Q(position__icontains=keyword)
        )[:20]


def is_ceo(user):
    """사용자가 CEO 권한인지 확인합니다."""
    return getattr(user, "role", "") == User.UserRole.CEO


def is_admin_or_ceo(user):
    """사용자가 앱 관리자, CEO 또는 계정관리 전용 SUPERUSER 권한인지 확인합니다."""
    return getattr(user, "role", "") in {User.UserRole.ADMIN, User.UserRole.CEO, User.UserRole.SUPERUSER}


class AdminUserListView(generics.ListAPIView):
    """CEO/ADMIN/SUPERUSER용 전체 사용자 목록 API."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = UserListSerializer

    def get_queryset(self):
        if not is_admin_or_ceo(self.request.user):
            raise PermissionDenied("관리자 권한이 필요합니다.")
        return User.objects.filter(is_active=True, is_superuser=False).order_by("date_joined")


class AdminUserPromoteView(APIView):
    """CEO가 일반 사용자를 관리자로 직접 승격합니다."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk):
        if not is_ceo(request.user):
            raise PermissionDenied("대표이사만 처리할 수 있습니다.")
        user = generics.get_object_or_404(User, pk=pk, role=User.UserRole.USER)
        user.role = User.UserRole.ADMIN
        user.save(update_fields=["role"])
        return success_response(UserSerializer(user).data, "관리자로 승격했습니다.")


class AdminApprovalRequestListCreateView(generics.ListCreateAPIView):
    """관리자 승격 신청서 목록 조회/제출 API.

    POST는 일반 사용자 본인이 승격 신청서를 제출하고, GET은 CEO가 전체 신청서를
    조회합니다.
    """

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AdminApprovalRequestSerializer

    def get_queryset(self):
        if not is_ceo(self.request.user):
            raise PermissionDenied("대표이사만 조회할 수 있습니다.")
        from .models import AdminApprovalRequest

        return AdminApprovalRequest.objects.select_related("applicant", "reviewed_by").order_by("-created_at")

    def perform_create(self, serializer):
        if self.request.user.role != User.UserRole.USER:
            raise ValidationError("일반사용자만 승격 신청을 할 수 있습니다.")
        from .models import AdminApprovalRequest

        existing = AdminApprovalRequest.objects.filter(applicant=self.request.user).first()
        if existing:
            if existing.status == AdminApprovalRequest.Status.PENDING:
                raise ValidationError("이미 검토 중인 승격 신청이 있습니다.")
            existing.reason = serializer.validated_data["reason"]
            existing.experience = serializer.validated_data["experience"]
            existing.status = AdminApprovalRequest.Status.PENDING
            existing.reject_reason = ""
            existing.reviewed_at = None
            existing.reviewed_by = None
            existing.save(update_fields=["reason", "experience", "status", "reject_reason", "reviewed_at", "reviewed_by"])
            serializer.instance = existing
            return
        serializer.save(applicant=self.request.user)


class MyAdminApprovalRequestView(APIView):
    """내 관리자 승격 신청서를 조회합니다."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .models import AdminApprovalRequest

        approval = AdminApprovalRequest.objects.filter(applicant=request.user).first()
        data = AdminApprovalRequestSerializer(approval).data if approval else None
        return Response(
            {
                "success": True,
                "code": status.HTTP_200_OK,
                "message": "성공",
                "data": data,
            },
            status=status.HTTP_200_OK,
        )


class AdminApprovalRequestDetailView(generics.RetrieveAPIView):
    """CEO가 관리자 승격 신청서 상세를 조회합니다."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AdminApprovalRequestSerializer

    def get_queryset(self):
        if not is_ceo(self.request.user):
            raise PermissionDenied("대표이사만 조회할 수 있습니다.")
        from .models import AdminApprovalRequest

        return AdminApprovalRequest.objects.select_related("applicant", "reviewed_by")


class AdminApprovalRequestApproveView(APIView):
    """CEO가 관리자 승격 신청을 승인합니다."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk):
        if not is_ceo(request.user):
            raise PermissionDenied("대표이사만 승인할 수 있습니다.")
        from .models import AdminApprovalRequest

        approval = generics.get_object_or_404(AdminApprovalRequest, pk=pk)
        approval.status = AdminApprovalRequest.Status.APPROVED
        approval.reviewed_at = timezone.now()
        approval.reviewed_by = request.user
        approval.reject_reason = ""
        approval.save(update_fields=["status", "reviewed_at", "reviewed_by", "reject_reason"])
        approval.applicant.role = User.UserRole.ADMIN
        approval.applicant.save(update_fields=["role"])
        return success_response(AdminApprovalRequestSerializer(approval).data, "관리자 승격을 승인했습니다.")


class AdminApprovalRequestRejectView(APIView):
    """CEO가 관리자 승격 신청을 거절합니다."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk):
        if not is_ceo(request.user):
            raise PermissionDenied("대표이사만 거절할 수 있습니다.")
        from .models import AdminApprovalRequest

        approval = generics.get_object_or_404(AdminApprovalRequest, pk=pk)
        serializer = AdminApprovalRejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        approval.status = AdminApprovalRequest.Status.REJECTED
        approval.reject_reason = serializer.validated_data["reject_reason"]
        approval.reviewed_at = timezone.now()
        approval.reviewed_by = request.user
        approval.save(update_fields=["status", "reject_reason", "reviewed_at", "reviewed_by"])
        return success_response(AdminApprovalRequestSerializer(approval).data, "관리자 승격을 거절했습니다.")


class LoginView(APIView):
    """JWT 로그인 API."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return success_response(serializer.validated_data, "로그인되었습니다.")


class LogoutView(APIView):
    """JWT 로그아웃 API.

    refresh token을 blacklist 처리해 이후 access token 재발급에 사용할 수 없게 합니다.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyInfoView(APIView):
    """내 계정 조회/수정/탈퇴 API."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return success_response(UserSerializer(request.user).data)

    def patch(self, request):
        serializer = UserUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(UserSerializer(request.user).data, "내 정보가 수정되었습니다.")

    def delete(self, request):
        """탈퇴는 이력 보존을 위해 실제 삭제 대신 soft_delete()를 사용합니다."""
        request.user.soft_delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyProfileView(APIView):
    """내 프로필 조회/수정 API.

    multipart 요청을 허용해 일반 텍스트 필드와 이미지 필드를 같은 serializer로
    처리할 수 있습니다.
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        return success_response(ProfileSerializer(request.user.profile).data)

    def patch(self, request):
        serializer = ProfileSerializer(request.user.profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(serializer.data, "프로필이 수정되었습니다.")


class ProfileImageUpdateView(APIView):
    """프로필 이미지만 교체하는 전용 API."""

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def patch(self, request):
        serializer = UserUpdateSerializer(request.user, data={"profile_image": request.data.get("profile_image")}, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(serializer.data, "프로필 이미지가 수정되었습니다.")


class EmailVerifySendView(APIView):
    """이메일 인증번호 발급 API.

    현재 개발 흐름에서는 dev_code를 응답에 포함합니다. 실제 운영에서는 이 값을
    응답에서 제거하고 이메일 발송 작업으로 넘기는 방식으로 바꾸면 됩니다.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = EmailVerifySendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        code = serializer.save()
        return success_response({"dev_code": code.code}, "이메일 인증번호가 발급되었습니다.", status.HTTP_201_CREATED)


class EmailVerifyConfirmView(APIView):
    """이메일 인증번호 확인 API."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = EmailVerifyConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(message="이메일 인증이 완료되었습니다.")


class PasswordResetRequestView(APIView):
    """비밀번호 재설정 코드 발급 API."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        code = serializer.save()
        return success_response({"dev_code": code.code}, "비밀번호 재설정 인증번호가 발급되었습니다.", status.HTTP_201_CREATED)


class PasswordResetConfirmView(APIView):
    """재설정 코드 확인 후 새 비밀번호를 저장하는 API."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(message="비밀번호가 재설정되었습니다.")


class PasswordChangeView(APIView):
    """로그인 사용자의 비밀번호 변경 API."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(message="비밀번호가 변경되었습니다.")


class UserRestoreRequestView(APIView):
    """탈퇴/비활성 계정 복구 코드 발급 API."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = request.data.get("email")
        if not email:
            return Response({"email": ["이 필드는 필수입니다."]}, status=status.HTTP_400_BAD_REQUEST)
        code = EmailVerificationCode.issue(email, EmailVerificationCode.Purpose.ACCOUNT_RESTORE)
        return success_response({"dev_code": code.code}, "계정 복구 인증번호가 발급되었습니다.", status.HTTP_201_CREATED)


class UserRestoreView(APIView):
    """복구 코드 확인 후 계정을 다시 활성화하는 API."""

    permission_classes = [permissions.AllowAny]

    def patch(self, request):
        serializer = UserRestoreSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(message="계정이 복구되었습니다.")

