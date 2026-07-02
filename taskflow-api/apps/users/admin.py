from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import AdminApprovalRequest, EmailVerificationCode, Profile, User


def admin_has_permission(request):
    user = request.user
    return user.is_active and (user.is_superuser or getattr(user, "role", None) == User.UserRole.CEO)


admin.site.has_permission = admin_has_permission


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("기본 정보", {"fields": ("email", "first_name", "department", "position", "profile_image", "hire_date", "role")}),
        ("권한", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("중요 일시", {"fields": ("last_login", "date_joined", "is_email_verified", "deleted_at")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("username", "email", "first_name", "password1", "password2", "role"),
        }),
    )
    list_display = ["email", "first_name", "department", "position", "hire_date", "role", "is_active", "date_joined"]
    list_filter = ["role", "is_active", "is_staff", "is_superuser"]
    search_fields = ["username", "email", "first_name"]


admin.site.register(Profile)
admin.site.register(EmailVerificationCode)
admin.site.register(AdminApprovalRequest)
