from django.urls import path

from . import views

urlpatterns = [
    path("", views.NotificationListView.as_view(), name="notification-list"),
    path("unread/", views.UnreadNotificationListView.as_view(), name="notification-unread-list"),
    path("read-all/", views.NotificationReadAllView.as_view(), name="notification-read-all"),
    path("delete-all/", views.NotificationDeleteAllView.as_view(), name="notification-delete-all"),
    path("count/", views.NotificationCountView.as_view(), name="notification-count"),
    path("settings/", views.NotificationSettingView.as_view(), name="notification-settings"),
    path("stream/", views.NotificationStreamView.as_view(), name="notification-stream"),
    path("<int:pk>/", views.NotificationDetailView.as_view(), name="notification-detail"),
    path("<int:pk>/read/", views.NotificationReadView.as_view(), name="notification-read"),
    path("<int:pk>/unread/", views.NotificationUnreadView.as_view(), name="notification-unread"),
]
