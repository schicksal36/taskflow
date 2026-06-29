"""파일 관련 비동기 작업."""

from celery import shared_task


@shared_task
def parse_excel_file(media_file_id):
    """대량 Excel 파일 파싱 작업 자리.

    실제 구현에서는 media_file_id로 MediaFile을 조회하고 openpyxl/pandas로 내용을
    읽은 뒤 업무요청/보고서 등 대상 도메인 데이터로 변환합니다.
    """

    return {"media_file_id": media_file_id, "status": "queued"}


@shared_task
def scan_uploaded_file(media_file_id):
    """업로드 파일 보안 검사 작업 자리.

    실제 구현에서는 백신/확장자/MIME 검사를 수행하고 AsyncTaskLog 상태를 SUCCESS
    또는 FAILURE로 갱신합니다.
    """

    return {"media_file_id": media_file_id, "status": "queued"}
