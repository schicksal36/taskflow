"""ASGI 진입점.

HTTP 요청은 일반 API로 보내고, WebSocket 요청은 실시간 알림 라우터로 보냅니다.
비유하면 정문으로 온 사람은 안내데스크(API)로, 무전기로 온 신호는 방송실(WebSocket)로
보내는 역할입니다.
"""

import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

from config.routing import websocket_urlpatterns

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")

django_asgi_app = get_asgi_application()

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
    }
)
