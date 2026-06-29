/**
 * reports.tsx
 * 역할: 업무보고 작성, 수신자별 읽음/확인/보완요청 상태 표시 및 처리
 * 주요 기능:
 *   - 업무보고 단일 폼 작성
 *   - 수신자 검색 및 다중 선택
 *   - 보낸 보고서/받은 보고서 목록 분리
 *   - 확인완료/보완요청/재제출 처리
 * 사용 API: GET/POST /api/reports/, POST /api/reports/{id}/submit|confirm|return|resubmit/
 */
import { useRouter } from "next/router";
import { FormEvent, KeyboardEvent, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  type Report,
  type ReportInput,
  type ReportFile,
  type UserListItem,
  attachReportFile,
  confirmReport,
  createReport,
  deleteReport,
  describeApiError,
  downloadReportFile,
  fetchReports,
  resubmitReport,
  returnReport,
  searchUsers,
  submitReport,
  toArray,
  updateReport,
  uploadMediaFile,
} from "@/lib/api";
import { formatDate, formatDateTime, todayString } from "@/lib/format";
import { labelOf, reportStatusLabels } from "@/lib/labels";

const visibleReportTypes = new Set(["DAILY_REPORT", "WORK_REPORT"]);

const emptyForm: ReportInput = {
  report_type: "WORK_REPORT",
  title: "",
  content: "",
  report_date: todayString(),
  total_amount: 0,
  recipient_ids: [],
};

function userLabel(user: UserListItem) {
  const name = user.display_name || user.email;
  const details = [user.department, user.position].filter(Boolean);
  return details.length ? `${name} (${details.join(" / ")})` : name;
}

