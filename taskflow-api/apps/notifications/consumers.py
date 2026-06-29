"""실시간 알림 WebSocket consumer."""

from channels.generic.websocket import AsyncJsonWebsocketConsumer


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    """로그인 사용자의 알림 방에 연결합니다.

    지금은 연결 확인 이벤트를 보내고, 나중에 Celery나 서비스 코드에서
    `notification_<user_id>` 그룹으로 메시지를 보내면 브라우저가 즉시 받을 수 있습니다.
    """

    async def connect(self):
        """WebSocket 연결 시 사용자별 channel group에 참여합니다."""
        user = self.scope.get("user")
        if not user or user.is_anonymous:
            await self.close(code=4401)
            return

        self.group_name = f"notification_{user.id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send_json({"event": "notification.connected", "message": "알림 소켓이 연결되었습니다."})

    async def disconnect(self, close_code):
        """연결 종료 시 group에서 제거해 더 이상 메시지를 받지 않게 합니다."""
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def notification_created(self, event):
        """서비스/태스크에서 새 알림 이벤트를 보낼 때 호출되는 handler."""
        await self.send_json(event["data"])

    async def notification_badge(self, event):
        """읽지 않은 알림 수 갱신 이벤트 handler."""
        await self.send_json(event["data"])
