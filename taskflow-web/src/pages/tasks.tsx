import { FormEvent, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import {
  type Todo,
  type TodoInput,
  type TodoItem,
  type UserListItem,
  type WorkRequest,
  type WorkRequestInput,
  acceptWorkRequest,
  cancelWorkRequest,
  checkTodoItem,
  completeTodo,
  completeWorkRequest,
  createTodoItem,
  createTodo,
  createWorkRequest,
  deleteTodo,
  deleteWorkRequest,
  describeApiError,
  fetchTodo,
  fetchTodos,
  fetchWorkRequest,
  fetchWorkRequests,
  patchWorkRequestStatus,
  rejectWorkRequest,
  searchUsers,
  toArray,
  uncheckTodoItem,
  updateTodo,
  updateTodoStatus,
  updateWorkRequest,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { labelOf, priorityLabels, todoStatusLabels, workStatusLabels } from "@/lib/labels";

type UnifiedTask = {
  uid: string;
  source: "WORK_REQUEST" | "TODO";
  id: number;
  title: string;
  content?: string;
  requester?: number;
  requester_name?: string;
  assignee?: number | null;
  assignee_ids?: number[];
  assignee_name?: string | null;
  assignee_names?: string[];
  read_records?: WorkRequest["read_records"];
  has_read_assignee?: boolean;
  status: string;
  priority: string;
  due_date?: string | null;
  raw: WorkRequest | Todo;
};

type FormState = {
  task_type: "REQUEST" | "TODO";
  title: string;
  content: string;
  assignee: number | null;
  priority: string;
  due_date: string;
};

const emptyForm: FormState = {
  task_type: "TODO",
  title: "",
  content: "",
  assignee: null,
  priority: "NORMAL",
  due_date: "",
};

const tabs = [
  { key: "", label: "전체" },
  { key: "received", label: "받은 요청" },
  { key: "sent", label: "보낸 요청" },
  { key: "my-todos", label: "체크리스트" },
  { key: "in-progress", label: "진행중" },
  { key: "completed", label: "완료" },
];

const terminalWorkRequestStatuses = ["REJECTED", "CANCELED", "APPROVED", "COMPLETED"];

function toDateInput(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function toDeadlineDateTime(value: string) {
  return value ? `${value}T23:59:59` : null;
}

function userLabel(user: UserListItem) {
  const name = user.display_name || user.email;
  const details = [user.department, user.position].filter(Boolean);
  return details.length ? `${name} (${details.join(" / ")})` : name;
}

function isWorkRequest(item: UnifiedTask) {
  return item.source === "WORK_REQUEST";
}

function isTerminal(item: UnifiedTask) {
  return isWorkRequest(item)
    ? terminalWorkRequestStatuses.includes(item.status)
    : ["DONE", "CANCELED"].includes(item.status);
}

function statusLabel(item: UnifiedTask) {
  if (item.source === "TODO" && item.status === "TODO") {
    return "대기";
  }
  return isWorkRequest(item) ? labelOf(workStatusLabels, item.status) : labelOf(todoStatusLabels, item.status);
}

function statusOptionLabel(item: UnifiedTask, status: string) {
  if (item.source === "TODO" && status === "TODO") {
    return "대기";
  }
  return item.source === "WORK_REQUEST" ? labelOf(workStatusLabels, status) : labelOf(todoStatusLabels, status);
}

function assigneeLabel(item: UnifiedTask) {
  if (item.assignee_names?.length) {
    return item.assignee_names.join(", ");
  }
  return item.assignee_name || "-";
}

function splitPersonLabel(value?: string | null) {
  if (!value || value === "-") {
    return { name: "-", details: "" };
  }
  const match = value.match(/^(.*?)\s*\((.*)\)$/);
  if (!match) {
    return { name: value, details: "" };
  }
  return { name: match[1], details: match[2] };
}

function formatDueDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const year = String(date.getFullYear()).slice(2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.ceil((dateOnly - todayOnly) / 86400000);
  const dday = diffDays === 0 ? "D-0" : diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`;
  return `${year}. ${month}. ${day}. (${dday})`;
}

export default function TasksPage() {
  const { accessToken, user } = useAuth();
  const [workRequests, setWorkRequests] = useState<WorkRequest[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [activeTab, setActiveTab] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingTarget, setEditingTarget] = useState<UnifiedTask | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<UnifiedTask | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneeResults, setAssigneeResults] = useState<UserListItem[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState<UserListItem | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const requesterName = useMemo(() => {
    if (!user) {
      return "-";
    }
    const name = user.first_name || user.username || user.email;
    const details = [user.department, user.position].filter(Boolean);
    return details.length ? `${name} (${details.join(" / ")})` : name;
  }, [user]);

  const unifiedItems = useMemo<UnifiedTask[]>(() => {
    const requestItems = workRequests.map((item) => ({
      uid: `work-${item.id}`,
      source: "WORK_REQUEST" as const,
      id: item.id,
      title: item.title,
      content: item.content,
      requester: item.requester,
      requester_name: item.requester_name,
      assignee: item.assignee,
      assignee_ids: item.assignee_ids,
      assignee_name: item.assignee_name,
      assignee_names: item.assignee_names,
      read_records: item.read_records,
      has_read_assignee: item.has_read_assignee,
      status: item.status,
      priority: item.priority,
      due_date: item.deadline_at,
      raw: item,
    }));
    const todoItems = todos.map((item) => ({
      uid: `todo-${item.id}`,
      source: "TODO" as const,
      id: item.id,
      title: item.title,
      content: item.content,
      requester: user?.id,
      requester_name: requesterName,
      assignee: user?.id,
      assignee_name: requesterName,
      status: item.status,
      priority: item.priority,
      due_date: item.deadline_at,
      raw: item,
    }));
    return [...requestItems, ...todoItems];
  }, [requesterName, todos, user?.id, workRequests]);

  const filteredItems = useMemo(() => {
    const completedItems = unifiedItems.filter(isTerminal);
    if (activeTab === "completed") {
      return completedItems;
    }
    const activeItems = unifiedItems.filter((item) => !isTerminal(item));
    if (activeTab === "received") {
      return activeItems.filter((item) => item.source === "WORK_REQUEST" && item.assignee_ids?.includes(user?.id ?? -1) && item.status === "PENDING");
    }
    if (activeTab === "sent") {
      return activeItems.filter((item) => item.source === "WORK_REQUEST" && item.requester === user?.id);
    }
    if (activeTab === "my-todos") {
      return activeItems.filter((item) => item.assignee === user?.id || item.assignee_ids?.includes(user?.id ?? -1));
    }
    if (activeTab === "in-progress") {
      return activeItems.filter((item) => ["IN_PROGRESS", "DOING"].includes(item.status));
    }
    return activeItems;
  }, [activeTab, unifiedItems, user?.id]);

  const completedItems = useMemo(() => unifiedItems.filter(isTerminal), [unifiedItems]);

  const summary = useMemo(() => ({
    received: unifiedItems.filter((item) => item.source === "WORK_REQUEST" && item.assignee_ids?.includes(user?.id ?? -1) && item.status === "PENDING").length,
    sent: unifiedItems.filter((item) => item.source === "WORK_REQUEST" && item.requester === user?.id && !isTerminal(item)).length,
    myTodos: unifiedItems.filter((item) => (item.assignee === user?.id || item.assignee_ids?.includes(user?.id ?? -1)) && !isTerminal(item)).length,
    inProgress: unifiedItems.filter((item) => ["IN_PROGRESS", "DOING"].includes(item.status)).length,
    completed: unifiedItems.filter(isTerminal).length,
    todayDue: unifiedItems.filter((item) => item.due_date?.slice(0, 10) === new Date().toISOString().slice(0, 10) && !isTerminal(item)).length,
  }), [unifiedItems, user?.id]);

  async function loadItems() {
    if (!accessToken) {
      return;
    }
    setIsLoading(true);
    setMessage("");
    try {
      const [workResponse, todoResponse] = await Promise.all([fetchWorkRequests(accessToken), fetchTodos(accessToken)]);
      setWorkRequests(toArray(workResponse));
      setTodos(toArray(todoResponse));
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  function resetForm() {
    setEditingTarget(null);
    setForm(emptyForm);
    setIsEditorOpen(false);
    setAssigneeSearch("");
    setAssigneeResults([]);
    setSelectedAssignee(null);
  }

  function openCreateForm() {
    if (isEditorOpen) {
      resetForm();
      return;
    }
    setEditingTarget(null);
    setForm(emptyForm);
    setAssigneeSearch("");
    setAssigneeResults([]);
    setSelectedAssignee(null);
    setIsEditorOpen(true);
  }

  function startEdit(item: UnifiedTask) {
    setEditingTarget(item);
    setIsEditorOpen(true);
    setForm({
      task_type: item.source === "WORK_REQUEST" ? "REQUEST" : "TODO",
      title: item.title,
      content: item.content ?? "",
      assignee: item.assignee ?? null,
      priority: item.priority,
      due_date: toDateInput(item.due_date),
    });
    setSelectedAssignee(item.assignee ? { id: item.assignee, username: item.assignee_name || "", email: item.assignee_name || "", display_name: item.assignee_name || "" } : null);
  }

  async function handleAssigneeSearch(value: string) {
    setAssigneeSearch(value);
    if (!accessToken || value.trim().length < 1) {
      setAssigneeResults([]);
      return;
    }
    try {
      setAssigneeResults(toArray(await searchUsers(accessToken, value)).filter((entry) => entry.id !== user?.id));
    } catch {
      setAssigneeResults([]);
    }
  }

  function selectAssignee(nextUser: UserListItem) {
    setSelectedAssignee(nextUser);
    setForm((current) => ({ ...current, assignee: nextUser.id }));
    setAssigneeSearch("");
    setAssigneeResults([]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }
    setIsSaving(true);
    setMessage("");
    try {
      if (form.task_type === "REQUEST") {
        const payload: WorkRequestInput = {
          title: form.title,
          content: form.content,
          assignee: form.assignee,
          assignee_ids: form.assignee ? [form.assignee] : [],
          priority: form.priority,
          deadline_at: null,
          due_date: form.due_date || null,
        };
        if (editingTarget?.source === "WORK_REQUEST") {
          await updateWorkRequest(accessToken, editingTarget.id, payload);
        } else {
          await createWorkRequest(accessToken, payload);
        }
      } else {
        const payload: TodoInput = {
          title: form.title,
          content: form.content,
          status: editingTarget?.source === "TODO" ? editingTarget.status : "TODO",
          priority: form.priority,
          deadline_at: toDeadlineDateTime(form.due_date),
          remind_at: null,
        };
        if (editingTarget?.source === "TODO") {
          await updateTodo(accessToken, editingTarget.id, payload);
        } else {
          const todo = await createTodo(accessToken, payload);
          if (!todo.id) {
            throw new Error("체크리스트 ID를 확인할 수 없습니다.");
          }
          const checklistItems = form.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          await Promise.all(checklistItems.map((content, index) => createTodoItem(accessToken, todo.id, { content, sort_order: index })));
        }
      }
      resetForm();
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleOpenDetail(item: UnifiedTask) {
    if (!accessToken) {
      return;
    }
    setIsDetailLoading(true);
    setMessage("");
    try {
      if (item.source === "WORK_REQUEST") {
        const detail = await fetchWorkRequest(accessToken, item.id);
        setDetailTarget({
          ...item,
          content: detail.content,
          read_records: detail.read_records,
          has_read_assignee: detail.has_read_assignee,
          raw: detail,
        });
      } else {
        const detail = await fetchTodo(accessToken, item.id);
        setDetailTarget({ ...item, content: detail.content, raw: detail });
      }
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function runAction(action: () => Promise<unknown>) {
    setMessage("");
    try {
      await action();
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleStatusChange(item: UnifiedTask, nextStatus: string) {
    if (!accessToken || nextStatus === item.status) {
      return;
    }
    await runAction(() => {
      if (item.source === "WORK_REQUEST") {
        if (nextStatus === "ACCEPTED") {
          return acceptWorkRequest(accessToken, item.id);
        }
        if (nextStatus === "REJECTED") {
          return rejectWorkRequest(accessToken, item.id, "");
        }
        if (nextStatus === "COMPLETED") {
          return completeWorkRequest(accessToken, item.id);
        }
        return patchWorkRequestStatus(accessToken, item.id, nextStatus);
      }
      if (nextStatus === "DONE") {
        return completeTodo(accessToken, item.id);
      }
      return updateTodoStatus(accessToken, item.id, nextStatus);
    });
  }

  async function handleChecklistToggle(item: TodoItem) {
    if (!accessToken || !detailTarget || detailTarget.source !== "TODO") {
      return;
    }
    setMessage("");
    try {
      const nextItem = item.is_checked ? await uncheckTodoItem(accessToken, item.id) : await checkTodoItem(accessToken, item.id);
      const rawTodo = detailTarget.raw as Todo;
      setDetailTarget({
        ...detailTarget,
        raw: {
          ...rawTodo,
          items: (rawTodo.items ?? []).map((entry) => (entry.id === nextItem.id ? nextItem : entry)),
        },
      });
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  function statusOptions(item: UnifiedTask) {
    if (item.source === "WORK_REQUEST") {
      if (item.status === "PENDING") {
        return ["PENDING", "ACCEPTED", "REJECTED"];
      }
      if (["ACCEPTED", "IN_PROGRESS"].includes(item.status)) {
        return ["ACCEPTED", "IN_PROGRESS", "COMPLETED"];
      }
      return [item.status];
    }
    return ["TODO", "DOING", "DONE"];
  }

  function renderActions(item: UnifiedTask) {
    if (!accessToken) {
      return null;
    }
    const isRequester = String(item.requester ?? "") === String(user?.id ?? "");
    const isTerminalWorkRequest = item.source === "WORK_REQUEST" && terminalWorkRequestStatuses.includes(item.status);
    const canCancelWorkRequest = item.source === "WORK_REQUEST" && isRequester && !isTerminalWorkRequest;
    const canReviseWorkRequest = item.source === "WORK_REQUEST" && isRequester && !isTerminalWorkRequest && !item.has_read_assignee;
    const canReviseTodo = item.source === "TODO";
    const hasActions = canCancelWorkRequest || canReviseWorkRequest || canReviseTodo;

    if (!hasActions) {
      return "-";
    }

    return (
      <>
        {canCancelWorkRequest && (
          <button className="ghost-button" onClick={() => runAction(() => cancelWorkRequest(accessToken, item.id))} type="button">취소</button>
        )}
        {(canReviseTodo || canReviseWorkRequest) && (
          <>
            <button className="ghost-button" onClick={() => startEdit(item)} type="button">수정</button>
            <button className="danger-button" onClick={() => runAction(() => item.source === "TODO" ? deleteTodo(accessToken, item.id) : deleteWorkRequest(accessToken, item.id))} type="button">삭제</button>
          </>
        )}
      </>
    );
  }

  function renderStatus(item: UnifiedTask) {
    const isAssignee = item.assignee === user?.id || item.assignee_ids?.includes(user?.id ?? -1);
    const canChangeStatus = !!accessToken && (item.source === "TODO" || (item.source === "WORK_REQUEST" && isAssignee));
    const statusClass = `status-${item.status.toLowerCase().replaceAll("_", "-")}`;

    return (
      <div className="status-action">
        {canChangeStatus ? (
          <select
            className={`task-status-select ${statusClass}`}
            onChange={(event) => handleStatusChange(item, event.target.value)}
            value={item.status}
          >
            {statusOptions(item).map((status) => (
              <option className={`status-${status.toLowerCase().replaceAll("_", "-")}`} key={status} value={status}>
                {statusOptionLabel(item, status)}
              </option>
            ))}
          </select>
        ) : (
          <span className={`task-status-box ${statusClass}`}>{statusLabel(item)}</span>
        )}
      </div>
    );
  }

  function renderPerson(value?: string | null) {
    const person = splitPersonLabel(value);
    return (
      <div className="person-cell">
        <strong>{person.name}</strong>
        {person.details && <span>{person.details}</span>}
      </div>
    );
  }

  function renderAssignees(item: UnifiedTask) {
    if (item.assignee_names?.length) {
      return (
        <div className="person-list">
          {item.assignee_names.map((name) => <div key={name}>{renderPerson(name)}</div>)}
        </div>
      );
    }
    return renderPerson(item.assignee_name || "-");
  }

  function renderReadRecords(item: UnifiedTask) {
    if (item.source !== "WORK_REQUEST" || !item.read_records?.length) {
      return null;
    }
    return (
      <section className="report-detail-section">
        <h3>열람 상태</h3>
        <div className="recipient-detail-status-list">
          {item.read_records.map((record) => {
            const label = [record.department, record.position].filter(Boolean).join(" / ");
            return (
              <div key={record.id}>
                <strong>{record.name}{label ? ` (${label})` : ""}</strong>
                <span>{record.is_read ? "읽음" : "안읽음"}</span>
                {record.read_at && <small>{formatDateTime(record.read_at)}</small>}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  function renderChecklist(item: UnifiedTask) {
    if (item.source !== "TODO") {
      return null;
    }
    const rawTodo = item.raw as Todo;
    const items = rawTodo.items ?? [];
    return (
      <section className="report-detail-section">
        <h3>체크리스트</h3>
        {items.length ? (
          <div className="checklist-detail-list">
            {items.map((entry) => (
              <label key={entry.id}>
                <input checked={entry.is_checked} onChange={() => handleChecklistToggle(entry)} type="checkbox" />
                <span>{entry.content}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="report-detail-empty">등록된 체크 항목이 없습니다.</p>
        )}
      </section>
    );
  }

  function renderTaskRows(items: UnifiedTask[], emptyMessage: string) {
    return (
      <>
        {items.map((item) => (
          <tr key={item.uid}>
            <td><button className="table-title-button" onClick={() => handleOpenDetail(item)} type="button">{item.title}</button></td>
            <td>{item.source === "WORK_REQUEST" ? "업무요청" : "체크리스트"}</td>
            <td>{renderPerson(item.requester_name || "-")}</td>
            <td>{renderAssignees(item)}</td>
            <td>{renderStatus(item)}</td>
            <td>{labelOf(priorityLabels, item.priority)}</td>
            <td>{formatDueDate(item.due_date)}</td>
            <td className="table-actions">{renderActions(item)}</td>
          </tr>
        ))}
        {!items.length && <tr><td colSpan={8}>{emptyMessage}</td></tr>}
      </>
    );
  }

  return (
    <AppShell
      title="업무관리"
      description="기존 업무요청과 내 할 일 API를 하나의 화면에서 관리합니다."
      actions={
        <button className={isEditorOpen ? "ghost-button" : "primary-button"} onClick={openCreateForm} type="button">
          {isEditorOpen ? "업무 등록 닫기" : "업무 등록"}
        </button>
      }
    >
      {message && <p className="notice error">{message}</p>}

      <section className="stat-grid">
        <StatCard label="받은 요청" value={summary.received} tone="blue" />
        <StatCard label="보낸 요청" value={summary.sent} tone="orange" />
        <StatCard label="체크리스트" value={summary.myTodos} tone="green" />
        <StatCard label="진행중" value={summary.inProgress} tone="purple" />
        <StatCard label="완료" value={summary.completed} tone="blue" />
        <StatCard label="오늘 마감" value={summary.todayDue} tone="red" />
      </section>

      <section className="editor-layout collapsed">
        <section className="panel">
          <div className="panel-head">
            <h2>업무 목록</h2>
            <span>{isLoading ? "조회 중" : `${filteredItems.length}건`}</span>
          </div>
          <div className="tab-row">
            {tabs.map((tab) => <button className={activeTab === tab.key ? "active" : ""} key={tab.key} onClick={() => setActiveTab(tab.key)} type="button">{tab.label}</button>)}
          </div>
          <div className="table-wrap">
            <table className="report-table tasks-table">
              <thead>
                <tr>
                  <th>제목</th>
                  <th>유형</th>
                  <th>요청자</th>
                  <th>담당자</th>
                  <th>상태</th>
                  <th>우선순위</th>
                  <th>마감일</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>{renderTaskRows(filteredItems, "조회된 업무가 없습니다.")}</tbody>
            </table>
          </div>
        </section>
      </section>

      {activeTab !== "completed" && (
        <section className="editor-layout collapsed completed-task-section">
          <section className="panel">
            <div className="panel-head">
              <h2>완료된 업무 목록</h2>
              <span>{isLoading ? "조회 중" : `${completedItems.length}건`}</span>
            </div>
            <div className="table-wrap">
              <table className="report-table tasks-table">
                <thead>
                  <tr>
                    <th>제목</th>
                    <th>유형</th>
                    <th>요청자</th>
                    <th>담당자</th>
                    <th>상태</th>
                    <th>우선순위</th>
                    <th>마감일</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>{renderTaskRows(completedItems, "완료된 업무가 없습니다.")}</tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      {isEditorOpen && (
        <div className="modal-backdrop">
          <form className="modal-panel report-detail-modal form-stack task-editor-modal" onSubmit={handleSubmit}>
            <div className="panel-head">
              <h2>{editingTarget ? "업무 수정" : "업무 등록"}</h2>
              <button className="ghost-button" onClick={openCreateForm} type="button">업무 등록 닫기</button>
            </div>

            <div className="report-detail-head">
              <strong>{form.title || (editingTarget ? "업무 수정" : "새 업무")}</strong>
              <span>{form.task_type === "REQUEST" ? "업무요청" : "체크리스트"}</span>
            </div>

            <div className="report-detail-meta">
              <label>
                <dt>업무 유형</dt>
                <dd>
                  <select onChange={(event) => setForm((current) => ({ ...current, task_type: event.target.value as FormState["task_type"], assignee: null }))} value={form.task_type}>
                    <option value="TODO">체크리스트</option>
                    <option value="REQUEST">업무요청</option>
                  </select>
                </dd>
              </label>
              <label>
                <dt>우선순위</dt>
                <dd>
                  <select onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))} value={form.priority}>
                    {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </dd>
              </label>
              <label>
                <dt>마감일</dt>
                <dd>
                  <input onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))} type="date" value={form.due_date} />
                </dd>
              </label>
            </div>

            <section className="report-detail-section">
              <label>
                <h3>제목</h3>
                <input onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required value={form.title} />
              </label>
            </section>

            {form.task_type === "REQUEST" && (
              <section className="report-detail-section">
                <label className="assignee-search">
                  <h3>담당자</h3>
                  <input onChange={(event) => handleAssigneeSearch(event.target.value)} placeholder="이름, 이메일, 부서, 직함 검색" value={assigneeSearch} />
                  {!!assigneeResults.length && (
                    <div className="assignee-dropdown">
                      {assigneeResults.map((entry) => (
                        <button key={entry.id} onClick={() => selectAssignee(entry)} type="button">{userLabel(entry)}</button>
                      ))}
                    </div>
                  )}
                  {selectedAssignee && <small>{userLabel(selectedAssignee)}</small>}
                </label>
              </section>
            )}

            <section className="report-detail-section">
              <label>
                <h3>{form.task_type === "TODO" ? "체크리스트" : "내용"}</h3>
                <textarea onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} rows={6} value={form.content} />
              </label>
            </section>

            <button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "저장 중" : editingTarget ? "수정" : "등록"}</button>
          </form>
        </div>
      )}

      {isDetailLoading && (
        <div className="modal-backdrop">
          <div className="modal-panel report-detail-modal"><p className="report-detail-loading">업무를 불러오는 중입니다.</p></div>
        </div>
      )}

      {detailTarget && !isDetailLoading && (
        <div className="modal-backdrop">
          <div className="modal-panel report-detail-modal">
            <div className="panel-head">
              <h2>업무 내용</h2>
              <button className="ghost-button" onClick={() => setDetailTarget(null)} type="button">닫기</button>
            </div>
            <div className="report-detail-head">
              <strong>{detailTarget.title}</strong>
              <span>{statusLabel(detailTarget)}</span>
            </div>
            <dl className="report-detail-meta">
              <div><dt>유형</dt><dd>{detailTarget.source === "WORK_REQUEST" ? "업무요청" : "체크리스트"}</dd></div>
              <div><dt>요청자</dt><dd>{detailTarget.requester_name || "-"}</dd></div>
              <div><dt>담당자</dt><dd>{assigneeLabel(detailTarget)}</dd></div>
              <div><dt>마감일</dt><dd>{formatDueDate(detailTarget.due_date)}</dd></div>
            </dl>
            <section className="report-detail-section">
              <h3>내용</h3>
              <p className="report-detail-content">{detailTarget.content?.trim() || "작성된 내용이 없습니다."}</p>
            </section>
            {renderChecklist(detailTarget)}
            {renderReadRecords(detailTarget)}
          </div>
        </div>
      )}
    </AppShell>
  );
}
