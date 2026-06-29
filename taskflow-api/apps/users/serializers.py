"""[사용자] serializers.py - 사용자/인증 API 요청 검증과 응답 변환.

역할: 이메일 회원가입/로그인, 프로필 수정, 관리자 승격 신청 요청/응답 검증
관련 모델: User, Profile, AdminApprovalRequest, EmailVerificationCode, BiometricCredential
관련 URL: /api/users/
작성기준: DRF Serializer 기반, JWT 인증 View에서 사용
"""

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AdminApprovalRequest, BiometricCredential, EmailVerificationCode, Profile

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """내 정보/로그인 응답에서 사용하는 사용자 기본 정보 serializer."""

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "department",
            "position",
            "profile_image",
            "role",
            "is_email_verified",
            "is_active",
            "date_joined",
        ]
        read_only_fields = ["id", "is_email_verified", "is_active", "date_joined"]


class UserUpdateSerializer(serializers.ModelSerializer):
    """사용자 본인이 수정할 수 있는 계정 필드만 허용합니다."""

    class Meta:
        model = User
        fields = ["email", "first_name", "department", "position", "profile_image"]

    def validate_email(self, value):
        """이메일은 로그인 식별자로도 쓰이므로 다른 사용자와 중복될 수 없습니다."""
        user = self.instance
        if User.objects.exclude(pk=user.pk).filter(email=value).exists():
            raise serializers.ValidationError("이미 사용 중인 이메일입니다.")
        return value

    def validate_position(self, value):
        """대표이사 직함은 CEO role 계정에만 허용합니다."""
        if value.strip() == "대표이사" and self.instance.role != User.UserRole.CEO:
            raise serializers.ValidationError("대표이사 직함은 대표이사 권한 계정만 사용할 수 있습니다.")
        return value


class UserListSerializer(serializers.ModelSerializer):
    """담당자/승인자 선택 목록용 사용자 serializer.

    화면에서는 username보다 이름/부서/직함/역할이 필요하므로 User 필드를 함께
    내려줍니다.
    """

    display_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "display_name", "department", "position", "role"]

    def get_display_name(self, obj):
        """이름이 있으면 이름, 없으면 이메일을 화면 표시명으로 사용합니다."""
        return obj.first_name or obj.email


class ProfileSerializer(serializers.ModelSerializer):
    """명함처럼 화면에 표시되는 사용자 프로필 serializer."""

    class Meta:
        model = Profile
        fields = ["bio"]


class RegisterSerializer(serializers.Serializer):
    """회원가입 요청 검증과 User/Profile 생성을 담당합니다.

    User 모델 필드와 Profile 모델 필드가 한 화면에 함께 입력되므로 일반
    ModelSerializer 대신 Serializer에서 데이터를 나눠 저장합니다. 아이디는 별도
    입력받지 않고 email을 username으로 자동 저장합니다.
    """

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    password_confirm = serializers.CharField(write_only=True)
    first_name = serializers.CharField(required=False, allow_blank=True)
    department = serializers.CharField(required=False, allow_blank=True)
    position = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        """비밀번호 확인, 비밀번호 정책, email 중복을 한 번에 검증합니다."""
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": "비밀번호가 서로 다릅니다."})
        validate_password(attrs["password"])
        if User.objects.filter(email=attrs["email"]).exists():
            raise serializers.ValidationError({"email": "이미 사용 중인 이메일입니다."})
        if User.objects.filter(username=attrs["email"]).exists():
            raise serializers.ValidationError({"email": "이미 사용 중인 이메일입니다."})
        if attrs.get("position", "").strip() == "대표이사":
            raise serializers.ValidationError({"position": "대표이사 직함은 가입 후 권한 계정에만 부여할 수 있습니다."})
        return attrs

    def create(self, validated_data):
        """User 생성 후 username=email, role=USER를 고정합니다."""
        validated_data.pop("password_confirm")
        password = validated_data.pop("password")
        validated_data["username"] = validated_data["email"]
        validated_data["role"] = User.UserRole.USER
        user = User.objects.create_user(password=password, **validated_data)
        return user


