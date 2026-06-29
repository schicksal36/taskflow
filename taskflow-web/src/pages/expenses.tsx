import { FormEvent, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  type ExpenseItem,
  type ExpenseItemInput,
  type ExpenseSummary,
  type Report,
  type ReportInput,
  type UserListItem,
  bulkUpdateExpenseStatus,
  createExpenseItem,
  createExpenseReceipt,
  createReport,
  deleteExpenseItem,
  deleteReport,
  describeApiError,
  fetchExpenseItems,
  fetchExpenseReports,
  fetchExpenseSummary,
  fetchUsers,
  submitReport,
  toArray,
  updateExpenseItem,
  updateReport,
  uploadMediaFile,
} from "@/lib/api";
import { formatDate, formatMoney, todayString } from "@/lib/format";
import { expenseCategoryLabels, labelOf, paymentMethodLabels, reportStatusLabels } from "@/lib/labels";

const emptyReportForm: ReportInput = {
  report_type: "EXPENSE_REPORT",
  title: "",
  content: "",
  report_date: todayString(),
  total_amount: 0,
};

const emptyItemForm: ExpenseItemInput = {
  expense_date: todayString(),
  category: "MEAL",
  description: "",
  amount: "",
  payment_method: "CARD",
};

type ReportPeriodUnit = "day" | "month" | "year";

const periodUnits: Array<{ value: ReportPeriodUnit; label: string }> = [
  { value: "day", label: "일" },
  { value: "month", label: "월" },
  { value: "year", label: "년" },
];

