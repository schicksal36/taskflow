from django.urls import path

from . import views

urlpatterns = [
    path("", views.ScheduleListCreateView.as_view(), name="schedule-list-create"),
    path("today/", views.TodayScheduleListView.as_view(), name="schedule-today"),
    path("week/", views.WeeklyScheduleListView.as_view(), name="schedule-week"),
    path("month/", views.MonthlyScheduleListView.as_view(), name="schedule-month"),
    path("shared/me/", views.SharedScheduleListView.as_view(), name="schedule-shared-me"),
    path("created/me/", views.MyCreatedScheduleListView.as_view(), name="schedule-created-me"),
    path("search/", views.ScheduleSearchView.as_view(), name="schedule-search"),
    path("google-calendar-subscription/", views.GoogleCalendarSubscriptionView.as_view(), name="google-calendar-subscription"),
    path("google-calendar.ics", views.GoogleCalendarFeedView.as_view(), name="google-calendar-feed"),
    path("participants/<int:participant_id>/", views.ScheduleParticipantDeleteView.as_view(), name="schedule-participant-delete"),
    path("<int:pk>/", views.ScheduleDetailUpdateDeleteView.as_view(), name="schedule-detail"),
    path("<int:pk>/participants/", views.ScheduleParticipantListCreateView.as_view(), name="schedule-participants"),
    path("<int:pk>/response/", views.ScheduleResponseView.as_view(), name="schedule-response"),
    path("<int:pk>/reminder/", views.ScheduleReminderView.as_view(), name="schedule-reminder"),
]
