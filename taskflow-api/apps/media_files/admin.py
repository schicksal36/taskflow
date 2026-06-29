from django.contrib import admin

from .models import AsyncTaskLog, MediaFile


@admin.register(MediaFile)
class MediaFileAdmin(admin.ModelAdmin):
    list_display = ["original_name", "file_type", "uploaded_by", "target_app", "target_id", "created_at"]
    list_filter = ["file_type", "target_app", "is_deleted"]
    search_fields = ["original_name", "stored_name", "uploaded_by__username"]


admin.site.register(AsyncTaskLog)
