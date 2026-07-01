import { useRouter } from "next/router";
import { FormEvent, KeyboardEvent, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { AttachmentList } from "@/components/AttachmentList";
import { useAuth } from "@/contexts/AuthContext";
import {
  type AdminApprovalRequest,
  type WorkRequest,
  type WorkRequestInput,
  type UserListItem,
  acceptWorkRequest,
  attachWorkRequestFile,
  completeWorkRequest,
  approveAdminApprovalRequest,
  createWorkRequest,
  deleteWorkRequest,
  describeApiError,
  downloadAllWorkRequestFiles,
  downloadWorkRequestFile,
  fetchAdminApprovalRequests,
  fetchWorkRequest,
  fetchUsers,
  fetchWorkRequests,
  patchWorkRequestStatus,
  rejectAdminApprovalRequest,
  rejectWorkRequest,
  searchUsers,
  toArray,
  updateWorkRequest,
  uploadMediaFile,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { labelOf, priorityLabels, workStatusLabels } from "@/lib/labels";

const emptyForm: WorkRequestInput = {
  title: "",
  content: "",
  assignee: null,
  assignee_input: "",
  assignee_ids: [],
  assignee_inputs: [],
  priority: "NORMAL",
  deadline_at: "",
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

function cleanInput(input: WorkRequestInput): WorkRequestInput {
  const deadlineValue = input.deadline_at || "";
  return {
    ...input,
    assignee_input: input.assignee_input?.trim() || "",
    assignee_inputs: input.assignee_inputs ?? [],
    deadline_at: deadlineValue.includes("T") ? deadlineValue : null,
    due_date: deadlineValue && !deadlineValue.includes("T") ? deadlineValue : undefined,
  };
}

function userLabel(user: UserListItem) {
  const name = user.display_name || user.email;
  const details = [user.department, user.position].filter(Boolean);
  return details.length ? `${name} (${details.join(" / ")})` : name;
}

function detailLabel(department?: string, position?: string) {
  const details = [department, position].filter(Boolean);
  return details.length ? details.join(" / ") : "-";
}

function applicantLabel(item: AdminApprovalRequest) {
  const details = detailLabel(item.applicant_department, item.applicant_position);
  return details === "-" ? item.applicant_email : `${item.applicant_email} / ${details}`;
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

export default function WorkRequestsPage() {
  const router = useRouter();
  const { accessToken, user } = useAuth();
  const [items, setItems] = useState<WorkRequest[]>([]);
  const [approvalItems, setApprovalItems] = useState<AdminApprovalRequest[]>([]);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [manualAssignees, setManualAssignees] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<UserListItem[]>([]);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneeResults, setAssigneeResults] = useState<UserListItem[]>([]);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [form, setForm] = useState<WorkRequestInput>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [detailTarget, setDetailTarget] = useState<WorkRequest | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  async function loadItems() {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetchWorkRequests(accessToken);
      setItems(toArray(response));
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadUsers() {
    if (!accessToken) {
      return;
    }

    try {
      const response = await fetchUsers(accessToken);
      setUsers(toArray(response));
    } catch {
      setUsers([]);
    }
  }

  async function loadApprovalItems() {
    if (!accessToken || user?.role !== "CEO") {
      setApprovalItems([]);
      return;
    }

    try {
      setApprovalItems(toArray(await fetchAdminApprovalRequests(accessToken)));
    } catch {
      setApprovalItems([]);
    }
  }

  useEffect(() => {
    loadItems();
    loadUsers();
    loadApprovalItems();
    // loadItems는 저장/삭제/상태 변경 후에도 재사용하는 함수라 effect 의존성만 고정합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, user?.role]);

  useEffect(() => {
    if (router.query.mode === "create") {
      setEditingId(null);
      setForm(emptyForm);
      setManualAssignees([]);
      setSelectedAssignees([]);
      setAssigneeSearch("");
      setAssigneeResults([]);
    }
  }, [router.query.mode]);

  function startEdit(item: WorkRequest) {
    const selectedIds = item.assignee_ids?.length ? item.assignee_ids : item.assignee ? [item.assignee] : [];
    const nextSelectedAssignees = selectedIds.map((id) => {
      const found = users.find((entry) => entry.id === id);
      if (found) {
        return found;
      }
      return {
        id,
        username: String(id),
        email: item.assignee_name || String(id),
        display_name: item.assignee_name || String(id),
      };
    });
    setEditingId(item.id);
    setForm({
      title: item.title,
      content: item.content ?? "",
      assignee: selectedIds[0] ?? null,
      assignee_input: "",
      assignee_ids: selectedIds,
      assignee_inputs: [],
      priority: item.priority,
      deadline_at: toDateTimeInput(item.deadline_at),
    });
    setManualAssignees([]);
    setSelectedAssignees(nextSelectedAssignees);
    setAssigneeSearch("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setManualAssignees([]);
    setSelectedAssignees([]);
    setAssigneeSearch("");
    setAssigneeResults([]);
    setAttachmentFiles([]);
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
    setSelectedAssignees((current) => (current.some((entry) => entry.id === nextUser.id) ? current : [...current, nextUser]));
    setForm((current) => {
      const ids = Array.from(new Set([...(current.assignee_ids ?? []), nextUser.id]));
      return { ...current, assignee: ids[0] ?? null, assignee_ids: ids, assignee_input: "" };
    });
    setAssigneeSearch("");
    setAssigneeResults([]);
  }

  function addManualAssignee() {
    const values = assigneeSearch
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) {
      return;
    }
    setManualAssignees((current) => Array.from(new Set([...current, ...values])));
    setForm((current) => ({ ...current, assignee_input: "", assignee_inputs: Array.from(new Set([...(current.assignee_inputs ?? []), ...values])) }));
    setAssigneeSearch("");
    setAssigneeResults([]);
  }

  function handleManualAssigneeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    addManualAssignee();
  }

  function removeManualAssignee(value: string) {
    setManualAssignees((current) => current.filter((entry) => entry !== value));
    setForm((current) => ({ ...current, assignee_inputs: (current.assignee_inputs ?? []).filter((entry) => entry !== value) }));
  }

  function removeSelectedAssignee(id: number) {
    setSelectedAssignees((current) => current.filter((entry) => entry.id !== id));
    setForm((current) => {
      const ids = (current.assignee_ids ?? []).filter((entryId) => entryId !== id);
      return { ...current, assignee: ids[0] ?? null, assignee_ids: ids };
    });
  }

  function handleAttachmentFiles(files: File[]) {
    setAttachmentFiles(files);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      let saved: WorkRequest;
      if (editingId) {
        saved = await updateWorkRequest(accessToken, editingId, cleanInput(form));
      } else {
        saved = await createWorkRequest(accessToken, cleanInput(form));
      }
      if (!saved.id) {
        throw new Error("업무요청 저장 응답에 ID가 없습니다.");
      }
      for (const file of attachmentFiles) {
        const media = await uploadMediaFile(accessToken, file, { target_app: "WORK_REQUESTS", target_id: saved.id });
        await attachWorkRequestFile(accessToken, saved.id, media.id);
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

    setMessage("");

    try {
      await deleteWorkRequest(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleStatus(id: number, status: string) {
    if (!accessToken) {
      return;
    }

    setMessage("");

    try {
      if (status === "COMPLETED") {
        await completeWorkRequest(accessToken, id);
      } else {
        await patchWorkRequestStatus(accessToken, id, status);
      }
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleAccept(id: number) {
    if (!accessToken) {
      return;
    }

    setMessage("");

    try {
      await acceptWorkRequest(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleReject(id: number) {
    if (!accessToken) {
      return;
    }

    const rejectedReason = window.prompt("거절 사유를 입력하세요.", "");
    if (rejectedReason === null) {
      return;
    }

    setMessage("");

    try {
      await rejectWorkRequest(accessToken, id, rejectedReason);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleDownloadFile(item: WorkRequest, fileId: number, filename?: string) {
    if (!accessToken) {
      return;
    }
    try {
      await downloadWorkRequestFile(accessToken, item.id, fileId, filename);
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleDownloadAllFiles(item: WorkRequest) {
    if (!accessToken) {
      return;
    }
    try {
      await downloadAllWorkRequestFiles(accessToken, item.id);
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleOpenDetail(id: number) {
    if (!accessToken) {
      return;
    }

    setIsDetailLoading(true);
    setMessage("");
    try {
      setDetailTarget(await fetchWorkRequest(accessToken, id));
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsDetailLoading(false);
    }
  }

  function renderAssigneeNames(item: WorkRequest) {
    if (item.assignee_names?.length) {
      return item.assignee_names.join(", ");
    }
    return item.assignee_name || "-";
  }

  function renderAttachmentPresence(files?: WorkRequest["files"]) {
    return files?.length ? "있음" : "없음";
  }

  function renderDetailFiles(item: WorkRequest) {
    return (
      <AttachmentList
        files={item.files}
        onDownload={(file) => handleDownloadFile(item, file.id, file.original_name)}
        onDownloadAll={item.files && item.files.length > 1 ? () => handleDownloadAllFiles(item) : undefined}
      />
    );
  }

  function renderReadRecords(item: WorkRequest) {
    if (!item.read_records?.length) {
      return <p className="report-detail-empty">열람 기록이 없습니다.</p>;
    }
    return (
      <div className="recipient-detail-status-list">
        {item.read_records.map((record) => {
          const label = [record.department, record.position].filter(Boolean).join(" / ");
          const person = splitPersonLabel(label ? `${record.name} (${label})` : record.name);
          return (
            <div key={record.id}>
              <div className="recipient-detail-person">
                <div className="person-cell">
                  <strong>{person.name}</strong>
                  {person.details && <span>{person.details}</span>}
                </div>
              </div>
              <span>{record.is_read ? "읽음" : "안읽음"}</span>
              {record.read_at && <small>{formatDateTime(record.read_at)}</small>}
            </div>
          );
        })}
      </div>
    );
  }

  async function handleApprovalApprove(id: number) {
    if (!accessToken) {
      return;
    }
    try {
      await approveAdminApprovalRequest(accessToken, id);
      await loadApprovalItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleApprovalReject(id: number) {
    if (!accessToken) {
      return;
    }
    const rejectReason = window.prompt("거절 사유를 입력하세요.", "");
    if (rejectReason === null) {
      return;
    }
    try {
      await rejectAdminApprovalRequest(accessToken, id, rejectReason);
      await loadApprovalItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  return (
    <AppShell title="업무요청" description="업무요청 API로 등록, 수정, 삭제, 상태 변경을 처리합니다.">
      {message && <p className="notice error">{message}</p>}

      {user?.role === "CEO" && (
        <section className="panel form-stack">
          <div className="panel-head">
            <h2>관리자 승격 신청</h2>
            <span>{approvalItems.length}건</span>
          </div>
          <div className="compact-list">
            {approvalItems.map((item) => (
              <div className="approval-card" key={item.id}>
                <div>
                  <strong>{item.applicant_name || item.applicant_email}</strong>
                  <p>{applicantLabel(item)}</p>
                  <p>신청일시: {formatDateTime(item.created_at)}</p>
                  <p>신청 사유: {item.reason}</p>
                  <p>관련 경력/업무: {item.experience}</p>
                </div>
                <div className="table-actions">
                  <span className={`status-pill ${item.status === "APPROVED" ? "blue" : item.status === "REJECTED" ? "red" : "muted"}`}>
                    {item.status === "PENDING" ? "대기" : item.status === "APPROVED" ? "승인완료" : "거절"}
                  </span>
                  {item.status === "PENDING" && (
                    <>
                      <button className="primary-button" onClick={() => handleApprovalApprove(item.id)} type="button">
                        수락
                      </button>
                      <button className="danger-button" onClick={() => handleApprovalReject(item.id)} type="button">
                        거절
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {!approvalItems.length && <p className="notice">관리자 승격 신청이 없습니다.</p>}
          </div>
        </section>
      )}

      <section className="editor-layout">
        <form className="panel form-stack" onSubmit={handleSubmit}>
          <div className="panel-head">
            <h2>{editingId ? "업무요청 수정" : "업무요청 등록"}</h2>
            {editingId && (
              <button className="ghost-button" onClick={resetForm} type="button">
                취소
              </button>
            )}
          </div>

          <div className="form-grid two">
            <label>
              <span>제목</span>
              <input
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                required
                value={form.title}
              />
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
            <label className="assignee-search">
              <span>담당자</span>
              <div className="inline-entry">
                <input
                  onChange={(event) => handleAssigneeSearch(event.target.value)}
                  onKeyDown={handleManualAssigneeKeyDown}
                  placeholder="이름, 이메일, 부서, 직함 검색 또는 직접 입력"
                  value={assigneeSearch}
                />
                <button className="ghost-button" onClick={addManualAssignee} type="button">
                  추가
                </button>
              </div>
              {!!assigneeResults.length && (
                <div className="assignee-dropdown">
                  {assigneeResults.map((entry) => (
                    <button key={entry.id} onClick={() => selectAssignee(entry)} type="button">
                      {userLabel(entry)}
                    </button>
                  ))}
                </div>
              )}
            </label>
            <label>
              <span>마감일</span>
              <input
                onChange={(event) => setForm((current) => ({ ...current, deadline_at: event.target.value }))}
                type="date"
                value={form.deadline_at ?? ""}
              />
            </label>
          </div>

          <div className="recipient-picker">
            {manualAssignees.map((assignee) => (
              <button className="recipient-option manual" key={assignee} onClick={() => removeManualAssignee(assignee)} type="button">
                직접: {assignee}
              </button>
            ))}
            {selectedAssignees.map((assignee) => (
              <button
                className="recipient-option"
                key={assignee.id}
                onClick={() => removeSelectedAssignee(assignee.id)}
                type="button"
              >
                {userLabel(assignee)}
              </button>
            ))}
          </div>

          <label>
            <span>내용</span>
            <textarea
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
              required
              rows={5}
              value={form.content}
            />
          </label>

          <label>
            <span>파일 첨부</span>
            <input multiple onChange={(event) => handleAttachmentFiles(Array.from(event.target.files ?? []))} type="file" />
            {!!attachmentFiles.length && (
              <small>{attachmentFiles.map((file) => file.name).join(", ")}</small>
            )}
          </label>

          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? "저장 중" : editingId ? "수정" : "등록"}
          </button>
        </form>

        <section className="panel">
          <div className="panel-head">
            <h2>업무요청 목록</h2>
            <span>{isLoading ? "조회 중" : `${items.length}건`}</span>
          </div>
          <div className="table-wrap">
            <table className="report-table work-request-table">
              <thead>
                <tr>
                  <th>제목</th>
                  <th>요청자</th>
                  <th>담당자</th>
                  <th>상태</th>
                  <th>우선순위</th>
                  <th>마감일</th>
                  <th>첨부</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isRequester = item.requester === user?.id;
                  const isAssignee = item.assignee === user?.id || item.assignee_ids?.includes(user?.id ?? -1);
                  const canRespond = item.status === "PENDING" && isAssignee;
                  return (
                    <tr key={item.id}>
                      <td>
                        <button className="table-title-button" onClick={() => handleOpenDetail(item.id)} type="button">
                          {item.title}
                        </button>
                      </td>
                      <td>{item.requester_name || "-"}</td>
                      <td>{renderAssigneeNames(item)}</td>
                      <td>
                        {item.status === "PENDING" || !isAssignee ? (
                          <span>{labelOf(workStatusLabels, item.status)}</span>
                        ) : (
                          <select
                            aria-label={`${item.title} 상태`}
                            onChange={(event) => handleStatus(item.id, event.target.value)}
                            value={item.status}
                          >
                            {Object.entries(workStatusLabels).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>{labelOf(priorityLabels, item.priority)}</td>
                      <td>{formatDateTime(item.deadline_at)}</td>
                      <td>{renderAttachmentPresence(item.files)}</td>
                      <td className="table-actions">
                        {canRespond && (
                          <>
                            <button className="primary-button" onClick={() => handleAccept(item.id)} type="button">
                              수락
                            </button>
                            <button className="ghost-button" onClick={() => handleReject(item.id)} type="button">
                              거절
                            </button>
                          </>
                        )}
                        {isRequester && (
                          <>
                            <button className="ghost-button" onClick={() => startEdit(item)} type="button">
                              수정
                            </button>
                            <button className="danger-button" onClick={() => handleDelete(item.id)} type="button">
                              삭제
                            </button>
                          </>
                        )}
                        {!canRespond && !isRequester && "-"}
                      </td>
                    </tr>
                  );
                })}
                {!items.length && (
                  <tr>
                    <td colSpan={8}>조회된 업무요청이 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {isDetailLoading && (
        <div className="modal-backdrop">
          <div className="modal-panel report-detail-modal">
            <p className="report-detail-loading">업무요청을 불러오는 중입니다.</p>
          </div>
        </div>
      )}

      {detailTarget && !isDetailLoading && (
        <div className="modal-backdrop">
          <div className="modal-panel report-detail-modal">
            <div className="panel-head">
              <h2>업무요청 내용</h2>
              <button className="ghost-button" onClick={() => setDetailTarget(null)} type="button">
                닫기
              </button>
            </div>

            <div className="report-detail-head">
              <strong>{detailTarget.title}</strong>
              <span>{labelOf(workStatusLabels, detailTarget.status)}</span>
            </div>

            <dl className="report-detail-meta">
              <div>
                <dt>유형</dt>
                <dd>업무요청</dd>
              </div>
              <div>
                <dt>요청자</dt>
                <dd>{detailTarget.requester_name || "-"}</dd>
              </div>
              <div>
                <dt>담당자</dt>
                <dd>{renderAssigneeNames(detailTarget)}</dd>
              </div>
              <div>
                <dt>우선순위</dt>
                <dd>{labelOf(priorityLabels, detailTarget.priority)}</dd>
              </div>
              <div>
                <dt>마감일</dt>
                <dd>{formatDateTime(detailTarget.deadline_at)}</dd>
              </div>
            </dl>

            <section className="report-detail-section">
              <h3>내용</h3>
              <p className="report-detail-content">{detailTarget.content?.trim() || "작성된 내용이 없습니다."}</p>
            </section>

            <section className="report-detail-section">
              <h3>첨부</h3>
              {renderDetailFiles(detailTarget)}
            </section>

            <section className="report-detail-section">
              <h3>열람 상태</h3>
              {renderReadRecords(detailTarget)}
            </section>
          </div>
        </div>
      )}
    </AppShell>
  );
}
