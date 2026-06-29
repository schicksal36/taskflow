/**
 * dashboard.tsx
 * 역할: 로그인 사용자의 업무요청, 할일, 일정, 알림, 업무보고/경비 현황을 한 화면에 요약
 * 주요 기능:
 *   - 여러 API를 병렬 호출해 대시보드 카드와 목록 구성
 *   - 일부 API 실패 시 전체 화면을 막지 않고 실패 메시지만 표시
 *   - 오늘 할일/오늘 일정/최근 알림/보고 현황 표시
 * 사용 API: /api/work-requests/*, /api/todos/today/, /api/schedules/today/, /api/notifications/unread/, /api/reports/*
 */
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import {
  type Notification,
  type Report,
  type Schedule,
  type Todo,
  type WorkRequest,
  describeApiError,
  fetchAssignedWorkRequests,
  fetchExpenseReports,
  fetchInProgressWorkRequests,
  fetchTodaySchedules,
  fetchTodayTodos,
  fetchUnreadNotifications,
  fetchWorkReports,
  toArray,
} from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { labelOf, priorityLabels, reportStatusLabels, scheduleTypeLabels, todoStatusLabels, workStatusLabels } from "@/lib/labels";

type DashboardState = {
  inProgress: WorkRequest[];
  assigned: WorkRequest[];
  todos: Todo[];
  schedules: Schedule[];
  notifications: Notification[];
  workReports: Report[];
  expenseReports: Report[];
};

const initialState: DashboardState = {
  inProgress: [],
  assigned: [],
  todos: [],
  schedules: [],
  notifications: [],
  workReports: [],
  expenseReports: [],
};

export default function DashboardPage() {
  const { accessToken } = useAuth();
  const [state, setState] = useState<DashboardState>(initialState);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      /**
       * 대시보드 데이터 병렬 조회.
       *
       * 동작 순서:
       *  1. Access Token 확인
       *  2. 업무요청/할일/일정/알림/보고 API를 Promise.allSettled로 병렬 호출
       *  3. 성공한 API는 화면에 반영하고 실패한 API는 빈 목록 처리
       *  4. 하나라도 실패하면 첫 실패 메시지를 상단 notice로 표시
       */
      if (!accessToken) {
        return;
      }

      setIsLoading(true);
      setMessage("");

      const [inProgress, assigned, todos, schedules, notifications, workReports, expenseReports] =
        await Promise.allSettled([
          fetchInProgressWorkRequests(accessToken),
          fetchAssignedWorkRequests(accessToken),
          fetchTodayTodos(accessToken),
          fetchTodaySchedules(accessToken),
          fetchUnreadNotifications(accessToken),
          fetchWorkReports(accessToken),
          fetchExpenseReports(accessToken),
        ]);

      if (!isMounted) {
        return;
      }

      setState({
        inProgress: inProgress.status === "fulfilled" ? toArray(inProgress.value) : [],
        assigned: assigned.status === "fulfilled" ? toArray(assigned.value) : [],
        todos: todos.status === "fulfilled" ? toArray(todos.value) : [],
        schedules: schedules.status === "fulfilled" ? toArray(schedules.value) : [],
        notifications: notifications.status === "fulfilled" ? toArray(notifications.value) : [],
        workReports: workReports.status === "fulfilled" ? toArray(workReports.value) : [],
        expenseReports: expenseReports.status === "fulfilled" ? toArray(expenseReports.value) : [],
      });

      const failed = [inProgress, assigned, todos, schedules, notifications, workReports, expenseReports].find(
        (result) => result.status === "rejected",
      );
      setMessage(failed?.status === "rejected" ? describeApiError(failed.reason) : "");
      setIsLoading(false);
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [accessToken]);

  return (
    <AppShell title="대시보드" description="백엔드 API에서 조회한 현재 업무 현황입니다.">
      {message && <p className="notice error">{message}</p>}

      <section className="stat-grid">
        <StatCard label="진행중 업무" value={state.inProgress.length} tone="blue" />
        <StatCard label="오늘 할 일" value={state.todos.length} tone="green" />
        <StatCard label="오늘 일정" value={state.schedules.length} tone="purple" />
        <StatCard label="미확인 알림" value={state.notifications.length} tone="orange" />
        <StatCard label="업무보고" value={state.workReports.length} tone="blue" />
        <StatCard label="경비지출" value={state.expenseReports.length} tone="red" />
      </section>

      <section className="dashboard-grid">
        <article className="panel wide">
          <div className="panel-head">
            <h2>내 업무 현황</h2>
            <span>{isLoading ? "조회 중" : `${state.assigned.length}건`}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>업무명</th>
                  <th>상태</th>
                  <th>우선순위</th>
                  <th>마감일</th>
                </tr>
              </thead>
              <tbody>
                {state.assigned.slice(0, 5).map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>
                      <span className="status-pill">{labelOf(workStatusLabels, item.status)}</span>
                    </td>
                    <td>
                      <span className="status-pill muted">{labelOf(priorityLabels, item.priority)}</span>
                    </td>
                    <td>{formatDate(item.deadline_at)}</td>
                  </tr>
                ))}
                {!state.assigned.length && (
                  <tr>
                    <td colSpan={4}>조회된 업무요청이 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>내 할 일</h2>
            <span>{state.todos.length}건</span>
          </div>
          <ul className="compact-list">
            {state.todos.slice(0, 5).map((todo) => (
              <li key={todo.id}>
                <strong>{todo.title}</strong>
                <span>{labelOf(todoStatusLabels, todo.status)}</span>
              </li>
            ))}
            {!state.todos.length && <li>오늘 할 일이 없습니다.</li>}
          </ul>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>오늘 일정</h2>
            <span>{state.schedules.length}건</span>
          </div>
          <ul className="compact-list">
            {state.schedules.slice(0, 5).map((schedule) => (
              <li key={schedule.id}>
                <strong>{schedule.title}</strong>
                <span>
                  {labelOf(scheduleTypeLabels, schedule.schedule_type)} · {formatDateTime(schedule.start_at)}
                </span>
              </li>
            ))}
            {!state.schedules.length && <li>오늘 일정이 없습니다.</li>}
          </ul>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>보고 / 경비 현황</h2>
            <span>{state.workReports.length + state.expenseReports.length}건</span>
          </div>
          <ul className="compact-list">
            {state.workReports.slice(0, 3).map((report) => (
              <li key={`work-${report.id}`}>
                <strong>{report.title}</strong>
                <span>{labelOf(reportStatusLabels, report.status)}</span>
              </li>
            ))}
            {state.expenseReports.slice(0, 3).map((report) => (
              <li key={`expense-${report.id}`}>
                <strong>{report.title}</strong>
                <span>{labelOf(reportStatusLabels, report.status)}</span>
              </li>
            ))}
            {!state.workReports.length && !state.expenseReports.length && <li>조회된 보고서가 없습니다.</li>}
          </ul>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>최근 알림</h2>
            <span>{state.notifications.length}건</span>
          </div>
          <ul className="compact-list">
            {state.notifications.slice(0, 5).map((notification) => (
              <li key={notification.id}>
                <strong>{notification.title}</strong>
                <span>{formatDateTime(notification.created_at)}</span>
              </li>
            ))}
            {!state.notifications.length && <li>읽지 않은 알림이 없습니다.</li>}
          </ul>
        </article>
      </section>
    </AppShell>
  );
}