function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeForUnit(unit: ReportPeriodUnit, anchorDate: string) {
  const date = parseDateInput(anchorDate);

  if (unit === "year") {
    return {
      startDate: `${date.getFullYear()}-01-01`,
      endDate: `${date.getFullYear()}-12-31`,
    };
  }

  if (unit === "month") {
    return {
      startDate: formatDateInput(new Date(date.getFullYear(), date.getMonth(), 1)),
      endDate: formatDateInput(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
    };
  }

  return {
    startDate: anchorDate,
    endDate: anchorDate,
  };
}

export default function ExpensesPage() {
  const { accessToken, user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "CEO" || user?.role === "SUPERUSER";
  const initialPeriodRange = rangeForUnit("month", todayString());
  const [reports, setReports] = useState<Report[]>([]);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [reportForm, setReportForm] = useState<ReportInput>(emptyReportForm);
  const [itemForm, setItemForm] = useState<ExpenseItemInput>(emptyItemForm);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptInputKey, setReceiptInputKey] = useState(0);
  const [editingReportId, setEditingReportId] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [periodUnit, setPeriodUnit] = useState<ReportPeriodUnit>("month");
  const [startDate, setStartDate] = useState(initialPeriodRange.startDate);
  const [endDate, setEndDate] = useState(initialPeriodRange.endDate);
  const [statusFilter, setStatusFilter] = useState("");
  const [summaryUnit, setSummaryUnit] = useState<ExpenseSummary["unit"]>("month");
  const [summaryDate, setSummaryDate] = useState(todayString());
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<number[]>([]);
  const [selectedReportIds, setSelectedReportIds] = useState<number[]>([]);

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? null,
    [reports, selectedReportId],
  );

  async function loadReports(nextSelectedId?: number | null) {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetchExpenseReports(accessToken, searchTerm, { startDate, endDate, status: statusFilter });
      const nextReports = toArray(response);
      setReports(nextReports);
      setSelectedReportIds((current) => current.filter((id) => nextReports.some((report) => report.id === id)));
      const requestedId = nextSelectedId !== undefined ? nextSelectedId : selectedReportId;
      const nextId =
        requestedId && nextReports.some((report) => report.id === requestedId)
          ? requestedId
          : nextReports[0]?.id ?? null;
      setSelectedReportId(nextId);
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadItems(reportId: number | null) {
    if (!accessToken || !reportId) {
      setItems([]);
      return;
    }

    try {
      const response = await fetchExpenseItems(accessToken, reportId);
      setItems(toArray(response));
    } catch (error) {
      setMessage(describeApiError(error));
      setItems([]);
    }
  }

  async function loadSummary() {
    if (!accessToken) {
      return;
    }

    try {
      setSummary(await fetchExpenseSummary(accessToken, summaryUnit, summaryDate));
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function loadUsers() {
    if (!accessToken) {
      return;
    }

    try {
      setUsers(toArray(await fetchUsers(accessToken)));
    } catch {
      setUsers([]);
    }
  }

  useEffect(() => {
    loadReports();
    // loadReports는 저장/삭제 후에도 재사용하는 함수라 effect 의존성만 고정합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, searchTerm, startDate, endDate, statusFilter]);

  useEffect(() => {
    loadItems(selectedReportId);
    // loadItems는 선택한 경비보고서가 바뀔 때만 다시 조회합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, selectedReportId]);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, summaryUnit, summaryDate]);

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  function resetReportForm() {
    setEditingReportId(null);
    setReportForm(emptyReportForm);
    setSelectedRecipientIds([]);
  }

  function resetItemForm() {
    setEditingItemId(null);
    setItemForm(emptyItemForm);
    setReceiptFile(null);
    setReceiptInputKey((current) => current + 1);
  }

  function startEditReport(report: Report) {
    setEditingReportId(report.id);
    setReportForm({
      report_type: "EXPENSE_REPORT",
      title: report.title,
      content: report.content ?? "",
      report_date: report.report_date,
      total_amount: report.total_amount ?? 0,
      recipient_ids: report.recipient_ids ?? [],
    });
    setSelectedRecipientIds(report.recipient_ids ?? (report.approver ? [report.approver] : []));
  }

  function startEditItem(item: ExpenseItem) {
    setEditingItemId(item.id);
    setItemForm({
      expense_date: item.expense_date,
      category: item.category,
      description: item.description,
      amount: item.amount,
      payment_method: item.payment_method,
    });
  }

  async function handleReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const nextReportForm = {
        ...reportForm,
        recipient_ids: selectedRecipientIds,
        approver: selectedRecipientIds[0] ?? reportForm.approver ?? null,
      };
      let saved: Report;
      if (editingReportId) {
        saved = await updateReport(accessToken, editingReportId, nextReportForm);
      } else {
        saved = await createReport(accessToken, nextReportForm);
      }
      resetReportForm();
      await loadReports(saved.id);
      await loadSummary();
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleItemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !selectedReportId) {
      setMessage("경비 항목을 추가할 경비보고서를 먼저 선택하세요.");
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      let savedItem: ExpenseItem;
      if (editingItemId) {
        savedItem = await updateExpenseItem(accessToken, editingItemId, itemForm);
      } else {
        savedItem = await createExpenseItem(accessToken, selectedReportId, itemForm);
      }

      if (receiptFile) {
        const media = await uploadMediaFile(accessToken, receiptFile, {
          target_app: "REPORTS",
          target_id: savedItem.id,
        });
        await createExpenseReceipt(accessToken, savedItem.id, media.id);
      }
      resetItemForm();
      await loadItems(selectedReportId);
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteReport(id: number) {
    if (!accessToken) {
      return;
    }

    try {
      await deleteReport(accessToken, id);
      resetReportForm();
      await loadReports(null);
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleDeleteItem(id: number) {
    if (!accessToken || !selectedReportId) {
      return;
    }

    try {
      await deleteExpenseItem(accessToken, id);
      await loadItems(selectedReportId);
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleSubmitReport(id: number) {
    if (!accessToken) {
      return;
    }

    try {
      await submitReport(accessToken, id);
      await loadReports(id);
      await loadSummary();
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

  function selectPeriodUnit(unit: ReportPeriodUnit) {
    const range = rangeForUnit(unit, startDate);
    setPeriodUnit(unit);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }

  function toggleRecipient(id: number) {
    setSelectedRecipientIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function toggleReportSelection(id: number) {
    setSelectedReportIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  async function handleBulkStatus(status: "APPROVED" | "REJECTED") {
    if (!accessToken || !selectedReportIds.length) {
      return;
    }

    try {
      await bulkUpdateExpenseStatus(accessToken, selectedReportIds, status);
      setSelectedReportIds([]);
      await loadReports();
      await loadSummary();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  const filteredUsers = users.filter((item) => {
    if (item.id === user?.id) {
      return false;
    }
    const keyword = recipientSearch.trim().toLowerCase();
    if (!keyword) {
      return true;
    }
    return [item.display_name, item.email, item.department, item.position]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  });

  return (
    <AppShell title="경비지출" description="경비보고서와 경비 항목 API로 지출 내역을 관리합니다.">
      {message && <p className="notice error">{message}</p>}

      <section className="panel form-stack">
        <div className="panel-head">
          <h2>총금액 요약</h2>
          <div className="table-actions">
            {periodUnits.map((unit) => (
              <button
                className={summaryUnit === unit.value ? "primary-button" : "ghost-button"}
                key={unit.value}
                onClick={() => setSummaryUnit(unit.value)}
                type="button"
              >
                {unit.label}
              </button>
            ))}
          </div>
        </div>
        <div className="form-row between">
          <label>
            <span>조회 기준일</span>
            <input onChange={(event) => setSummaryDate(event.target.value)} type="date" value={summaryDate} />
          </label>
          <strong className="summary-total">
            {summary?.date ?? "-"} 총 지출: {formatMoney(summary?.total_amount ?? 0)} ({summary?.total_count ?? 0}건)
          </strong>
        </div>
      </section>

      <section className="expense-layout">
        <form className="panel form-stack" onSubmit={handleReportSubmit}>
          <div className="panel-head">
            <h2>{editingReportId ? "경비보고서 수정" : "경비보고서 등록"}</h2>
            {editingReportId && (
              <button className="ghost-button" onClick={resetReportForm} type="button">
                취소
              </button>
            )}
          </div>

          <label>
            <span>제목</span>
            <input
              onChange={(event) => setReportForm((current) => ({ ...current, title: event.target.value }))}
              required
              value={reportForm.title}
            />
          </label>

          <div className="form-grid two">
            <label>
              <span>보고일</span>
              <input
                onChange={(event) => setReportForm((current) => ({ ...current, report_date: event.target.value }))}
                required
                type="date"
                value={reportForm.report_date}
              />
            </label>
            <label>
              <span>총 금액</span>
              <input
                min="0"
                onChange={(event) => setReportForm((current) => ({ ...current, total_amount: event.target.value }))}
                type="number"
                value={reportForm.total_amount}
              />
            </label>
          </div>

          <label>
            <span>내용</span>
            <textarea
              onChange={(event) => setReportForm((current) => ({ ...current, content: event.target.value }))}
              rows={4}
              value={reportForm.content}
            />
          </label>

          <label>
            <span>수신자</span>
            <input
              onChange={(event) => setRecipientSearch(event.target.value)}
              placeholder="이름, 이메일, 부서 검색"
              value={recipientSearch}
            />
          </label>
          <div className="recipient-picker">
            {filteredUsers.slice(0, 8).map((item) => (
              <label className="check-label recipient-option" key={item.id}>
                <input
                  checked={selectedRecipientIds.includes(item.id)}
                  onChange={() => toggleRecipient(item.id)}
                  type="checkbox"
                />
                {item.display_name ?? item.email}
              </label>
            ))}
          </div>

          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? "저장 중" : editingReportId ? "수정" : "등록"}
          </button>
        </form>

        <form className="panel form-stack" onSubmit={handleItemSubmit}>
          <div className="panel-head">
            <h2>{editingItemId ? "경비 항목 수정" : "경비 항목 추가"}</h2>
            {editingItemId && (
              <button className="ghost-button" onClick={resetItemForm} type="button">
                취소
              </button>
            )}
          </div>

          <label>
            <span>경비보고서</span>
            <select
              onChange={(event) => setSelectedReportId(event.target.value ? Number(event.target.value) : null)}
              value={selectedReportId ?? ""}
            >
              <option value="">선택</option>
              {reports.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.title}
                </option>
              ))}
            </select>
          </label>

          <div className="form-grid two">
            <label>
              <span>사용일</span>
              <input
                onChange={(event) => setItemForm((current) => ({ ...current, expense_date: event.target.value }))}
                required
                type="date"
                value={itemForm.expense_date}
              />
            </label>
            <label>
              <span>금액</span>
              <input
                min="0"
                onChange={(event) => setItemForm((current) => ({ ...current, amount: event.target.value }))}
                required
                type="number"
                value={itemForm.amount}
              />
            </label>
          </div>

          <div className="form-grid two">
            <label>
              <span>분류</span>
              <select
                onChange={(event) => setItemForm((current) => ({ ...current, category: event.target.value }))}
                value={itemForm.category}
              >
                {Object.entries(expenseCategoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>결제수단</span>
              <select
                onChange={(event) => setItemForm((current) => ({ ...current, payment_method: event.target.value }))}
                value={itemForm.payment_method}
              >
                {Object.entries(paymentMethodLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            <span>지출처</span>
            <input
              onChange={(event) => setItemForm((current) => ({ ...current, description: event.target.value }))}
              required
              value={itemForm.description}
            />
          </label>

          <label>
            <span>영수증 첨부</span>
            <input
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              key={receiptInputKey}
              onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>

          <button className="primary-button" disabled={isSaving || !selectedReportId} type="submit">
            {isSaving ? "저장 중" : editingItemId ? "수정" : "항목 추가"}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>경비보고서 목록</h2>
          <span>{isLoading ? "조회 중" : `${reports.length}건`}</span>
        </div>
        {isAdmin && (
          <div className="table-actions list-search">
            <button className="primary-button" disabled={!selectedReportIds.length} onClick={() => handleBulkStatus("APPROVED")} type="button">
              정산완료
            </button>
            <button className="danger-button" disabled={!selectedReportIds.length} onClick={() => handleBulkStatus("REJECTED")} type="button">
              반려
            </button>
          </div>
        )}
        <div className="form-row between list-search">
          <div className="table-actions">
            {periodUnits.map((unit) => (
              <button
                className={periodUnit === unit.value ? "primary-button" : "ghost-button"}
                key={unit.value}
                onClick={() => selectPeriodUnit(unit.value)}
                type="button"
              >
                {unit.label}
              </button>
            ))}
          </div>
          <div className="form-row">
            <label>
              <span>시작일</span>
              <input max={endDate} onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} />
            </label>
            <label>
              <span>끝날짜</span>
              <input min={startDate} onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
            </label>
          </div>
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {isAdmin && <th>선택</th>}
                <th>제목</th>
                <th>지출처</th>
                <th>열람</th>
                <th>상태</th>
                <th>보고일</th>
                <th>총 금액</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id} className={report.id === selectedReportId ? "selected-row" : ""}>
                  {isAdmin && (
                    <td>
                      <input
                        checked={selectedReportIds.includes(report.id)}
                        onChange={() => toggleReportSelection(report.id)}
                        type="checkbox"
                      />
                    </td>
                  )}
                  <td>
                    <button className="text-button" onClick={() => setSelectedReportId(report.id)} type="button">
                      {report.title}
                    </button>
                  </td>
                  <td>{report.expense_place || "-"}</td>
                  <td>{report.is_viewed ? "열람" : "미열람"}</td>
                  <td>
                    <span className={`status-pill ${report.status === "APPROVED" ? "blue" : report.status === "REJECTED" ? "red" : "muted"}`}>
                      {labelOf(reportStatusLabels, report.status)}
                    </span>
                  </td>
                  <td>{formatDate(report.report_date)}</td>
                  <td>{formatMoney(report.total_amount)}</td>
                  <td className="table-actions">
                    {!isAdmin && report.status === "DRAFT" && (
                      <button className="ghost-button" onClick={() => handleSubmitReport(report.id)} type="button">
                        제출
                      </button>
                    )}
                    <button className="ghost-button" onClick={() => startEditReport(report)} type="button">
                      수정
                    </button>
                    <button className="danger-button" onClick={() => handleDeleteReport(report.id)} type="button">
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {!reports.length && (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7}>조회된 경비보고서가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{selectedReport ? `${selectedReport.title} 항목` : "경비 항목"}</h2>
          <span>{items.length}건</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>사용일</th>
                <th>분류</th>
                <th>내용</th>
                <th>결제수단</th>
                <th>금액</th>
                <th>영수증</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.expense_date)}</td>
                  <td>{labelOf(expenseCategoryLabels, item.category)}</td>
                  <td>{item.description}</td>
                  <td>{labelOf(paymentMethodLabels, item.payment_method)}</td>
                  <td>{formatMoney(item.amount)}</td>
                  <td>{item.receipt_file ? "첨부됨" : "-"}</td>
                  <td className="table-actions">
                    <button className="ghost-button" onClick={() => startEditItem(item)} type="button">
                      수정
                    </button>
                    <button className="danger-button" onClick={() => handleDeleteItem(item.id)} type="button">
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={7}>선택한 경비보고서의 항목이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
