from django.urls import path

from . import views

urlpatterns = [
    path("month/", views.CalendarMonthView.as_view(), name="calendar-month"),
    path("week/", views.CalendarWeekView.as_view(), name="calendar-week"),
    path("day/", views.CalendarDayView.as_view(), name="calendar-day"),
    path("range/", views.CalendarRangeView.as_view(), name="calendar-range"),
    path("integrated/", views.IntegratedCalendarView.as_view(), name="calendar-integrated"),
    path("schedules/", views.CalendarScheduleCreateView.as_view(), name="calendar-schedule-create"),
    path("schedules/<int:pk>/", views.CalendarScheduleUpdateView.as_view(), name="calendar-schedule-update"),
    path("schedules/<int:pk>/move/", views.CalendarScheduleMoveView.as_view(), name="calendar-schedule-move"),
    path("schedules/<int:pk>/color/", views.CalendarScheduleColorView.as_view(), name="calendar-schedule-color"),
    path("recurring/", views.RecurringScheduleCreateView.as_view(), name="calendar-recurring-create"),
    path("recurring/<int:pk>/", views.RecurringScheduleUpdateView.as_view(), name="calendar-recurring-update"),
    path("recurring/<int:pk>/delete/", views.RecurringScheduleDeleteView.as_view(), name="calendar-recurring-delete"),
    path("filters/", views.CalendarFilterView.as_view(), name="calendar-filters"),
]