class LoginSerializer(serializers.Serializer):
    """이메일 로그인 처리 serializer.

    authenticate()는 username 기반으로 동작하므로 이메일을 username으로 변환한 뒤
    Django 인증 백엔드에 위임합니다. 기존 클라이언트 호환을 위해 identifier도
    email과 같은 값으로 허용합니다.
    """

    email = serializers.EmailField(required=False)
    identifier = serializers.CharField(required=False, help_text="기존 클라이언트 호환용 이메일")
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        """인증 성공 시 JWT access/refresh와 사용자 정보를 응답 데이터로 구성합니다."""
        email = attrs.get("email") or attrs.get("identifier")
        if not email:
            raise serializers.ValidationError({"email": "이메일을 입력해주세요."})

        user_obj = User.objects.filter(email=email).first()
        username = user_obj.username if user_obj else email

        user = authenticate(username=username, password=attrs["password"])
        if not user:
            raise serializers.ValidationError("이메일 또는 비밀번호가 올바르지 않습니다.")
        if not user.is_active:
            raise serializers.ValidationError("비활성화된 계정입니다.")
        refresh = RefreshToken.for_user(user)
        return {
            "user": UserSerializer(user).data,
            "access": str(refresh.access_token),
            "refresh": str(refresh),
        }


class LogoutSerializer(serializers.Serializer):
    """refresh token을 blacklist에 넣어 로그아웃 처리합니다."""

    refresh = serializers.CharField()

    def save(self, **kwargs):
        token = RefreshToken(self.validated_data["refresh"])
        token.blacklist()


class EmailVerifySendSerializer(serializers.Serializer):
    """이메일 인증번호 발급 요청 serializer."""

    email = serializers.EmailField()

    def create(self, validated_data):
        return EmailVerificationCode.issue(
            validated_data["email"],
            EmailVerificationCode.Purpose.EMAIL_VERIFY,
        )


class EmailVerifyConfirmSerializer(serializers.Serializer):
    """이메일 인증번호 확인 serializer."""

    email = serializers.EmailField()
    code = serializers.CharField(max_length=6)

    def validate(self, attrs):
        """가장 최근 코드가 존재하고, 미사용이며, 만료 전인지 확인합니다."""
        code = EmailVerificationCode.objects.filter(
            email=attrs["email"],
            code=attrs["code"],
            purpose=EmailVerificationCode.Purpose.EMAIL_VERIFY,
        ).order_by("-created_at").first()
        if not code or not code.can_use():
            raise serializers.ValidationError("인증번호가 올바르지 않거나 만료되었습니다.")
        attrs["code_obj"] = code
        return attrs

    def save(self, **kwargs):
        """코드를 사용 처리하고 같은 이메일의 사용자 계정을 인증 완료로 표시합니다."""
        code = self.validated_data["code_obj"]
        code.is_used = True
        code.save(update_fields=["is_used"])
        User.objects.filter(email=self.validated_data["email"]).update(is_email_verified=True)


class PasswordResetRequestSerializer(serializers.Serializer):
    """비밀번호 재설정 코드 발급 요청 serializer."""

    email = serializers.EmailField()

    def validate_email(self, value):
        if not User.objects.filter(email=value).exists():
            raise serializers.ValidationError("해당 이메일의 사용자가 없습니다.")
        return value

    def create(self, validated_data):
        return EmailVerificationCode.issue(
            validated_data["email"],
            EmailVerificationCode.Purpose.PASSWORD_RESET,
        )


class PasswordResetConfirmSerializer(serializers.Serializer):
    """비밀번호 재설정 코드 확인과 새 비밀번호 저장 serializer."""

    email = serializers.EmailField()
    code = serializers.CharField(max_length=6)
    new_password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        validate_password(attrs["new_password"])
        code = EmailVerificationCode.objects.filter(
            email=attrs["email"],
            code=attrs["code"],
            purpose=EmailVerificationCode.Purpose.PASSWORD_RESET,
        ).order_by("-created_at").first()
        if not code or not code.can_use():
            raise serializers.ValidationError("인증번호가 올바르지 않거나 만료되었습니다.")
        attrs["code_obj"] = code
        return attrs

    def save(self, **kwargs):
        """set_password()를 사용해 Django 비밀번호 해시 정책을 그대로 적용합니다."""
        user = User.objects.get(email=self.validated_data["email"])
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        code = self.validated_data["code_obj"]
        code.is_used = True
        code.save(update_fields=["is_used"])


