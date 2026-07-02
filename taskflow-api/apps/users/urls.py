from django.urls import include, path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

urlpatterns = [
    path("auth/", include("dj_rest_auth.urls")),
    path("auth/registration/", include("dj_rest_auth.registration.urls")),
    path("", views.UserListView.as_view(), name="user-list"),
    path("search/", views.UserSearchView.as_view(), name="user-search"),
    path("register/", views.RegisterView.as_view(), name="user-register"),
    path("login/", views.LoginView.as_view(), name="user-login"),
    path("logout/", views.LogoutView.as_view(), name="user-logout"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("admin/users/", views.AdminUserListView.as_view(), name="admin-user-list"),
    path("admin/users/<int:pk>/promote/", views.AdminUserPromoteView.as_view(), name="admin-user-promote"),
    path("admin/approval-requests/", views.AdminApprovalRequestListCreateView.as_view(), name="admin-approval-request-list-create"),
    path("admin/approval-requests/my/", views.MyAdminApprovalRequestView.as_view(), name="my-admin-approval-request"),
    path("admin/approval-requests/<int:pk>/", views.AdminApprovalRequestDetailView.as_view(), name="admin-approval-request-detail"),
    path("admin/approval-requests/<int:pk>/approve/", views.AdminApprovalRequestApproveView.as_view(), name="admin-approval-request-approve"),
    path("admin/approval-requests/<int:pk>/reject/", views.AdminApprovalRequestRejectView.as_view(), name="admin-approval-request-reject"),
    path("me/", views.MyInfoView.as_view(), name="user-me"),
    path("me/profile/", views.MyProfileView.as_view(), name="user-profile"),
    path("me/profile/image/", views.ProfileImageUpdateView.as_view(), name="user-profile-image"),
    path("email/verify/", views.EmailVerifySendView.as_view(), name="email-verify-send"),
    path("email/verify/confirm/", views.EmailVerifyConfirmView.as_view(), name="email-verify-confirm"),
    path("password/reset/", views.PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("password/reset/confirm/", views.PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    path("password/change/", views.PasswordChangeView.as_view(), name="password-change"),
    path("restore/request/", views.UserRestoreRequestView.as_view(), name="user-restore-request"),
    path("restore/", views.UserRestoreView.as_view(), name="user-restore"),
]
