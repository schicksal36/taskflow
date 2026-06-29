"""API 권한 체크 도우미."""

from rest_framework.permissions import BasePermission


class IsOwnerField(BasePermission):
    """객체의 특정 사용자 필드가 현재 로그인 사용자와 같은지 검사합니다."""

    owner_field = "user"

    def has_object_permission(self, request, view, obj):
        owner = getattr(obj, self.owner_field, None)
        return owner == request.user
