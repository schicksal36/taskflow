"""알림 생성 서비스.

다른 도메인 앱이 Notification 모델 세부사항에 직접 의존하지 않도록 얇은 서비스
함수를 제공합니다.
"""

from .models import Notification


def create_notification(user, notification_type, title, message="", target_type="", target_id=None):
    """다른 앱에서 알림을 만들 때 부르는 공통 함수.

    업무요청/보고서/게시판 같은 도메인 앱은 Notification 모델을 직접 알 필요 없이
    이 함수만 호출합니다. 이렇게 하면 나중에 이메일 발송, WebSocket broadcast,
    사용자별 수신 설정 체크를 한 곳에 추가할 수 있습니다.
    """

    if not user:
        # 담당자/승인자가 비어 있는 업무도 있으므로 user가 없으면 알림을 만들지 않습니다.
        return None
    return Notification.objects.create(
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        target_type=target_type,
        target_id=target_id,
    )
