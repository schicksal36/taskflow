from django.contrib import admin

from .models import Schedule, ScheduleParticipant


class ScheduleParticipantInline(admin.TabularInline):
    model = ScheduleParticipant
    extra = 0


@admin.register(Schedule)
class ScheduleAdmin(admin.ModelAdmin):
    list_display = ["title", "created_by", "category", "start_at", "end_at", "location"]
    list_filter = ["category"]
    search_fields = ["title", "description", "created_by__username"]
    inlines = [ScheduleParticipantInline]


admin.site.register(ScheduleParticipant)
