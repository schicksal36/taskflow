from django.urls import path

from . import views

urlpatterns = [
    path("files/", views.MediaFileListUploadView.as_view(), name="media-file-list-upload"),
    path("files/<int:pk>/", views.MediaFileDetailView.as_view(), name="media-file-detail"),
    path("files/<int:pk>/download/", views.MediaFileDownloadView.as_view(), name="media-file-download"),
    path("images/", views.ImageUploadView.as_view(), name="image-upload"),
    path("excels/", views.ExcelUploadView.as_view(), name="excel-upload"),
    path("excels/<int:pk>/parse/", views.ExcelParseView.as_view(), name="excel-parse"),
    path("pdfs/", views.PdfUploadView.as_view(), name="pdf-upload"),
    path("tasks/<str:task_id>/", views.AsyncTaskLogDetailView.as_view(), name="async-task-detail"),
]
