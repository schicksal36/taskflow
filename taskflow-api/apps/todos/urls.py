from django.urls import path

from . import views

urlpatterns = [
    path("", views.TodoListCreateView.as_view(), name="todo-list-create"),
    path("today/", views.TodayTodoListView.as_view(), name="todo-today"),
    path("doing/", views.DoingTodoListView.as_view(), name="todo-doing"),
    path("done/", views.DoneTodoListView.as_view(), name="todo-done"),
    path("important/", views.ImportantTodoListView.as_view(), name="todo-important"),
    path("due-soon/", views.TodoDueSoonView.as_view(), name="todo-due-soon"),
    path("overdue/", views.OverdueTodoListView.as_view(), name="todo-overdue"),
    path("search/", views.TodoSearchView.as_view(), name="todo-search"),
    path("<int:pk>/", views.TodoDetailUpdateDeleteView.as_view(), name="todo-detail"),
    path("<int:pk>/status/", views.TodoStatusView.as_view(), name="todo-status"),
    path("<int:pk>/complete/", views.TodoCompleteView.as_view(), name="todo-complete"),
    path("<int:pk>/cancel-complete/", views.TodoCancelCompleteView.as_view(), name="todo-cancel-complete"),
    path("<int:pk>/deadline/", views.TodoDeadlineView.as_view(), name="todo-deadline"),
    path("<int:pk>/priority/", views.TodoPriorityView.as_view(), name="todo-priority"),
    path("<int:pk>/items/", views.TodoItemListCreateView.as_view(), name="todo-items"),
    path("items/<int:item_id>/", views.TodoItemDetailView.as_view(), name="todo-item-detail"),
    path("items/<int:item_id>/check/", views.TodoItemCheckView.as_view(), name="todo-item-check"),
    path("items/<int:item_id>/uncheck/", views.TodoItemUncheckView.as_view(), name="todo-item-uncheck"),
]
