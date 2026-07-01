/**
 * schedules.tsx
 * 역할: 공유 일정 달력을 Google Calendar 스타일로 표시하고 일정 등록/수정/삭제 처리
 * 주요 기능:
 *   - 년/월/주/일 뷰 전환
 *   - 날짜 클릭 시 우측 일정 등록 패널 오픈
 *   - 일정 색상 표시 및 내 할일 마감기한 D-Day 표시
 *   - Google Calendar 구독 URL 발급 및 복사
 * 사용 API: GET/POST /api/schedules/, PATCH/DELETE /api/schedules/{id}/, GET /api/todos/
 */
import { useRouter } from "next/router";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  type Schedule,
  type ScheduleInput,
  type Todo,
  type UserListItem,
  createSchedule,
  deleteSchedule,
  describeApiError,
  fetchGoogleCalendarSubscription,
  fetchSchedule,
  fetchSchedules,
  fetchTodos,
  searchUsers,
  toArray,
  updateSchedule,
} from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { labelOf, scheduleTypeLabels } from "@/lib/labels";

const emptyForm: ScheduleInput = {
  title: "",
  content: "",
  schedule_type: "",
  start_at: "",
  end_at: "",
  location: "",
  is_shared: true,
  remind_at: "",
  color: "#2563eb",
  is_all_day: false,
  repeat_type: "NONE",
  participant_ids: [],
};

type ScheduleViewMode = "year" | "month" | "week" | "day";

