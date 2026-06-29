"""여러 앱이 함께 쓰는 공통 모델 조각."""

from django.db import models


class TimeStampedModel(models.Model):
    """생성일/수정일을 자동으로 저장하는 부모 모델.

    아이들이 공책에 날짜를 적듯이, 데이터도 언제 만들고 언제 고쳤는지
    기록해두면 나중에 찾고 정렬하기 쉽습니다.
    """

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Priority(models.TextChoices):
    """업무요청과 할 일이 공통으로 사용하는 우선순위 enum."""

    LOW = "LOW", "낮음"
    NORMAL = "NORMAL", "보통"
    HIGH = "HIGH", "높음"
    URGENT = "URGENT", "긴급"
