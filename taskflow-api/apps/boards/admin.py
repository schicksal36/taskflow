from django.contrib import admin

from .models import BoardComment, BoardCommentFile, BoardFile, BoardLike, BoardPost


class BoardCommentInline(admin.TabularInline):
    model = BoardComment
    extra = 0


@admin.register(BoardPost)
class BoardPostAdmin(admin.ModelAdmin):
    list_display = ["title", "author", "board_type", "is_notice", "is_pinned", "view_count", "like_count"]
    list_filter = ["board_type", "is_notice", "is_pinned", "is_deleted"]
    search_fields = ["title", "content", "author__username"]
    inlines = [BoardCommentInline]


admin.site.register(BoardComment)
admin.site.register(BoardCommentFile)
admin.site.register(BoardLike)
admin.site.register(BoardFile)