class PasswordChangeSerializer(serializers.Serializer):
    """로그인 사용자의 비밀번호 변경 serializer."""

    old_password = serializers.CharField(write_only=True, required=False)
    current_password = serializers.CharField(write_only=True, required=False)
    new_password = serializers.CharField(write_only=True)
    new_password_confirm = serializers.CharField(write_only=True, required=False)

    def validate(self, attrs):
        user = self.context["request"].user
        current_password = attrs.get("current_password") or attrs.get("old_password")
        if not current_password:
            raise serializers.ValidationError({"current_password": "현재 비밀번호를 입력해주세요."})
        if attrs.get("new_password_confirm") and attrs["new_password"] != attrs["new_password_confirm"]:
            raise serializers.ValidationError({"new_password_confirm": "새 비밀번호가 서로 다릅니다."})
        if not user.check_password(current_password):
            raise serializers.ValidationError({"detail": "현재 비밀번호가 일치하지 않습니다."})
        validate_password(attrs["new_password"], user)
        return attrs

    def save(self, **kwargs):
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])


class AdminApprovalRequestSerializer(serializers.ModelSerializer):
    """관리자 승격 신청서 조회/생성 serializer."""

    applicant_name = serializers.CharField(source="applicant.first_name", read_only=True)
    applicant_email = serializers.EmailField(source="applicant.email", read_only=True)
    applicant_department = serializers.CharField(source="applicant.department", read_only=True)
    applicant_position = serializers.CharField(source="applicant.position", read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by.first_name", read_only=True)

    class Meta:
        model = AdminApprovalRequest
        fields = [
            "id",
            "applicant",
            "applicant_name",
            "applicant_email",
            "applicant_department",
            "applicant_position",
            "reason",
            "experience",
            "status",
            "reject_reason",
            "created_at",
            "reviewed_at",
            "reviewed_by",
            "reviewed_by_name",
        ]
        read_only_fields = [
            "applicant",
            "status",
            "reject_reason",
            "created_at",
            "reviewed_at",
            "reviewed_by",
        ]


class AdminApprovalRejectSerializer(serializers.Serializer):
    """관리자 승격 신청 거절 사유 serializer."""

    reject_reason = serializers.CharField()


class UserRestoreSerializer(serializers.Serializer):
    """soft delete된 계정을 인증 코드로 다시 활성화하는 serializer."""

    email = serializers.EmailField()
    code = serializers.CharField(max_length=6)

    def validate(self, attrs):
        code = EmailVerificationCode.objects.filter(
            email=attrs["email"],
            code=attrs["code"],
            purpose=EmailVerificationCode.Purpose.ACCOUNT_RESTORE,
        ).order_by("-created_at").first()
        if not code or not code.can_use():
            raise serializers.ValidationError("복구 인증번호가 올바르지 않거나 만료되었습니다.")
        attrs["code_obj"] = code
        return attrs

    def save(self, **kwargs):
        user = User.objects.get(email=self.validated_data["email"])
        user.is_active = True
        user.deleted_at = None
        user.save(update_fields=["is_active", "deleted_at"])
        code = self.validated_data["code_obj"]
        code.is_used = True
        code.save(update_fields=["is_used"])


class BiometricCredentialSerializer(serializers.ModelSerializer):
    """생체인식 설정 화면에 노출할 등록 기기 정보 serializer."""

    class Meta:
        model = BiometricCredential
        fields = ["id", "credential_id", "device_name", "transports", "sign_count", "last_used_at", "created_at"]
        read_only_fields = ["id", "credential_id", "transports", "sign_count", "last_used_at", "created_at"]


class BiometricRegisterOptionsSerializer(serializers.Serializer):
    """생체인식 등록 challenge 요청 serializer."""

    device_name = serializers.CharField(required=False, allow_blank=True, max_length=120)


class BiometricRegisterVerifySerializer(serializers.Serializer):
    """브라우저가 생성한 WebAuthn credential을 서버에 저장하기 위한 serializer."""

    challenge = serializers.CharField()
    credential_id = serializers.CharField()
    public_key = serializers.CharField(required=False, allow_blank=True)
    sign_count = serializers.IntegerField(required=False, min_value=0, default=0)
    device_name = serializers.CharField(required=False, allow_blank=True, max_length=120)
    transports = serializers.ListField(child=serializers.CharField(), required=False)


class BiometricLoginOptionsSerializer(serializers.Serializer):
    """생체인식 로그인 challenge 요청 serializer."""

    identifier = serializers.CharField()


class BiometricLoginVerifySerializer(serializers.Serializer):
    """생체인식 로그인 응답 검증 serializer."""

    challenge = serializers.CharField()
    credential_id = serializers.CharField()
    sign_count = serializers.IntegerField(required=False, min_value=0)
