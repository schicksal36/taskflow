import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from .models import MediaFile

TEMP_MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=TEMP_MEDIA_ROOT)
class MediaFileApiTests(APITestCase):
    """파일 API 테스트.

    실제 파일은 테스트용 임시 폴더에 저장합니다.
    테스트가 끝나면 그 폴더를 지워서 실무 파일 보관함을 건드리지 않습니다.
    """

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEMP_MEDIA_ROOT, ignore_errors=True)

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user("fileuser", "fileuser@example.com", "StrongPass123!")
        self.client.force_authenticate(self.user)

    def test_pdf_upload(self):
        file = SimpleUploadedFile("request.pdf", b"%PDF-1.4 test", content_type="application/pdf")
        response = self.client.post(
            "/api/media/pdfs/",
            {"file": file, "target_app": "WORK_REQUEST", "target_id": 1},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        media_file = MediaFile.objects.get(original_name="request.pdf")
        self.assertEqual(media_file.file_type, MediaFile.FileType.PDF)
