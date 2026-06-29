from django.contrib import admin

from .models import ExpenseItem, ExpenseReceipt, Report, ReportFile


class ExpenseItemInline(admin.TabularInline):
    """보고서 관리자 상세 화면에서 경비 항목을 같이 확인하기 위한 인라인."""

    model = ExpenseItem
    # 기본 빈 행을 만들지 않아 실제 등록된 항목만 보이게 합니다.
    extra = 0


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    """보고서 운영 관리 화면 설정.

    목록에서는 작성자/승인자/유형/상태/보고일/총액을 한눈에 확인하고,
    필터와 검색은 보고서 처리 상태를 빠르게 추적하는 데 필요한 필드로 제한합니다.
    """

    list_display = ["title", "writer", "approver", "report_type", "status", "report_date", "total_amount"]
    list_filter = ["report_type", "status", "is_archived"]
    search_fields = ["title", "content", "writer__username", "approver__username"]
    inlines = [ExpenseItemInline]


admin.site.register(ExpenseItem)
admin.site.register(ExpenseReceipt)
admin.site.register(ReportFile)
