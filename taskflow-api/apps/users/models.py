"""[사용자] models.py - 사용자/프로필/관리자 승격 모델.

역할: 이메일 기반 계정, 역할 권한, 프로필 이미지, 관리자 승격 신청 상태 저장
관련 모델: User, Profile, AdminApprovalRequest, EmailVerificationCode, BiometricCredential
작성기준: username은 email과 동일하게 저장하고 앱 권한은 role 필드로 구분
"""

from datetime import timedelta
from random import randint

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from apps.common.models import TimeStampedModel


class User(AbstractUser):
    """TaskFlow 로그인 계정.

    email은 로그인 식별자이며 username에도 같은 값을 저장합니다. role은 앱 UI 권한을
    구분하고, Django Admin 접근은 admin.py의 has_permission에서 별도로 제한합니다.
    """

    class UserRole(models.TextChoices):
        SUPERUSER = "SUPERUSER", "슈퍼유저"
        CEO = "CEO", "대표이사"
        ADMIN = "ADMIN", "관리자"
        USER = "USER", "일반사용자"

    last_name = None
    email = models.EmailField(unique=True)  # 로그인 식별자
    department = models.CharField(max_length=80, blank=True)  # 부서
    position = models.CharField(max_length=50, blank=True)  # 직함
    profile_image = models.ImageField(upload_to="profiles/%Y/%m/%d/", blank=True, null=True)  # 프로필 이미지
    role = models.CharField(max_length=20, choices=UserRole.choices, default=UserRole.USER)  # 앱 권한 역할
    is_email_verified = models.BooleanField(default=False)  # 이메일 인증 완료 여부
    deleted_at = models.DateTimeField(null=True, blank=True)  # 회원탈퇴 시각

    def soft_delete(self):
        """회원탈퇴는 데이터를 바로 지우지 않고 비활성화로 처리합니다."""

        self.is_active = False
        self.deleted_at = timezone.now()
        self.save(update_fields=["is_active", "deleted_at"])

    def save(self, *args, **kwargs):
        """슈퍼유저 role과 CEO staff 권한을 저장 시점에 맞춥니다."""
        update_fields = kwargs.get("update_fields")
        if self.is_superuser:
            self.role = self.UserRole.SUPERUSER
        if self.role == self.UserRole.CEO:
            self.is_staff = True
            self.position = "대표이사"
        if update_fields is not None:
            next_fields = set(update_fields)
            if "role" in next_fields or "is_superuser" in next_fields:
                next_fields.add("role")
                if self.role == self.UserRole.CEO:
                    next_fields.update({"is_staff", "position"})
            kwargs["update_fields"] = list(next_fields)
        super().save(*args, **kwargs)


class Profile(TimeStampedModel):
    """사용자 부가 프로필.

    현재 주요 프로필 필드는 User에 있으며, 이 모델은 확장 설명(bio)을 보관합니다.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    bio = models.TextField(blank=True)

    def __str__(self):
        return self.user.email


class AdminApprovalRequest(TimeStampedModel):
    """관리자 승격 신청 모델.

    USER 역할 사용자가 신청서를 제출하면 CEO가 승인/거절할 수 있습니다. 신청자는
    하나의 활성 신청서를 기준으로 상태를 확인합니다.
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "대기"
        APPROVED = "APPROVED", "승인"
        REJECTED = "REJECTED", "거절"

    applicant = models.OneToOneField(User, on_delete=models.CASCADE, related_name="approval_request")  # 신청자
    reason = models.TextField()  # 신청 사유
    experience = models.TextField()  # 관련 경력/업무 내용
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)  # 처리 상태
    reject_reason = models.TextField(blank=True)  # 거절 사유
    reviewed_at = models.DateTimeField(null=True, blank=True)  # 검토 시각
    reviewed_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_admin_requests",
    )  # 처리한 CEO


class EmailVerificationCode(TimeStampedModel):
    """이메일 인증, 비밀번호 재설정, 계정 복구에 재사용되는 6자리 코드.

    purpose로 사용 목적을 구분해 같은 이메일이라도 인증 코드와 비밀번호 재설정 코드가
    섞이지 않게 합니다. can_use()는 이미 사용한 코드와 만료 코드를 막는 공통 검증입니다.
    """

    class Purpose(models.TextChoices):
        EMAIL_VERIFY = "EMAIL_VERIFY", "이메일 인증"
        PASSWORD_RESET = "PASSWORD_RESET", "비밀번호 재설정"
        ACCOUNT_RESTORE = "ACCOUNT_RESTORE", "탈퇴 복구"

    email = models.EmailField()
    purpose = models.CharField(max_length=30, choices=Purpose.choices)
    code = models.CharField(max_length=6)
    is_used = models.BooleanField(default=False)
    expires_at = models.DateTimeField()

    @classmethod
    def issue(cls, email: str, purpose: str):
        """6자리 숫자 코드를 만듭니다.

        실제 운영에서는 이 코드를 이메일로 보내면 됩니다. 개발 중에는 API 응답에
        dev_code로 보여주어 프론트엔드가 흐름을 테스트할 수 있게 했습니다.
        """

        return cls.objects.create(
            email=email,
            purpose=purpose,
            code=f"{randint(0, 999999):06d}",
            expires_at=timezone.now() + timedelta(minutes=10),
        )

    def can_use(self) -> bool:
        return not self.is_used and self.expires_at >= timezone.now()


class BiometricChallenge(TimeStampedModel):
    """WebAuthn 등록/로그인 challenge 저장소.

    생체인식은 서버가 challenge를 발급하고 브라우저가 그 challenge를 서명/응답한 뒤
    서버에 다시 제출하는 왕복 구조입니다. 이 모델은 challenge 재사용을 막기 위해
    is_used와 expires_at을 저장합니다.
    """

    class Purpose(models.TextChoices):
        REGISTER = "REGISTER", "생체인식 등록"
        LOGIN = "LOGIN", "생체인식 로그인"

    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.CASCADE, related_name="biometric_challenges")
    identifier = models.CharField(max_length=255, blank=True)
    challenge = models.CharField(max_length=255, unique=True)
    purpose = models.CharField(max_length=20, choices=Purpose.choices)
    is_used = models.BooleanField(default=False)
    expires_at = models.DateTimeField()

    def can_use(self) -> bool:
        return not self.is_used and self.expires_at >= timezone.now()


class BiometricCredential(TimeStampedModel):
    """사용자별 등록 생체인식 credential.

    credential_id는 브라우저/OS 패스키가 돌려주는 공개 식별자입니다. public_key와
    sign_count는 WebAuthn 검증을 확장할 때 사용하는 값이며, is_active=False로 처리해
    삭제 이력을 보존하면서도 로그인에는 사용하지 않게 합니다.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="biometric_credentials")
    credential_id = models.TextField(unique=True)
    public_key = models.TextField()
    sign_count = models.BigIntegerField(default=0)
    device_name = models.CharField(max_length=120, blank=True)
    transports = models.JSONField(default=list, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "is_active"]),
        ]

    def __str__(self):
        return self.device_name or f"{self.user.username} credential"


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """회원가입 직후 빈 프로필을 자동으로 만들어줍니다."""

    if created:
        Profile.objects.create(user=instance)
