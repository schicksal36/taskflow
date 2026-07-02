"""TaskFlow 전체 URL 입구.

브라우저나 프론트엔드가 `/api/work-requests/`처럼 주소를 부르면,
이 파일이 "그 주소는 work_requests 앱으로 가세요"라고 길을 안내합니다.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework_simplejwt.views import TokenRefreshView

from apps.users import views as user_views

urlpatterns = [
    path("", RedirectView.as_view(url=settings.FRONTEND_URL, permanent=False), name="frontend"),
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/schema/swagger-ui/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("swagger-ui/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui-legacy"),
    path("api/auth/register/", user_views.RegisterView.as_view(), name="auth-register"),
    path("api/auth/login/", user_views.LoginView.as_view(), name="auth-login"),
    path("api/auth/token/refresh/", TokenRefreshView.as_view(), name="auth-token-refresh"),
    path("api/profile/", user_views.MyInfoView.as_view(), name="profile"),
    path("api/profile/change-password/", user_views.PasswordChangeView.as_view(), name="profile-change-password"),
    path("api/admin/users/", user_views.AdminUserListView.as_view(), name="admin-users"),
    path("api/admin/users/<int:pk>/promote/", user_views.AdminUserPromoteView.as_view(), name="admin-user-promote"),
    path("api/admin/approval-requests/", user_views.AdminApprovalRequestListCreateView.as_view(), name="admin-approval-requests"),
    path("api/admin/approval-requests/my/", user_views.MyAdminApprovalRequestView.as_view(), name="admin-approval-request-my"),
    path("api/admin/approval-requests/<int:pk>/", user_views.AdminApprovalRequestDetailView.as_view(), name="admin-approval-request-detail"),
    path("api/admin/approval-requests/<int:pk>/approve/", user_views.AdminApprovalRequestApproveView.as_view(), name="admin-approval-request-approve"),
    path("api/admin/approval-requests/<int:pk>/reject/", user_views.AdminApprovalRequestRejectView.as_view(), name="admin-approval-request-reject"),
    path("api/users/", include("apps.users.urls")),
    path("api/work-requests/", include("apps.work_requests.urls")),
    path("api/todos/", include("apps.todos.urls")),
    path("api/schedules/", include("apps.schedules.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
    path("api/media/", include("apps.media_files.urls")),
    path("api/boards/", include("apps.boards.urls")),
    path("api/freeboard/", include("apps.boards.freeboard_urls")),
    path("api/reports/", include("apps.reports.urls")),
    path("api/calendar/", include("apps.schedules.calendar_urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
