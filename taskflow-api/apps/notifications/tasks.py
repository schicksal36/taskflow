"""알림 관련 비동기 작업."""

from celery import shared_task


@shared_task
def send_notification_email(notification_id):
    """알림 이메일 발송 작업 자리.

    실제 메일 서버가 연결되면 notification_id로 알림을 찾아 이메일을 보내면 됩니다.
    지금은 작업이 정상 접수되는지 확인할 수 있도록 id를 그대로 반환합니다.
    """

    return {"notification_id": notification_id, "status": "queued"}


@shared_task
def create_due_notifications():
    """마감 임박/초과 알림 생성 작업 자리."""

    return {"created_count": 0}
