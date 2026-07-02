from django.urls import path

from . import views

urlpatterns = [
    path("", views.FreeBoardPostListCreateView.as_view(), name="freeboard-post-list-create"),
    path("<int:pk>/", views.FreeBoardPostDetailView.as_view(), name="freeboard-post-detail"),
    path("<int:pk>/comments/", views.BoardCommentListCreateView.as_view(), name="freeboard-comments"),
    path("comments/<int:comment_id>/", views.BoardCommentDetailView.as_view(), name="freeboard-comment-detail"),
    path("comments/<int:comment_id>/files/", views.BoardCommentFileListCreateView.as_view(), name="freeboard-comment-files"),
]