export default function ReportsPage() {
  /**
   * ReportsPage 컴포넌트
   *
   * 일반 사용자는 업무보고 작성/수정/제출/재제출을 수행하고,
   * 수신자 및 대표이사는 받은 보고서 조회/확인완료/보완요청 중심으로 사용합니다.
   *
   * 역할별 UI:
   *  - USER/ADMIN: 작성 폼 표시
   *  - CEO/SUPERUSER: 작성 폼과 보낸 보고서 숨김
   */
  const router = useRouter();
  const { accessToken, user } = useAuth();
  const [items, setItems] = useState<Report[]>([]);
  const [form, setForm] = useState<ReportInput>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedRecipients, setSelectedRecipients] = useState<UserListItem[]>([]);
  const [manualRecipients, setManualRecipients] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientResults, setRecipientResults] = useState<UserListItem[]>([]);
  const [reportAttachment, setReportAttachment] = useState<File | null>(null);
  const [returnTarget, setReturnTarget] = useState<Report | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const isExecutive = user?.role === "CEO" || user?.role === "SUPERUSER";
  const sentReports = isExecutive ? [] : items.filter((item) => item.writer === user?.id);
  const receivedReports = isExecutive
    ? items.filter((item) => !["DRAFT", "CANCELED"].includes(item.status))
    : items.filter(
        (item) =>
          item.recipient_ids?.includes(user?.id ?? -1) ||
          item.recipients?.some((recipient) => recipient.recipient === user?.id),
      );

  async function loadItems() {
    /**
     * 업무보고 목록 조회.
     *
     * 동작 순서:
     *  1. GET /api/reports/ 호출
     *  2. 검색어와 상태 필터를 쿼리스트링으로 전달
     *  3. 업무보고 타입만 화면에 표시
     *  4. 실패 시 백엔드 오류 메시지 표시
     */
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetchReports(accessToken, searchTerm, { status: statusFilter });
      setItems(toArray(response).filter((item) => visibleReportTypes.has(item.report_type)));
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    // loadItems는 저장/삭제/제출 후에도 재사용하는 함수라 effect 의존성만 고정합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, searchTerm, statusFilter]);

  useEffect(() => {
    if (router.query.mode === "create") {
      resetForm();
    }
  }, [router.query.mode]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setSelectedRecipients([]);
    setManualRecipients([]);
    setRecipientSearch("");
    setRecipientResults([]);
    setReportAttachment(null);
  }

  function startEdit(item: Report) {
    setEditingId(item.id);
    setForm({
      report_type: "WORK_REPORT",
      title: item.title,
      content: item.content ?? "",
      report_date: item.report_date,
      total_amount: item.total_amount ?? 0,
      recipient_ids: item.recipient_ids ?? item.recipients?.map((recipient) => recipient.recipient) ?? [],
    });
    setSelectedRecipients(
      item.recipients?.map((recipient) => ({
        id: recipient.recipient,
        username: recipient.name || String(recipient.recipient),
        email: recipient.name || String(recipient.recipient),
        display_name: recipient.name,
        department: recipient.department,
        position: recipient.position,
      })) ?? [],
    );
    setManualRecipients([]);
    setRecipientSearch("");
    setRecipientResults([]);
    setReportAttachment(null);
  }

  async function handleRecipientSearch(value: string) {
    setRecipientSearch(value);
    if (!accessToken || value.trim().length < 1) {
      setRecipientResults([]);
      return;
    }
    try {
      setRecipientResults(toArray(await searchUsers(accessToken, value)));
    } catch {
      setRecipientResults([]);
    }
  }

  function selectRecipient(nextUser: UserListItem) {
    setSelectedRecipients((current) => (current.some((entry) => entry.id === nextUser.id) ? current : [...current, nextUser]));
    setForm((current) => ({
      ...current,
      recipient_ids: Array.from(new Set([...(current.recipient_ids ?? []), nextUser.id])),
    }));
    setRecipientSearch("");
    setRecipientResults([]);
  }

  function removeRecipient(id: number) {
    setSelectedRecipients((current) => current.filter((entry) => entry.id !== id));
    setForm((current) => ({
      ...current,
      recipient_ids: (current.recipient_ids ?? []).filter((entryId) => entryId !== id),
    }));
  }

  function addManualRecipients() {
    const entries = recipientSearch
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!entries.length) {
      return;
    }
    setManualRecipients((current) => Array.from(new Set([...current, ...entries])));
    setRecipientSearch("");
    setRecipientResults([]);
  }

  function handleManualRecipientKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    addManualRecipients();
  }

  function removeManualRecipient(value: string) {
    setManualRecipients((current) => current.filter((entry) => entry !== value));
  }

  async function attachSelectedReportFile(reportId: number) {
    if (!accessToken || !reportAttachment) {
      return;
    }
    const media = await uploadMediaFile(accessToken, reportAttachment, {
      target_app: "reports",
      target_id: reportId,
    });
    await attachReportFile(accessToken, reportId, media.id);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    /**
     * 업무보고 등록/수정 처리.
     *
     * 동작 순서:
     *  1. 보고 종류는 WORK_REPORT로 고정
     *  2. 신규 작성은 POST /api/reports/
     *  3. 수정은 PATCH /api/reports/{id}/
     *  4. 성공 시 폼 초기화 및 목록 재조회
     */
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const payload = { ...form, report_type: "WORK_REPORT", recipient_inputs: manualRecipients };
      let savedReport: Report;
      if (editingId) {
        savedReport = await updateReport(accessToken, editingId, payload);
      } else {
        savedReport = await createReport(accessToken, payload);
      }
      const reportId = savedReport.id ?? editingId;
      if (reportId) {
        await attachSelectedReportFile(reportId);
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
      await deleteReport(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleDownloadReportFile(file: ReportFile) {
    if (!accessToken) {
      return;
    }
    try {
      await downloadReportFile(accessToken, file.id, file.original_name);
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  function renderReportFiles(files?: ReportFile[]) {
    if (!files?.length) {
      return null;
    }
    return (
      <div className="attachment-list">
        {files.map((file) => (
          <button className="text-button" key={file.id} onClick={() => handleDownloadReportFile(file)} type="button">
            {file.original_name || `첨부파일 ${file.id}`}
          </button>
        ))}
      </div>
    );
  }

  function renderRecipientNames(item: Report) {
    if (!item.recipients?.length) {
      return "-";
    }
    return (
      <div className="recipient-status-list">
        {item.recipients.map((recipient) => (
          <span key={recipient.id}>{recipient.name}</span>
        ))}
      </div>
    );
  }

  function renderRecipientStatuses(item: Report) {
    if (!item.recipients?.length) {
      return "-";
    }
    return (
      <div className="recipient-status-list">
        {item.recipients.map((recipient) => (
          <span key={recipient.id}>
            {recipient.confirmed_at
              ? `확인완료 ${formatDateTime(recipient.confirmed_at)}`
              : recipient.returned_at
                ? `보완요청 ${recipient.return_reason || ""}`
                : recipient.is_read
                  ? `읽음 ${formatDateTime(recipient.read_at)}`
                  : "안읽음"}
          </span>
        ))}
      </div>
    );
  }

  async function handleSubmitReport(id: number) {
    if (!accessToken) {
      return;
    }

    try {
      await submitReport(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleConfirmReport(id: number) {
    /**
     * 수신자 확인완료 처리.
     *
     * API: POST /api/reports/{id}/confirm/
     * 성공 시 수신자 confirmed_at이 저장되고, 모든 수신자 완료 시 보고서가 CONFIRMED가 됩니다.
     */
    if (!accessToken) {
      return;
    }

    try {
      await confirmReport(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleResubmitReport(id: number) {
    if (!accessToken) {
      return;
    }

    try {
      await resubmitReport(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleReturnReport(event: FormEvent<HTMLFormElement>) {
    /**
     * 수신자 보완요청 처리.
     *
     * API: POST /api/reports/{id}/return/
     * 성공 시 수신자 returned_at/return_reason이 저장되고 보고서 상태가 RETURNED가 됩니다.
     */
    event.preventDefault();
    if (!accessToken || !returnTarget) {
      return;
    }

    try {
      await returnReport(accessToken, returnTarget.id, returnReason);
      setReturnTarget(null);
      setReturnReason("");
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchTerm(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput("");
    setSearchTerm("");
  }

  return (
    <AppShell title="업무보고" description="업무보고를 작성하고 수신자 확인 상태를 관리합니다.">
      {message && <p className="notice error">{message}</p>}

      <section className={isExecutive ? "editor-layout-equal" : "editor-layout"}>
        {!isExecutive && (
          <form className="panel form-stack" onSubmit={handleSubmit}>
            <div className="panel-head">
              <h2>{editingId ? "업무보고 수정" : "업무보고 작성"}</h2>
              {editingId && (
                <button className="ghost-button" onClick={resetForm} type="button">
                  취소
                </button>
              )}
            </div>

            <label>
              <span>보고일</span>
              <input
                onChange={(event) => setForm((current) => ({ ...current, report_date: event.target.value }))}
                required
                type="date"
                value={form.report_date}
              />
            </label>

            <label className="assignee-search">
              <span>수신자</span>
              <div className="inline-entry">
                <input
                  onChange={(event) => handleRecipientSearch(event.target.value)}
                  onKeyDown={handleManualRecipientKeyDown}
                  placeholder="이름, 이메일, 부서, 직함 검색 또는 직접 입력"
                  value={recipientSearch}
                />
                <button className="ghost-button" onClick={addManualRecipients} type="button">
                  추가
                </button>
              </div>
              {!!recipientResults.length && (
                <div className="assignee-dropdown">
                    {recipientResults.map((entry) => (
                      <button key={entry.id} onClick={() => selectRecipient(entry)} type="button">
                        {userLabel(entry)}
                      </button>
                    ))}
                </div>
              )}
            </label>

            <div className="recipient-picker">
              {manualRecipients.map((recipient) => (
                <button className="recipient-option manual" key={recipient} onClick={() => removeManualRecipient(recipient)} type="button">
                  직접: {recipient}
                </button>
              ))}
              {selectedRecipients.map((recipient) => (
                <button className="recipient-option" key={recipient.id} onClick={() => removeRecipient(recipient.id)} type="button">
                  {userLabel(recipient)}
                </button>
              ))}
            </div>

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
                rows={8}
                value={form.content}
              />
            </label>

            <label>
              <span>파일 첨부</span>
              <input
                onChange={(event) => setReportAttachment(event.target.files?.[0] ?? null)}
                type="file"
              />
              {reportAttachment && (
                <button className="text-button" onClick={() => setReportAttachment(null)} type="button">
                  선택 해제: {reportAttachment.name}
                </button>
              )}
            </label>

            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "저장 중" : editingId ? "수정" : "등록"}
            </button>
          </form>
        )}

        <section className="panel">
          <div className="panel-head">
            <h2>업무보고 목록</h2>
            <span>{isLoading ? "조회 중" : `${items.length}건`}</span>
          </div>
          <form className="list-filter-bar" onSubmit={handleSearch}>
            <label className="search-field">
              <input
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="제목, 내용, 작성자 검색"
                value={searchInput}
              />
            </label>
            <label className="filter-field">
              <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="">상태 전체</option>
                {Object.entries(reportStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="table-actions">
              <button className="primary-button" type="submit">
                검색
              </button>
              {(searchTerm || statusFilter) && (
                <button
                  className="ghost-button"
                  onClick={() => {
                    clearSearch();
                    setStatusFilter("");
                  }}
                  type="button"
                >
                  초기화
                </button>
              )}
            </div>
          </form>

          {!isExecutive && (
            <div className="table-wrap">
              <h3 className="table-title">보낸 보고서</h3>
              <table>
                <thead>
                  <tr>
                    <th>제목</th>
                    <th>상태</th>
                    <th>보고일</th>
                    <th>수신자</th>
                    <th>수신 상태</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {sentReports.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.title}
                        {renderReportFiles(item.files)}
                      </td>
                      <td>{labelOf(reportStatusLabels, item.status)}</td>
                      <td>{formatDate(item.report_date)}</td>
                      <td>{renderRecipientNames(item)}</td>
                      <td>{renderRecipientStatuses(item)}</td>
                      <td className="table-actions">
                        {item.status === "DRAFT" && (
                          <button className="ghost-button" onClick={() => handleSubmitReport(item.id)} type="button">
                            제출
                          </button>
                        )}
                        {item.status === "RETURNED" && (
                          <button className="ghost-button" onClick={() => handleResubmitReport(item.id)} type="button">
                            재제출
                          </button>
                        )}
                        {["DRAFT", "RETURNED"].includes(item.status) && (
                          <button className="ghost-button" onClick={() => startEdit(item)} type="button">
                            수정
                          </button>
                        )}
                        <button className="danger-button" onClick={() => handleDelete(item.id)} type="button">
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!sentReports.length && (
                    <tr>
                      <td colSpan={6}>보낸 보고서가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className={`table-wrap${isExecutive ? "" : " stacked-table"}`}>
            <h3 className="table-title">받은 보고서</h3>
            <table>
              <thead>
                <tr>
                  <th>제목</th>
                  <th>작성자</th>
                  <th>상태</th>
                  <th>보고일</th>
                  <th>수신 상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {receivedReports.map((item) => {
                  const myRecord = item.recipients?.find((recipient) => recipient.recipient === user?.id) ?? item.recipients?.[0];
                  return (
                    <tr key={`received-${item.id}`}>
                      <td>
                        {item.title}
                        {renderReportFiles(item.files)}
                      </td>
                      <td>{item.writer_name || "-"}</td>
                      <td>{labelOf(reportStatusLabels, item.status)}</td>
                      <td>{formatDate(item.report_date)}</td>
                      <td>{myRecord?.is_read ? formatDateTime(myRecord.read_at) : "안읽음"}</td>
                      <td className="table-actions">
                        {item.status === "SUBMITTED" && (
                          <>
                            <button className="primary-button" onClick={() => handleConfirmReport(item.id)} type="button">
                              확인완료
                            </button>
                            <button className="ghost-button" onClick={() => setReturnTarget(item)} type="button">
                              보완요청
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!receivedReports.length && (
                  <tr>
                    <td colSpan={6}>받은 보고서가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {returnTarget && (
        <div className="modal-backdrop">
          <form className="modal-panel form-stack" onSubmit={handleReturnReport}>
            <div className="panel-head">
              <h2>보완요청 사유</h2>
              <button className="ghost-button" onClick={() => setReturnTarget(null)} type="button">
                닫기
              </button>
            </div>
            <textarea
              onChange={(event) => setReturnReason(event.target.value)}
              required
              rows={5}
              value={returnReason}
            />
            <button className="danger-button" type="submit">
              보완요청
            </button>
          </form>
        </div>
      )}
    </AppShell>
  );
}
