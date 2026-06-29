from django.urls import path

from . import views

urlpatterns = [
    path("posts/", views.BoardPostListCreateView.as_view(), name="board-post-list-create"),
    path("posts/search/", views.BoardPostSearchView.as_view(), name="board-post-search"),
    path("notices/", views.NoticePostListView.as_view(), name="board-notices"),
    path("posts/<int:pk>/", views.BoardPostDetailView.as_view(), name="board-post-detail"),
    path("posts/<int:pk>/pin/", views.BoardPostPinView.as_view(), name="board-post-pin"),
    path("posts/<int:pk>/unpin/", views.BoardPostUnpinView.as_view(), name="board-post-unpin"),
    path("posts/<int:pk>/like/", views.BoardPostLikeView.as_view(), name="board-post-like"),
    path("posts/<int:pk>/comments/", views.BoardCommentListCreateView.as_view(), name="board-comments"),
    path("comments/<int:comment_id>/", views.BoardCommentDetailView.as_view(), name="board-comment-detail"),
    path("posts/<int:pk>/files/", views.BoardFileListCreateView.as_view(), name="board-files"),
    path("posts/<int:pk>/attachments/", views.BoardFileListCreateView.as_view(), name="board-attachments"),
    path("posts/<int:pk>/attachments/<int:fid>/download/", views.BoardAttachmentDownloadView.as_view(), name="board-attachment-download"),
    path("posts/<int:pk>/attachments/download-all/", views.BoardAttachmentDownloadAllView.as_view(), name="board-attachments-download-all"),
    path("posts/<int:pk>/permissions/", views.BoardPermissionView.as_view(), name="board-permissions"),
    path("files/<int:file_id>/download/", views.BoardFileDownloadView.as_view(), name="board-file-download"),
    path("files/<int:file_id>/", views.BoardFileDetailView.as_view(), name="board-file-detail"),
]