const weekDayLabels = ["일", "월", "화", "수", "목", "금", "토"];
const scheduleTodoKeywords = ["휴가", "연차", "반차", "월차"];

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthLabel(date: Date) {
  return `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function addDays(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function startOfWeek(date: Date) {
  return addDays(date, -date.getDay());
}

function buildCalendarDays(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const dayCount = new Date(year, month + 1, 0).getDate();
  const leadingEmptyCount = firstDay.getDay();
  const cells: Array<Date | null> = [];

  for (let index = 0; index < leadingEmptyCount; index += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= dayCount; day += 1) {
    cells.push(new Date(year, month, day));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function schedulesForDate(items: Schedule[], date: Date) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();

  return items.filter((item) => {
    const start = new Date(item.start_at).getTime();
    const end = new Date(item.end_at || item.start_at).getTime();

    if (Number.isNaN(start) || Number.isNaN(end)) {
      return false;
    }

    return start <= dayEnd && end >= dayStart;
  });
}

function todosForDate(items: Todo[], date: Date) {
  const target = formatDateInput(date);
  return items.filter((item) => item.deadline_at && formatDateInput(new Date(item.deadline_at)) === target);
}

function isScheduleTodo(item: Todo) {
  const value = `${item.title} ${item.content ?? ""}`;
  return scheduleTodoKeywords.some((keyword) => value.includes(keyword));
}

function dDayLabel(value?: string | null) {
  if (!value) {
    return "";
  }
  const today = new Date();
  const due = new Date(value);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const diff = Math.round((dueStart - todayStart) / 86400000);
  if (diff === 0) {
    return "D-Day";
  }
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

function scheduleOwnerLabel(item: Schedule) {
  const name = item.owner_name || item.owner_email || "-";
  const org = [item.owner_department, item.owner_position].filter(Boolean).join("/");
  const contact = item.owner_email ? (org ? ` · ${item.owner_email}` : item.owner_email) : "";
  return org || contact ? `${name} (${org}${contact})` : name;
}

function userLabel(user: UserListItem) {
  const name = user.first_name || user.display_name || "이름 미등록";
  const department = user.department || "소속 미등록";
  const position = user.position || "직함 미등록";
  const email = user.email || user.username;
  return email ? `${name} (${department} / ${position}) · ${email}` : `${name} (${department} / ${position})`;
}

function participantUserFromSchedule(item: NonNullable<Schedule["participants"]>[number]): UserListItem {
  return {
    id: item.user,
    username: item.username || String(item.user),
    email: item.email || item.username || String(item.user),
    first_name: item.first_name || "",
    display_name: item.display_name || item.first_name || item.email || item.username || String(item.user),
    department: item.department || "",
    position: item.position || "",
  };
}

function toDateTimeInput(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 16);
  }

  return date.toISOString().slice(0, 16);
}

function splitDateTimeInput(value?: string | null) {
  const dateTime = toDateTimeInput(value);
  const [date = "", time = ""] = dateTime.split("T");
  return { date, time };
}

function combineDateTimeParts(date: string, time: string) {
  if (!date) {
    return "";
  }
  return time ? `${date}T${time}` : date;
}

function isMultiDayRange(startDate: string, endDate: string) {
  return Boolean(startDate && endDate && startDate !== endDate);
}

function normalizeTimeValue(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) {
    return digits;
  }
  return `${digits.slice(0, -2).padStart(2, "0")}:${digits.slice(-2)}`;
}

function submissionTime(value: string, fallbackTime: string) {
  const match = value.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) {
    return fallbackTime;
  }
  const hour = Number(match[1]);
  if (Number.isNaN(hour) || hour > 23) {
    return fallbackTime;
  }
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function withSubmissionTime(date: string, time: string, fallbackTime: string) {
  return date ? `${date}T${submissionTime(time, fallbackTime)}` : "";
}

function cleanInput(input: ScheduleInput): ScheduleInput {
  const start = splitDateTimeInput(input.start_at);
  const end = splitDateTimeInput(input.end_at);
  const timeOptional = Boolean(input.is_all_day || isMultiDayRange(start.date, end.date));

  return {
    ...input,
    is_shared: true,
    start_at: withSubmissionTime(start.date, start.time, timeOptional ? "00:00" : "09:00"),
    end_at: end.date ? withSubmissionTime(end.date, end.time, timeOptional ? "23:59" : start.time || "10:00") : null,
    remind_at: input.remind_at || null,
    location: input.location ?? "",
  };
}

export default function SchedulesPage() {
  /**
   * SchedulesPage 컴포넌트
   *
   * 공유 일정 메인 화면을 구성합니다.
   * JWT 인증된 사용자 기준으로 일정과 내 할일을 함께 불러와 달력에 표시하고,
   * 작성자 권한이 있는 일정은 우측 패널에서 수정/삭제할 수 있습니다.
  */
  const router = useRouter();
  const { accessToken, user } = useAuth();
  const [items, setItems] = useState<Schedule[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [form, setForm] = useState<ScheduleInput>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [participantSearch, setParticipantSearch] = useState("");
  const [participantResults, setParticipantResults] = useState<UserListItem[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<UserListItem[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [subscriptionUrl, setSubscriptionUrl] = useState("");
  const [googleCalendarUrl, setGoogleCalendarUrl] = useState("");
  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>("month");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [dayDetailDate, setDayDetailDate] = useState<Date | null>(null);

  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [selectedDate]);
  const selectedDateSchedules = useMemo(() => schedulesForDate(items, selectedDate), [items, selectedDate]);
  const selectedDateTodos = useMemo(() => todosForDate(todos, selectedDate), [todos, selectedDate]);
  const selectedDateScheduleTodos = useMemo(() => selectedDateTodos.filter(isScheduleTodo), [selectedDateTodos]);
  const selectedDateChecklistTodos = useMemo(() => selectedDateTodos.filter((todo) => !isScheduleTodo(todo)), [selectedDateTodos]);
  const myScheduleItems = useMemo(() => items.filter((item) => item.owner === user?.id), [items, user?.id]);

  function canManageSchedule(item: Schedule) {
    return item.owner === user?.id;
  }

  async function loadItems() {
    /**
     * 일정/할일 목록 조회.
     *
     * 동작 순서:
     *  1. Access Token 존재 여부 확인
     *  2. GET /api/schedules/ 호출로 공유 일정 조회
     *  3. GET /api/todos/ 호출로 내 할일 조회
     *  4. 성공 시 달력 상태 갱신, 실패 시 오류 메시지 표시
     */
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetchSchedules(accessToken);
      setItems(toArray(response));
      const todoResponse = await fetchTodos(accessToken);
      setTodos(toArray(todoResponse));
      const subscription = await fetchGoogleCalendarSubscription(accessToken);
      setSubscriptionUrl(subscription.feed_url);
      setGoogleCalendarUrl(subscription.google_url);
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    // loadItems는 저장/삭제 후에도 재사용하는 함수라 effect 의존성만 고정합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (router.query.mode === "create") {
      openCreatePanel(new Date());
    }
    // openCreatePanel은 사용자 이벤트와 공유하는 함수라 query 변화만 감지합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.mode]);

  async function startEdit(item: Schedule) {
    const target = accessToken ? await fetchSchedule(accessToken, item.id).catch(() => item) : item;
    const participants = target.participants?.map(participantUserFromSchedule) ?? [];
    setEditingId(item.id);
    setIsEditorOpen(true);
    setParticipantSearch("");
    setParticipantResults([]);
    setSelectedParticipants(participants);
    setForm({
      title: target.title,
      content: target.content ?? "",
      schedule_type: target.schedule_type,
      start_at: toDateTimeInput(target.start_at),
      end_at: toDateTimeInput(target.end_at),
      location: target.location ?? "",
      is_shared: true,
      remind_at: toDateTimeInput(target.remind_at),
      color: target.color ?? "#2563eb",
      is_all_day: Boolean(target.is_all_day),
      repeat_type: target.repeat_type ?? "NONE",
      participant_ids: participants.map((participant) => participant.id),
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setParticipantSearch("");
    setParticipantResults([]);
    setSelectedParticipants([]);
    setIsEditorOpen(false);
  }

  function openCreatePanel(date: Date) {
    const dateValue = formatDateInput(date);
    setSelectedDate(date);
    setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setDayDetailDate(null);
    setEditingId(null);
    setParticipantSearch("");
    setParticipantResults([]);
    setSelectedParticipants([]);
    setIsEditorOpen(true);
    setForm({
      ...emptyForm,
      start_at: `${dateValue}T09:00`,
      end_at: `${dateValue}T10:00`,
    });
  }

  async function handleParticipantSearch(value: string) {
    setParticipantSearch(value);
    if (!accessToken || value.trim().length < 1) {
      setParticipantResults([]);
      return;
    }
    try {
      const selectedIds = new Set(selectedParticipants.map((participant) => participant.id));
      setParticipantResults(
        toArray(await searchUsers(accessToken, value)).filter((entry) => entry.id !== user?.id && !selectedIds.has(entry.id)),
      );
    } catch {
      setParticipantResults([]);
    }
  }

  function selectParticipant(nextUser: UserListItem) {
    setSelectedParticipants((current) => (current.some((entry) => entry.id === nextUser.id) ? current : [...current, nextUser]));
    setForm((current) => ({
      ...current,
      participant_ids: Array.from(new Set([...(current.participant_ids ?? []), nextUser.id])),
    }));
    setParticipantSearch("");
    setParticipantResults([]);
  }

  function removeParticipant(id: number) {
    setSelectedParticipants((current) => current.filter((entry) => entry.id !== id));
    setForm((current) => ({
      ...current,
      participant_ids: (current.participant_ids ?? []).filter((entryId) => entryId !== id),
    }));
  }

  function openDayDetail(date: Date) {
    setSelectedDate(date);
    setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setDayDetailDate(date);
  }

  function shiftCalendar(amount: number) {
    if (viewMode === "year") {
      const next = new Date(calendarMonth.getFullYear() + amount, calendarMonth.getMonth(), 1);
      setCalendarMonth(next);
      setSelectedDate(next);
      return;
    }
    if (viewMode === "week") {
      const next = addDays(selectedDate, amount * 7);
      setSelectedDate(next);
      setCalendarMonth(new Date(next.getFullYear(), next.getMonth(), 1));
      return;
    }
    if (viewMode === "day") {
      const next = addDays(selectedDate, amount);
      setSelectedDate(next);
      setCalendarMonth(new Date(next.getFullYear(), next.getMonth(), 1));
      return;
    }
    const next = addMonths(calendarMonth, amount);
    setCalendarMonth(next);
    setSelectedDate(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    /**
     * 일정 등록/수정 처리.
     *
     * 동작 순서:
     *  1. 폼 기본 submit 차단
     *  2. editingId가 있으면 PATCH /api/schedules/{id}/ 호출
     *  3. editingId가 없으면 POST /api/schedules/ 호출
     *  4. 성공 시 폼 초기화 및 목록 재조회
     */
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      if (editingId) {
        await updateSchedule(accessToken, editingId, cleanInput(form));
      } else {
        await createSchedule(accessToken, cleanInput(form));
      }
      resetForm();
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!accessToken) {
      return;
    }

    try {
      await deleteSchedule(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleCopySubscriptionUrl() {
    /**
     * Google Calendar 구독 URL 복사.
     *
     * 동작 순서:
     *  1. 발급된 feed_url 존재 여부 확인
     *  2. 브라우저 clipboard API로 URL 복사
     *  3. 성공/실패 메시지를 화면에 표시
     */
    if (!subscriptionUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(subscriptionUrl);
      setMessage("Google Calendar 구독 URL을 복사했습니다.");
    } catch {
      setMessage("구독 URL 복사에 실패했습니다.");
    }
  }

  const startDateTime = splitDateTimeInput(form.start_at);
  const endDateTime = splitDateTimeInput(form.end_at);
  const remindDateTime = splitDateTimeInput(form.remind_at);
  const timeOptional = Boolean(form.is_all_day || isMultiDayRange(startDateTime.date, endDateTime.date));

  return (
    <AppShell
      title="공유 일정"
      description="참여자와 함께 보는 공유 일정을 관리합니다."
      actions={
        <>
          <button className="primary-button" onClick={() => openCreatePanel(selectedDate)} type="button">
            일정 등록
          </button>
          <button
            aria-expanded={isSubscriptionOpen}
            className="ghost-button"
            onClick={() => setIsSubscriptionOpen((current) => !current)}
            type="button"
          >
            구글 캘린더 구독 {isSubscriptionOpen ? "접기" : "펼치기"}
          </button>
        </>
      }
    >
      {message && <p className="notice error">{message}</p>}

      {isSubscriptionOpen && (
        <div className="calendar-subscription schedule-subscription-panel">
          <div>
            <strong>Google Calendar 구독</strong>
            <span>TaskFlow 일정과 내 할일 마감기한을 외부 캘린더에서 자동으로 볼 수 있습니다.</span>
          </div>
          <div className="table-actions">
            <button className="ghost-button" disabled={!subscriptionUrl} onClick={handleCopySubscriptionUrl} type="button">
              URL 복사
            </button>
            <a className="primary-button" href={googleCalendarUrl || "#"} rel="noreferrer" target="_blank">
              구글캘린더 추가
            </a>
          </div>
        </div>
      )}

      <section className="schedule-workspace">
        <section className="panel editor-panel schedule-main-panel">
          <div className="panel-head">
            <h2>{formatMonthLabel(calendarMonth)}</h2>
            <div className="table-actions">
              {(["year", "month", "week", "day"] as ScheduleViewMode[]).map((mode) => (
                <button
                  className={viewMode === mode ? "primary-button" : "ghost-button"}
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  type="button"
                >
                  {mode === "year" ? "년" : mode === "month" ? "월" : mode === "week" ? "주" : "일"}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-body">
            <div className="schedule-calendar">
              <div className="calendar-toolbar">
                <button className="ghost-button" onClick={() => shiftCalendar(-1)} type="button">
                  이전
                </button>
                <strong>{viewMode === "day" ? formatDate(selectedDate.toISOString()) : viewMode === "year" ? `${calendarMonth.getFullYear()}` : formatMonthLabel(calendarMonth)}</strong>
                <div className="table-actions">
                  <button
                    className="ghost-button"
                    onClick={() => {
                      const today = new Date();
                      setSelectedDate(today);
                      setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                    }}
                    type="button"
                  >
                    오늘
                  </button>
                  <button className="ghost-button" onClick={() => shiftCalendar(1)} type="button">
                    다음
                  </button>
                </div>
              </div>

              {viewMode === "year" ? (
                <div className="year-calendar-grid">
                  {Array.from({ length: 12 }, (_, month) => {
                    const monthDate = new Date(calendarMonth.getFullYear(), month, 1);
                    const monthItems = items.filter((item) => new Date(item.start_at).getMonth() === month && new Date(item.start_at).getFullYear() === calendarMonth.getFullYear());
                    const monthScheduleTodos = todos.filter((todo) => todo.deadline_at && isScheduleTodo(todo) && new Date(todo.deadline_at).getMonth() === month && new Date(todo.deadline_at).getFullYear() === calendarMonth.getFullYear());
                    return (
                      <button className="year-month" key={month} onClick={() => setCalendarMonth(monthDate)} type="button">
                        <strong>{month + 1}월</strong>
                        <span>{monthItems.length + monthScheduleTodos.length}건</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <>
                  <div className="calendar-grid calendar-weekdays">
                    {(viewMode === "week" || viewMode === "day" ? weekDays : weekDayLabels).map((label) => (
                      <span key={typeof label === "string" ? label : label.toISOString()}>{typeof label === "string" ? label : `${weekDayLabels[label.getDay()]} ${label.getDate()}`}</span>
                    ))}
                  </div>
                  <div className={`calendar-grid ${viewMode === "day" ? "day-view" : ""}`}>
                    {(viewMode === "week" ? weekDays : viewMode === "day" ? [selectedDate] : calendarDays).map((date, index) => {
                      const daySchedules = date ? schedulesForDate(items, date) : [];
                      const dayTodos = date ? todosForDate(todos, date) : [];
                      const dayScheduleTodos = dayTodos.filter(isScheduleTodo);
                      const dayChecklistTodos = dayTodos.filter((todo) => !isScheduleTodo(todo));
                      const isToday = date ? formatDateInput(date) === formatDateInput(new Date()) : false;
                      const isSelected = date ? formatDateInput(date) === formatDateInput(selectedDate) : false;

                      return (
                        <div
                          className={`calendar-day${date ? "" : " muted"}${isToday ? " today" : ""}${isSelected ? " selected" : ""}`}
                          key={date?.toISOString() ?? `empty-${index}`}
                          onClick={() => date && openDayDetail(date)}
                          onDoubleClick={(event) => {
                            if (!date) {
                              return;
                            }
                            event.stopPropagation();
                            openCreatePanel(date);
                          }}
                        >
                          {date && (
                            <>
                              <span className="calendar-date">{date.getDate()}</span>
                              <div className="calendar-events">
                                {daySchedules.map((item) => (
                                  <button
                                    className={`calendar-event${viewMode === "day" && item.is_shared ? " shared-event" : ""}`}
                                    key={item.id}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (canManageSchedule(item)) {
                                        startEdit(item);
                                      } else if (date) {
                                        openDayDetail(date);
                                      }
                                    }}
                                    style={{ borderLeftColor: item.color ?? "#2563eb" }}
                                    type="button"
                                    title={item.title}
                                  >
                                    {viewMode === "day" && item.is_shared ? "공유 " : ""}{item.title}
                                  </button>
                                ))}
                                {dayScheduleTodos.map((todo) => (
                                  <button className="calendar-event schedule-todo-event" key={`schedule-todo-${todo.id}`} type="button">
                                    {dDayLabel(todo.deadline_at)} {todo.title}
                                  </button>
                                ))}
                                {dayChecklistTodos.map((todo) => (
                                  <button className="calendar-event todo-event" key={`todo-${todo.id}`} type="button">
                                    {dDayLabel(todo.deadline_at)} {todo.title}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="schedule-list-under">
              <div className="panel-head compact-head">
                <h2>일정 목록</h2>
                <span>{isLoading ? "조회 중" : `${myScheduleItems.length}건`}</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>제목</th>
                      <th>구분</th>
                      <th>시작</th>
                      <th>종료</th>
                      <th>장소</th>
                      <th>관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myScheduleItems.map((item) => (
                      <tr key={item.id}>
                        <td>{item.title}</td>
                        <td>{labelOf(scheduleTypeLabels, item.schedule_type)}</td>
                        <td>{formatDateTime(item.start_at)}</td>
                        <td>{formatDateTime(item.end_at)}</td>
                        <td>{item.location || "-"}</td>
                        <td className="table-actions">
                          <button className="ghost-button" onClick={() => startEdit(item)} type="button">
                            수정
                          </button>
                          <button className="danger-button" onClick={() => handleDelete(item.id)} type="button">
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!myScheduleItems.length && (
                      <tr>
                        <td colSpan={6}>{isLoading ? "조회 중입니다." : "내가 등록한 일정이 없습니다."}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

      </section>

      {isEditorOpen && (
        <div className="modal-backdrop">
          <form className="modal-panel schedule-editor-modal" onSubmit={handleSubmit}>
            <div className="schedule-editor-head">
              <button aria-label="닫기" className="icon-button" onClick={resetForm} type="button">
                ×
              </button>
              <input
                aria-label="일정 제목"
                className="schedule-title-input"
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="제목 추가"
                required
                value={form.title}
              />
            </div>

            <div className="schedule-editor-body">
              <div className="schedule-editor-icon" aria-hidden="true">•</div>
              <div className="schedule-time-row">
                <input
                  aria-label="시작일"
                  onChange={(event) => setForm((current) => ({ ...current, start_at: combineDateTimeParts(event.target.value, startDateTime.time) }))}
                  required
                  type="date"
                  value={startDateTime.date}
                />
                <input
                  aria-label="시작시간"
                  className="time-text-input"
                  inputMode="numeric"
                  maxLength={5}
                  onChange={(event) => setForm((current) => ({ ...current, start_at: combineDateTimeParts(startDateTime.date, normalizeTimeValue(event.target.value)) }))}
                  pattern="[0-2][0-9]:[0-5][0-9]"
                  placeholder={timeOptional ? "선택" : "09:00"}
                  value={startDateTime.time}
                />
                <span>-</span>
                <input
                  aria-label="종료시간"
                  className="time-text-input"
                  inputMode="numeric"
                  maxLength={5}
                  onChange={(event) => setForm((current) => ({ ...current, end_at: combineDateTimeParts(endDateTime.date || startDateTime.date, normalizeTimeValue(event.target.value)) }))}
                  pattern="[0-2][0-9]:[0-5][0-9]"
                  placeholder={timeOptional ? "선택" : "10:00"}
                  value={endDateTime.time}
                />
                <input
                  aria-label="종료일"
                  onChange={(event) => setForm((current) => ({ ...current, end_at: combineDateTimeParts(event.target.value, endDateTime.time || startDateTime.time) }))}
                  type="date"
                  value={endDateTime.date || startDateTime.date}
                />
              </div>

              <div />
              <div className="schedule-inline-options">
                <label className="check-label">
                  <input
                    checked={Boolean(form.is_all_day)}
                    onChange={(event) => setForm((current) => ({ ...current, is_all_day: event.target.checked }))}
                    type="checkbox"
                  />
                  종일
                </label>
                <span>반복 안함</span>
              </div>

              <div className="schedule-editor-icon" aria-hidden="true">i</div>
              <div className="schedule-editor-tabs">
                <button className="active" type="button">일정 세부정보</button>
                <button type="button">시간 찾기</button>
              </div>

              <div className="schedule-editor-icon" aria-hidden="true">⌖</div>
              <input
                onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                placeholder="위치 추가"
                value={form.location}
              />

              <div className="schedule-editor-icon" aria-hidden="true">@</div>
              <div className="assignee-search schedule-participant-field">
                <span className="schedule-field-label">참석자 추가</span>
                <input
                  aria-label="참석자 추가"
                  onChange={(event) => handleParticipantSearch(event.target.value)}
                  placeholder="이름, 이메일, 부서, 직함 검색"
                  value={participantSearch}
                />
                {!!participantResults.length && (
                  <div className="assignee-dropdown">
                    {participantResults.map((entry) => (
                      <button key={entry.id} onClick={() => selectParticipant(entry)} type="button">
                        {userLabel(entry)}
                      </button>
                    ))}
                  </div>
                )}
                {!!selectedParticipants.length && (
                  <div className="recipient-picker schedule-participant-picker">
                    {selectedParticipants.map((participant) => (
                      <button className="recipient-option" key={participant.id} onClick={() => removeParticipant(participant.id)} type="button">
                        {userLabel(participant)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="schedule-editor-icon" aria-hidden="true">!</div>
              <div className="schedule-time-row compact">
                <input
                  aria-label="알림일"
                  onChange={(event) => setForm((current) => ({ ...current, remind_at: combineDateTimeParts(event.target.value, remindDateTime.time || startDateTime.time) }))}
                  type="date"
                  value={remindDateTime.date}
                />
                <input
                  aria-label="알림시간"
                  className="time-text-input"
                  inputMode="numeric"
                  maxLength={5}
                  onChange={(event) => setForm((current) => ({ ...current, remind_at: combineDateTimeParts(remindDateTime.date || startDateTime.date, normalizeTimeValue(event.target.value)) }))}
                  pattern="[0-2][0-9]:[0-5][0-9]"
                  placeholder="09:00"
                  value={remindDateTime.time}
                />
              </div>

              <div className="schedule-editor-icon" aria-hidden="true">▣</div>
              <div className="schedule-time-row compact">
                <input
                  onChange={(event) => setForm((current) => ({ ...current, schedule_type: event.target.value }))}
                  placeholder="구분 추가"
                  value={form.schedule_type}
                />
                <input
                  aria-label="색상"
                  onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
                  type="color"
                  value={form.color}
                />
              </div>

              <div className="schedule-editor-icon" aria-hidden="true">≡</div>
              <textarea
                onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                placeholder="설명 추가"
                rows={7}
                value={form.content}
              />
            </div>

            <div className="schedule-editor-actions">
              <button className="ghost-button" onClick={resetForm} type="button">취소</button>
              <button className="primary-button" disabled={isSaving} type="submit">
                {isSaving ? "저장 중" : editingId ? "수정" : "등록"}
              </button>
            </div>
          </form>
        </div>
      )}

      {dayDetailDate && (
        <div className="modal-backdrop">
          <div className="modal-panel report-detail-modal schedule-day-modal">
            <div className="panel-head">
              <h2>일정 내용</h2>
              <button className="ghost-button" onClick={() => setDayDetailDate(null)} type="button">
                닫기
              </button>
            </div>

            <div className="report-detail-head">
              <strong>{formatDate(dayDetailDate.toISOString())}</strong>
              <span>{selectedDateSchedules.length + selectedDateTodos.length}건</span>
            </div>

            <section className="report-detail-section">
              <h3>일정</h3>
              {selectedDateSchedules.length || selectedDateScheduleTodos.length ? (
                <div className="schedule-detail-list">
                  {selectedDateSchedules.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (canManageSchedule(item)) {
                          startEdit(item);
                          setDayDetailDate(null);
                        }
                      }}
                      style={{ borderLeftColor: item.color ?? "#2563eb" }}
                      type="button"
                    >
                      <strong>{item.title}</strong>
                      <span>{labelOf(scheduleTypeLabels, item.schedule_type)} · {formatDateTime(item.start_at)}</span>
                      <small>작성자 {scheduleOwnerLabel(item)}</small>
                      {item.location && <small>{item.location}</small>}
                    </button>
                  ))}
                  {selectedDateScheduleTodos.map((todo) => (
                    <button className="schedule-todo-detail" key={`schedule-todo-detail-${todo.id}`} type="button">
                      <strong>{todo.title}</strong>
                      <span>체크리스트 일정 · {formatDateTime(todo.deadline_at)}</span>
                      <small>{dDayLabel(todo.deadline_at)}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="report-detail-empty">등록된 일정이 없습니다.</p>
              )}
            </section>

            <section className="report-detail-section">
              <h3>체크리스트 마감</h3>
              {selectedDateChecklistTodos.length ? (
                <div className="checklist-detail-list">
                  {selectedDateChecklistTodos.map((todo) => (
                    <label key={todo.id}>
                      <input checked={todo.status === "DONE"} readOnly type="checkbox" />
                      <span>{dDayLabel(todo.deadline_at)} {todo.title}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="report-detail-empty">마감 예정 체크리스트가 없습니다.</p>
              )}
            </section>

            <button className="primary-button" onClick={() => openCreatePanel(dayDetailDate)} type="button">
              일정 등록
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
