from django.urls import path

from . import views

urlpatterns = [
    path("", views.WorkRequestListCreateView.as_view(), name="work-request-list-create"),
    path("created/me/", views.MyCreatedWorkRequestView.as_view(), name="my-created-work-requests"),
    path("assigned/me/", views.MyAssignedWorkRequestView.as_view(), name="my-assigned-work-requests"),
    path("in-progress/", views.WorkRequestInProgressView.as_view(), name="work-request-in-progress"),
    path("due-soon/", views.WorkRequestDueSoonView.as_view(), name="work-request-due-soon"),
    path("overdue/", views.WorkRequestOverdueView.as_view(), name="work-request-overdue"),
    path("search/", views.WorkRequestSearchView.as_view(), name="work-request-search"),
    path("comments/<int:comment_id>/", views.WorkRequestCommentDetailView.as_view(), name="work-request-comment-detail"),
    path("files/<int:file_id>/", views.WorkRequestFileDetailView.as_view(), name="work-request-file-detail"),
    path("<int:pk>/", views.WorkRequestDetailUpdateDeleteView.as_view(), name="work-request-detail"),
    path("<int:pk>/status/", views.WorkRequestStatusView.as_view(), name="work-request-status"),
    path("<int:pk>/assignee/", views.WorkRequestAssigneeView.as_view(), name="work-request-assignee"),
    path("<int:pk>/deadline/", views.WorkRequestDeadlineView.as_view(), name="work-request-deadline"),
    path("<int:pk>/priority/", views.WorkRequestPriorityView.as_view(), name="work-request-priority"),
    path("<int:pk>/accept/", views.WorkRequestAcceptView.as_view(), name="work-request-accept"),
    path("<int:pk>/complete/", views.WorkRequestCompleteView.as_view(), name="work-request-complete"),
    path("<int:pk>/approve/", views.WorkRequestApproveView.as_view(), name="work-request-approve"),
    path("<int:pk>/reject/", views.WorkRequestRejectView.as_view(), name="work-request-reject"),
    path("<int:pk>/cancel/", views.WorkRequestCancelView.as_view(), name="work-request-cancel"),
    path("<int:pk>/comments/", views.WorkRequestCommentListCreateView.as_view(), name="work-request-comments"),
    path("<int:pk>/files/", views.WorkRequestFileListCreateView.as_view(), name="work-request-files"),
    path("<int:pk>/attachments/", views.WorkRequestFileListCreateView.as_view(), name="work-request-attachments"),
    path("<int:pk>/attachments/<int:file_id>/download/", views.WorkRequestFileDownloadView.as_view(), name="work-request-attachment-download"),
    path("<int:pk>/attachments/download-all/", views.WorkRequestFileDownloadAllView.as_view(), name="work-request-attachments-download-all"),
]
