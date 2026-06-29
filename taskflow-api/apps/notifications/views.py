"""알림 API View.

알림 목록/상세, 읽음 처리, 전체 읽음/삭제, 카운트, 사용자 알림 설정, SSE 스트림을
제공합니다.
"""

import json

from django.http import StreamingHttpResponse
from rest_framework import generics, permissions, status
from rest_framework.views import APIView

from apps.common.responses import success_response

from .models import Notification, NotificationSetting
from .serializers import NotificationSerializer, NotificationSettingSerializer


class NotificationListView(generics.ListAPIView):
    """내 알림 목록 API."""

    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """알림은 사용자별 개인 데이터이므로 request.user 기준으로 제한합니다."""
        return Notification.objects.filter(user=self.request.user)


class NotificationDetailView(generics.RetrieveDestroyAPIView):
    """알림 단건 조회/삭제 API."""

    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)


class UnreadNotificationListView(NotificationListView):
    """읽지 않은 알림 목록 API."""

    def get_queryset(self):
        return super().get_queryset().filter(is_read=False)


class NotificationReadView(APIView):
    """알림 읽음/안읽음 상태 변경 공통 API."""

    permission_classes = [permissions.IsAuthenticated]
    mark_as_read = True

    def patch(self, request, pk):
        notification = generics.get_object_or_404(Notification, pk=pk, user=request.user)
        notification.is_read = self.mark_as_read
        notification.save(update_fields=["is_read"])
        return success_response(NotificationSerializer(notification).data, "알림 읽음 상태가 변경되었습니다.")


class NotificationUnreadView(NotificationReadView):
    """알림을 안읽음 상태로 되돌리는 API."""

    mark_as_read = False


class NotificationReadAllView(APIView):
    """내 모든 안 읽은 알림을 읽음 처리합니다."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request):
        count = Notification.objects.filter(user=request.user, is_read=False).update(is_read=True)
        return success_response({"updated_count": count}, "전체 알림을 읽음 처리했습니다.")


class NotificationDeleteAllView(APIView):
    """내 모든 알림을 삭제합니다."""

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request):
        count, _ = Notification.objects.filter(user=request.user).delete()
        return success_response({"deleted_count": count}, "전체 알림을 삭제했습니다.")


class NotificationCountView(APIView):
    """헤더/대시보드 배지에 사용할 안 읽은 알림 개수 API."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return success_response({"unread_count": Notification.objects.filter(user=request.user, is_read=False).count()})


class NotificationSettingView(APIView):
    """알림 설정 조회/수정 API."""

    permission_classes = [permissions.IsAuthenticated]

    def get_object(self, request):
        """설정이 아직 없으면 기본값으로 생성합니다."""
        setting, _ = NotificationSetting.objects.get_or_create(user=request.user)
        return setting

    def get(self, request):
        return success_response(NotificationSettingSerializer(self.get_object(request)).data)

    def patch(self, request):
        setting = self.get_object(request)
        serializer = NotificationSettingSerializer(setting, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(serializer.data, "알림 설정이 수정되었습니다.")


class NotificationStreamView(APIView):
    """SSE 기반 알림 스트림 API."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        """간단한 SSE 응답.

        진짜 실시간 큐는 Redis/Channels로 확장하면 됩니다. 지금은 연결 확인과
        배지 카운트 전달이 되도록 한 번의 이벤트를 스트림 형태로 보냅니다.
        """

        unread_count = Notification.objects.filter(user=request.user, is_read=False).count()

        def event_stream():
            # EventSource 클라이언트가 바로 해석할 수 있는 SSE 형식으로 한 번 전송합니다.
            payload = json.dumps({"event": "notification.badge", "unread_count": unread_count}, ensure_ascii=False)
            yield f"event: notification.badge\ndata: {payload}\n\n"

        return StreamingHttpResponse(event_stream(), content_type="text/event-stream", status=status.HTTP_200_OK)
