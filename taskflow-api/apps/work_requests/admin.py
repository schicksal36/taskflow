from django.contrib import admin

from .models import WorkRequest, WorkRequestComment, WorkRequestFile


@admin.register(WorkRequest)
class WorkRequestAdmin(admin.ModelAdmin):
    list_display = ["title", "requester", "assignee", "status", "priority", "deadline_at"]
    list_filter = ["status", "priority"]
    search_fields = ["title", "content", "requester__username", "assignee__username"]


admin.site.register(WorkRequestComment)
admin.site.register(WorkRequestFile)
