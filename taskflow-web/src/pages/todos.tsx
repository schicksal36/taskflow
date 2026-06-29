import { useRouter } from "next/router";
import { FormEvent, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  type Todo,
  type TodoInput,
  completeTodo,
  createTodo,
  deleteTodo,
  describeApiError,
  fetchTodos,
  toArray,
  updateTodo,
  updateTodoStatus,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { labelOf, priorityLabels, todoStatusLabels } from "@/lib/labels";

const emptyForm: TodoInput = {
  title: "",
  content: "",
  status: "TODO",
  priority: "NORMAL",
  deadline_at: "",
  remind_at: "",
};

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

function cleanInput(input: TodoInput): TodoInput {
  return {
    ...input,
    deadline_at: input.deadline_at || null,
    remind_at: input.remind_at || null,
  };
}

export default function TodosPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const [items, setItems] = useState<Todo[]>([]);
  const [form, setForm] = useState<TodoInput>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  async function loadItems() {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetchTodos(accessToken);
      setItems(toArray(response));
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    // loadItems는 저장/삭제/상태 변경 후에도 재사용하는 함수라 effect 의존성만 고정합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (router.query.mode === "create") {
      resetForm();
    }
  }, [router.query.mode]);

  function startEdit(item: Todo) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      content: item.content ?? "",
      status: item.status,
      priority: item.priority,
      deadline_at: toDateTimeInput(item.deadline_at),
      remind_at: toDateTimeInput(item.remind_at),
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      if (editingId) {
        await updateTodo(accessToken, editingId, cleanInput(form));
      } else {
        await createTodo(accessToken, cleanInput(form));
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
      await deleteTodo(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleStatus(id: number, status: string) {
    if (!accessToken) {
      return;
    }

    try {
      await updateTodoStatus(accessToken, id, status);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleComplete(id: number) {
    if (!accessToken) {
      return;
    }

    try {
      await completeTodo(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  return (
    <AppShell title="내 할 일" description="할 일 API로 개인 업무를 등록하고 상태를 관리합니다.">
      {message && <p className="notice error">{message}</p>}

      <section className="editor-layout editor-layout-equal">
        <form className="panel editor-panel" onSubmit={handleSubmit}>
          <div className="panel-head">
            <h2>{editingId ? "할 일 수정" : "할 일 등록"}</h2>
            {editingId && (
              <button className="ghost-button" onClick={resetForm} type="button">
                취소
              </button>
            )}
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
                rows={5}
                value={form.content}
              />
            </label>

            <div className="form-grid two">
              <label>
                <span>상태</span>
                <select
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                  value={form.status}
                >
                  {Object.entries(todoStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>우선순위</span>
                <select
                  onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
                  value={form.priority}
                >
                  {Object.entries(priorityLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-grid two">
              <label>
                <span>마감일</span>
                <input
                  onChange={(event) => setForm((current) => ({ ...current, deadline_at: event.target.value }))}
                  type="datetime-local"
                  value={form.deadline_at ?? ""}
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

            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "저장 중" : editingId ? "수정" : "등록"}
            </button>
          </div>
        </form>

        <section className="panel editor-panel">
          <div className="panel-head">
            <h2>할 일 목록</h2>
            <span>{isLoading ? "조회 중" : `${items.length}건`}</span>
          </div>
          <div className="panel-body">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>제목</th>
                    <th>상태</th>
                    <th>우선순위</th>
                    <th>마감일</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.title}</td>
                      <td>
                        <select
                          aria-label={`${item.title} 상태`}
                          onChange={(event) => handleStatus(item.id, event.target.value)}
                          value={item.status}
                        >
                          {Object.entries(todoStatusLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{labelOf(priorityLabels, item.priority)}</td>
                      <td>{formatDateTime(item.deadline_at)}</td>
                      <td className="table-actions">
                        {item.status !== "DONE" && (
                          <button className="ghost-button" onClick={() => handleComplete(item.id)} type="button">
                            완료
                          </button>
                        )}
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
                      <td colSpan={5}>조회된 할 일이 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </section>
    </AppShell>
  );
}
