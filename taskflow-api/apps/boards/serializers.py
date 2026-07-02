"""게시판 API의 serializer."""

from rest_framework import serializers

from apps.media_files.models import MediaFile

from .models import BoardComment, BoardCommentFile, BoardFile, BoardLike, BoardPost


class BoardPostListSerializer(serializers.ModelSerializer):
    """게시글 목록용 serializer.

    목록에서는 본문 전체를 제외하고 카운트/공지/고정 상태를 중심으로 내려줍니다.
    """

    author_name = serializers.SerializerMethodField()
    author_email = serializers.EmailField(source="author.email", read_only=True)
    author_department = serializers.CharField(source="author.department", read_only=True)
    author_position = serializers.CharField(source="author.position", read_only=True)
    file_count = serializers.IntegerField(source="files.count", read_only=True)
    is_locked = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = BoardPost
        fields = [
            "id",
            "author",
            "author_name",
            "author_email",
            "author_department",
            "author_position",
            "board_type",
            "title",
            "is_notice",
            "is_pinned",
            "permission",
            "file_count",
            "is_locked",
            "view_count",
            "like_count",
            "comment_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["author", "view_count", "like_count", "comment_count", "created_at", "updated_at"]

    def get_author_name(self, obj):
        return obj.author.first_name or obj.author.email or obj.author.username

    def get_comment_count(self, obj):
        if obj.board_type == BoardPost.BoardType.DATA_ROOM:
            return 0
        return obj.comment_count

    def get_is_locked(self, obj):
        request = self.context.get("request")
        if not request or obj.board_type != BoardPost.BoardType.DATA_ROOM:
            return False
        user = request.user
        role = getattr(user, "role", "")
        if role in {"ADMIN", "CEO", "SUPERUSER"} or obj.author_id == user.id:
            return False
        if obj.permission == BoardPost.BoardPermission.PUBLIC:
            return False
        if obj.permission == BoardPost.BoardPermission.DEPARTMENT:
            return obj.author.department != user.department
        return not obj.specific_users.filter(pk=user.pk).exists()


class BoardPostDetailSerializer(BoardPostListSerializer):
    """게시글 상세용 serializer. 본문 content를 포함합니다."""

    class Meta(BoardPostListSerializer.Meta):
        fields = BoardPostListSerializer.Meta.fields + ["content", "files", "specific_user_ids"]

    files = serializers.SerializerMethodField()
    specific_user_ids = serializers.PrimaryKeyRelatedField(source="specific_users", many=True, read_only=True)

    def get_files(self, obj):
        return BoardFileSerializer(obj.files.all(), many=True, context=self.context).data


class BoardPostCreateUpdateSerializer(serializers.ModelSerializer):
    """게시글 생성/수정 serializer.

    author는 클라이언트가 보내지 않고 request.user로 자동 저장합니다.
    """

    class Meta:
        model = BoardPost
        fields = ["id", "board_type", "title", "content", "is_notice", "is_pinned", "permission", "specific_user_ids"]

    specific_user_ids = serializers.PrimaryKeyRelatedField(
        source="specific_users",
        many=True,
        queryset=BoardPost._meta.get_field("author").remote_field.model.objects.all(),
        required=False,
    )

    def create(self, validated_data):
        users = validated_data.pop("specific_users", [])
        post = BoardPost.objects.create(author=self.context["request"].user, **validated_data)
        if users:
            post.specific_users.set(users)
        return post

    def update(self, instance, validated_data):
        users = validated_data.pop("specific_users", None)
        instance = super().update(instance, validated_data)
        if users is not None:
            instance.specific_users.set(users)
        return instance


class BoardPostPinSerializer(serializers.ModelSerializer):
    """게시글 고정 여부만 수정하는 serializer."""

    class Meta:
        model = BoardPost
        fields = ["is_pinned"]


class BoardCommentSerializer(serializers.ModelSerializer):
    """자유게시판 댓글 serializer."""

    author_name = serializers.SerializerMethodField()
    author_email = serializers.EmailField(source="author.email", read_only=True)
    author_department = serializers.CharField(source="author.department", read_only=True)
    author_position = serializers.CharField(source="author.position", read_only=True)
    files = serializers.SerializerMethodField()

    class Meta:
        model = BoardComment
        fields = [
            "id",
            "post",
            "author",
            "author_name",
            "author_email",
            "author_department",
            "author_position",
            "parent",
            "content",
            "files",
            "is_deleted",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["post", "author", "is_deleted", "created_at", "updated_at"]

    def get_author_name(self, obj):
        return obj.author.first_name or obj.author.email or obj.author.username

    def get_files(self, obj):
        return BoardCommentFileSerializer(obj.files.all(), many=True, context=self.context).data


class BoardCommentFileSerializer(serializers.ModelSerializer):
    """자유게시판 댓글 사진 첨부 serializer."""

    original_name = serializers.CharField(source="media_file.original_name", read_only=True)
    file_url = serializers.SerializerMethodField()
    file_type = serializers.CharField(source="media_file.file_type", read_only=True)
    mime_type = serializers.CharField(source="media_file.mime_type", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = BoardCommentFile
        fields = ["id", "comment", "media_file", "original_name", "file_url", "file_type", "mime_type", "download_url", "uploaded_by", "created_at"]
        read_only_fields = ["comment", "uploaded_by", "created_at"]

    def validate_media_file(self, media_file):
        if media_file.file_type != MediaFile.FileType.IMAGE:
            raise serializers.ValidationError("댓글에는 이미지 파일만 첨부할 수 있습니다.")
        if media_file.size > 5 * 1024 * 1024:
            raise serializers.ValidationError("댓글 이미지는 최대 5MB까지 첨부할 수 있습니다.")
        return media_file

    def get_file_url(self, obj):
        request = self.context.get("request")
        if not obj.media_file.file:
            return None
        url = obj.media_file.file.url
        return request.build_absolute_uri(url) if request else url

    def get_download_url(self, obj):
        request = self.context.get("request")
        url = f"/api/boards/comment-files/{obj.id}/download/"
        return request.build_absolute_uri(url) if request else url


class BoardLikeSerializer(serializers.ModelSerializer):
    """좋아요 이력 serializer."""

    class Meta:
        model = BoardLike
        fields = ["id", "post", "user", "created_at"]
        read_only_fields = ["post", "user", "created_at"]


class BoardFileSerializer(serializers.ModelSerializer):
    """게시글 첨부파일 연결 serializer."""

    original_name = serializers.CharField(source="media_file.original_name", read_only=True)
    file_url = serializers.SerializerMethodField()
    file_type = serializers.CharField(source="media_file.file_type", read_only=True)
    mime_type = serializers.CharField(source="media_file.mime_type", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = BoardFile
        fields = ["id", "post", "media_file", "original_name", "file_url", "file_type", "mime_type", "download_url", "uploaded_by", "created_at"]
        read_only_fields = ["post", "uploaded_by", "created_at"]

    def get_file_url(self, obj):
        request = self.context.get("request")
        if not obj.media_file.file:
            return None
        url = obj.media_file.file.url
        return request.build_absolute_uri(url) if request else url

    def get_download_url(self, obj):
        """프론트가 사용할 다운로드 API 경로를 만듭니다."""
        request = self.context.get("request")
        url = f"/api/boards/files/{obj.id}/download/"
        return request.build_absolute_uri(url) if request else url
