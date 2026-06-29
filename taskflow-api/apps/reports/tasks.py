"""보고서 관련 비동기 작업."""

from celery import shared_task


@shared_task
def generate_report_pdf(report_id):
    """보고서 PDF 생성 작업 자리.

    실제 구현에서는 report_id로 Report를 조회해 PDF 파일을 만들고 MediaFile로 저장한 뒤
    AsyncTaskLog.result_file과 status를 갱신합니다. 현재는 Celery 연결과 작업 접수
    흐름을 확인할 수 있도록 queued 상태만 반환합니다.
    """

    return {"report_id": report_id, "status": "queued"}


@shared_task
def generate_expense_excel(report_id):
    """경비지출 Excel 생성 작업 자리.

    실제 구현에서는 report_id의 ExpenseItem 목록을 Excel 행으로 변환하고 생성 파일을
    MediaFile에 저장합니다. API는 먼저 task_id를 반환하고 프론트는 작업 상태 API로
    완료 여부를 확인하는 구조입니다.
    """

    return {"report_id": report_id, "status": "queued"}
