"""공통 파일 업로드/다운로드 API의 serializer.

확장자 기반 파일 유형 판별, 업로드 크기 제한, URL 생성, 비동기 작업 상태 응답을
담당합니다.
"""

from pathlib import Path

from rest_framework import serializers

from .models import AsyncTaskLog, MediaFile

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}
EXCEL_EXTENSIONS = {".xlsx", ".xls"}
PDF_EXTENSIONS = {".pdf"}
ALLOWED_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".mov", ".wmv",
    ".mp3", ".wav", ".aac",
    ".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt", ".pdf", ".txt", ".xml", ".csv",
    ".hwp", ".hwpx", ".hml",
    ".py", ".js", ".ts", ".html", ".css", ".java", ".c", ".cpp", ".cs", ".php", ".rb", ".go", ".rs", ".sql", ".sh",
    ".json", ".yaml", ".yml",
    ".zip", ".tar", ".gz", ".tgz", ".rar", ".7z", ".bz2", ".xz",
} | IMAGE_EXTENSIONS | EXCEL_EXTENSIONS | PDF_EXTENSIONS
MAX_UPLOAD_SIZE = 50 * 1024 * 1024


def detect_file_type(filename: str) -> str:
    """확장자를 기준으로 파일 유형 enum을 결정합니다."""
    ext = Path(filename).suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        return MediaFile.FileType.IMAGE
    if ext in EXCEL_EXTENSIONS:
        return MediaFile.FileType.EXCEL
    if ext in PDF_EXTENSIONS:
        return MediaFile.FileType.PDF
    return MediaFile.FileType.ETC


class MediaFileSerializer(serializers.ModelSerializer):
    """파일 목록/상세 응답 serializer.

    file_url은 브라우저가 직접 접근할 수 있는 미디어 경로이고, download_url은 인증을
    거치는 다운로드 API 경로입니다.
    """

    file_url = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()
    uploaded_by_name = serializers.CharField(source="uploaded_by.username", read_only=True)

    class Meta:
        model = MediaFile
        fields = [
            "id",
            "file",
            "file_url",
            "download_url",
            "original_name",
            "stored_name",
            "file_type",
            "mime_type",
            "size",
            "uploaded_by",
            "uploaded_by_name",
            "target_app",
            "target_id",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "file_url",
            "download_url",
            "original_name",
            "stored_name",
            "file_type",
            "mime_type",
            "size",
            "uploaded_by",
            "created_at",
        ]

    def get_file_url(self, obj):
        """MEDIA_URL 기반 파일 접근 주소를 만듭니다."""
        request = self.context.get("request")
        if not obj.file:
            return None
        url = obj.file.url
        return request.build_absolute_uri(url) if request else url

    def get_download_url(self, obj):
        """권한 검사를 통과해야 받을 수 있는 다운로드 API 주소를 만듭니다."""
        request = self.context.get("request")
        url = f"/api/media/files/{obj.id}/download/"
        return request.build_absolute_uri(url) if request else url


class MediaFileUploadSerializer(serializers.ModelSerializer):
    """공통 파일 업로드 serializer."""

    class Meta:
        model = MediaFile
        fields = ["file", "target_app", "target_id"]

    def validate_file(self, file):
        """허용 확장자와 최대 크기 50MB를 검증합니다."""
        ext = Path(file.name).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise serializers.ValidationError("업무요청에서 허용하는 파일 형식만 업로드할 수 있습니다.")
        if file.size > MAX_UPLOAD_SIZE:
            raise serializers.ValidationError("파일은 최대 50MB까지 업로드할 수 있습니다.")
        return file

    def create(self, validated_data):
        """업로드 파일을 MediaFile row로 저장하고 저장 파일명을 기록합니다."""
        file = validated_data["file"]
        media = MediaFile.objects.create(
            file=file,
            original_name=file.name,
            file_type=detect_file_type(file.name),
            mime_type=getattr(file, "content_type", "") or "",
            size=file.size,
            uploaded_by=self.context["request"].user,
            upload_folder=self.context.get("upload_folder", "uploads"),
            **{k: v for k, v in validated_data.items() if k != "file"},
        )
        media.stored_name = Path(media.file.name).name
        media.save(update_fields=["stored_name"])
        return media


class TypedMediaFileUploadSerializer(MediaFileUploadSerializer):
    """이미지/Excel/PDF 전용 업로드 endpoint에서 사용하는 제한 serializer."""

    allowed_types = None

    def validate_file(self, file):
        file = super().validate_file(file)
        file_type = detect_file_type(file.name)
        if self.allowed_types and file_type not in self.allowed_types:
            raise serializers.ValidationError("이 업로드 주소에서 허용하지 않는 파일 형식입니다.")
        return file


class AsyncTaskLogSerializer(serializers.ModelSerializer):
    """비동기 작업 상태 응답 serializer."""

    class Meta:
        model = AsyncTaskLog
        fields = ["task_id", "task_type", "status", "result_file", "error_message", "created_at", "updated_at"]
