from django.contrib import admin

from .models import Todo, TodoItem


class TodoItemInline(admin.TabularInline):
    model = TodoItem
    extra = 0


@admin.register(Todo)
class TodoAdmin(admin.ModelAdmin):
    list_display = ["title", "user", "status", "priority", "deadline_at", "created_at"]
    list_filter = ["status", "priority"]
    search_fields = ["title", "content", "user__username"]
    inlines = [TodoItemInline]


admin.site.register(TodoItem)
