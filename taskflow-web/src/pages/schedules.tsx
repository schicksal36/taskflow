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
  createSchedule,
  deleteSchedule,
  describeApiError,
  fetchGoogleCalendarSubscription,
  fetchSchedules,
  fetchTodos,
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
};

type ScheduleViewMode = "year" | "month" | "week" | "day";

const weekDayLabels = ["일", "월", "화", "수", "목", "금", "토"];

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

function cleanInput(input: ScheduleInput): ScheduleInput {
  return {
    ...input,
    is_shared: true,
    end_at: input.end_at || null,
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
  const { accessToken } = useAuth();
  const [items, setItems] = useState<Schedule[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [form, setForm] = useState<ScheduleInput>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [subscriptionUrl, setSubscriptionUrl] = useState("");
  const [googleCalendarUrl, setGoogleCalendarUrl] = useState("");
  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>("month");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [selectedDate]);
  const selectedDateSchedules = useMemo(() => schedulesForDate(items, selectedDate), [items, selectedDate]);
  const selectedDateTodos = useMemo(() => todosForDate(todos, selectedDate), [todos, selectedDate]);

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

  function startEdit(item: Schedule) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      content: item.content ?? "",
      schedule_type: item.schedule_type,
      start_at: toDateTimeInput(item.start_at),
      end_at: toDateTimeInput(item.end_at),
      location: item.location ?? "",
      is_shared: true,
      remind_at: toDateTimeInput(item.remind_at),
      color: item.color ?? "#2563eb",
      is_all_day: Boolean(item.is_all_day),
      repeat_type: item.repeat_type ?? "NONE",
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function openCreatePanel(date: Date) {
    const dateValue = formatDateInput(date);
    setSelectedDate(date);
    setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setEditingId(null);
    setForm({
      ...emptyForm,
      start_at: `${dateValue}T09:00`,
      end_at: "",
    });
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

  return (
    <AppShell
      title="공유 일정"
      description="참여자와 함께 보는 공유 일정을 관리합니다."
      actions={
        <button
          aria-expanded={isSubscriptionOpen}
          className="ghost-button"
          onClick={() => setIsSubscriptionOpen((current) => !current)}
          type="button"
        >
          구글 캘린더 구독 {isSubscriptionOpen ? "접기" : "펼치기"}
        </button>
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
                    return (
                      <button className="year-month" key={month} onClick={() => setCalendarMonth(monthDate)} type="button">
                        <strong>{month + 1}월</strong>
                        <span>{monthItems.length}건</span>
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
                      const isToday = date ? formatDateInput(date) === formatDateInput(new Date()) : false;
                      const isSelected = date ? formatDateInput(date) === formatDateInput(selectedDate) : false;

                      return (
                        <div
                          className={`calendar-day${date ? "" : " muted"}${isToday ? " today" : ""}${isSelected ? " selected" : ""}`}
                          key={date?.toISOString() ?? `empty-${index}`}
                          onClick={() => date && openCreatePanel(date)}
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
                                      startEdit(item);
                                    }}
                                    style={{ borderLeftColor: item.color ?? "#2563eb" }}
                                    type="button"
                                    title={item.title}
                                  >
                                    {viewMode === "day" && item.is_shared ? "공유 " : ""}{item.title}
                                  </button>
                                ))}
                                {dayTodos.map((todo) => (
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
                <span>{isLoading ? "조회 중" : `${items.length}건`}</span>
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
                    {items.map((item) => (
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
                    {!items.length && (
                      <tr>
                        <td colSpan={6}>{isLoading ? "조회 중입니다." : "조회된 일정이 없습니다."}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <form className="panel editor-panel schedule-side-panel" onSubmit={handleSubmit}>
          <div className="panel-head">
            <h2>{editingId ? "일정 수정" : "일정 추가"}</h2>
            <button className="ghost-button" onClick={resetForm} type="button">
              초기화
            </button>
          </div>

          <div className="panel-body form-stack">
            <label>
              <span>제목</span>
              <input
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                required
                value={form.title}
              />
            </label>

            <label>
              <span>내용</span>
              <textarea
                onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                rows={4}
                value={form.content}
              />
            </label>

            <div className="form-grid two">
              <label>
                <span>구분</span>
                <input
                  onChange={(event) => setForm((current) => ({ ...current, schedule_type: event.target.value }))}
                  placeholder="예: 회의, 외근, 프로젝트"
                  value={form.schedule_type}
                />
              </label>
              <label>
                <span>장소</span>
                <input
                  onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                  value={form.location}
                />
              </label>
            </div>

            <div className="form-grid two">
              <label>
                <span>시작</span>
                <input
                  onChange={(event) => setForm((current) => ({ ...current, start_at: event.target.value }))}
                  required
                  type="datetime-local"
                  value={form.start_at}
                />
              </label>
              <label>
                <span>종료 선택사항</span>
                <input
                  onChange={(event) => setForm((current) => ({ ...current, end_at: event.target.value }))}
                  type="datetime-local"
                  value={form.end_at ?? ""}
                />
              </label>
            </div>

            <div className="form-grid two">
              <label>
                <span>색상</span>
                <input
                  onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
                  type="color"
                  value={form.color}
                />
              </label>
              <label>
                <span>알림일</span>
                <input
                  onChange={(event) => setForm((current) => ({ ...current, remind_at: event.target.value }))}
                  type="datetime-local"
                  value={form.remind_at ?? ""}
                />
              </label>
            </div>

            <div className="form-row">
              <label className="check-label">
                <input
                  checked={Boolean(form.is_all_day)}
                  onChange={(event) => setForm((current) => ({ ...current, is_all_day: event.target.checked }))}
                  type="checkbox"
                />
                종일 일정
              </label>
            </div>

            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "저장 중" : editingId ? "수정" : "등록"}
            </button>
          </div>
        </form>
      </section>
    </AppShell>
  );
}
