"""공통 파일 업로드/다운로드 API View.

일반 파일과 타입별 파일 업로드, 파일 메타 조회/삭제, 다운로드, Excel 파싱 작업 접수,
비동기 작업 상태 조회를 제공합니다.
"""

from uuid import uuid4

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.views import APIView

from apps.common.responses import success_response

from .models import AsyncTaskLog, MediaFile
from .serializers import (
    AsyncTaskLogSerializer,
    MediaFileSerializer,
    MediaFileUploadSerializer,
    TypedMediaFileUploadSerializer,
)


class MediaFileListUploadView(generics.ListCreateAPIView):
    """내 파일 목록 조회와 일반 파일 업로드 API."""

    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """현재 사용자가 업로드했고 삭제 처리되지 않은 파일만 조회합니다."""
        return MediaFile.objects.filter(uploaded_by=self.request.user, is_deleted=False)

    def get_serializer_class(self):
        return MediaFileUploadSerializer if self.request.method == "POST" else MediaFileSerializer

    def get_serializer_context(self):
        """기본 업로드 폴더를 serializer에 전달합니다."""
        context = super().get_serializer_context()
        context["upload_folder"] = "uploads"
        return context

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        media = serializer.save()
        return success_response(
            MediaFileSerializer(media, context={"request": request}).data,
            "파일이 업로드되었습니다.",
            status.HTTP_201_CREATED,
        )


class TypedUploadView(MediaFileListUploadView):
    """파일 유형별 업로드 API 공통 부모.

    하위 클래스가 allowed_types와 upload_folder만 바꾸면 이미지/Excel/PDF 전용 검증과
    저장 폴더를 재사용할 수 있습니다.
    """

    allowed_types = None
    upload_folder = "uploads"

    def get_serializer_class(self):
        class UploadSerializer(TypedMediaFileUploadSerializer):
            allowed_types = self.allowed_types

        return UploadSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["upload_folder"] = self.upload_folder
        return context


class ImageUploadView(TypedUploadView):
    """이미지 파일 전용 업로드 API."""

    allowed_types = [MediaFile.FileType.IMAGE]
    upload_folder = "images"


class ExcelUploadView(TypedUploadView):
    """Excel 파일 전용 업로드 API."""

    allowed_types = [MediaFile.FileType.EXCEL]
    upload_folder = "excels"


class PdfUploadView(TypedUploadView):
    """PDF 파일 전용 업로드 API."""

    allowed_types = [MediaFile.FileType.PDF]
    upload_folder = "pdfs"


class MediaFileDetailView(generics.RetrieveDestroyAPIView):
    """파일 메타데이터 조회와 소프트 삭제 API."""

    serializer_class = MediaFileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return MediaFile.objects.filter(uploaded_by=self.request.user, is_deleted=False)

    def perform_destroy(self, instance):
        """파일 row와 물리 파일을 바로 지우지 않고 목록에서 제외합니다."""
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted"])


class MediaFileDownloadView(APIView):
    """인증된 업로더가 원본 파일을 다운로드하는 API."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        media = get_object_or_404(MediaFile, pk=pk, uploaded_by=request.user, is_deleted=False)
        return FileResponse(media.file.open("rb"), as_attachment=True, filename=media.original_name)


class ExcelParseView(APIView):
    """Excel 파싱 작업을 비동기 작업 로그로 접수합니다."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        media = get_object_or_404(MediaFile, pk=pk, uploaded_by=request.user, file_type=MediaFile.FileType.EXCEL)
        task = AsyncTaskLog.objects.create(
            # 실제 Celery 작업이 붙으면 이 task_id를 기준으로 진행 상태를 갱신합니다.
            task_id=uuid4().hex,
            task_type=AsyncTaskLog.TaskType.EXCEL_PARSE,
            status=AsyncTaskLog.Status.PENDING,
            result_file=media,
        )
        return success_response(AsyncTaskLogSerializer(task).data, "엑셀 파싱 작업이 접수되었습니다.", status.HTTP_202_ACCEPTED)


class AsyncTaskLogDetailView(generics.RetrieveAPIView):
    """task_id로 비동기 작업 상태를 조회하는 API."""

    serializer_class = AsyncTaskLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = "task_id"

    def get_queryset(self):
        return AsyncTaskLog.objects.all()
