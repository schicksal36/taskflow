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
import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import {
  type ExpenseItemInput,
  type ExpenseWorkflowStatus,
  type Report,
  type ReportInput,
  type ReportFile,
  type UserListItem,
  approveExpenseReport,
  attachReportFile,
  bulkUpdateExpenseStatus,
  cancelReport,
  confirmReport,
  completeExpenseSettlement,
  createReport,
  deleteReport,
  describeApiError,
  downloadReportFile,
  fetchReport,
  fetchReports,
  fetchUsers,
  rejectExpenseReport,
  resubmitReport,
  returnReport,
  searchUsers,
  settleExpenseReport,
  submitReport,
  toArray,
  updateReport,
  uploadMediaFile,
} from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, todayString } from "@/lib/format";
import { expenseCategoryLabels, labelOf, paymentMethodLabels, reportStatusLabels, reportTypeLabels } from "@/lib/labels";

const visibleReportTypes = new Set(["DAILY_REPORT", "WORK_REPORT", "EXPENSE_REPORT"]);

const bulkExpenseStatusLabels: Record<ExpenseWorkflowStatus, string> = {
  APPROVED: "승인",
  REJECTED: "반려",
  SETTLING: "정산중",
  SETTLED: "정산완료",
};

function nextExpenseStatuses(status: string): ExpenseWorkflowStatus[] {
  if (status === "SUBMITTED") {
    return ["APPROVED", "REJECTED"];
  }
  if (status === "APPROVED") {
    return ["SETTLING"];
  }
  if (status === "SETTLING" || status === "REVIEWING") {
    return ["SETTLED"];
  }
  return [];
}

const emptyForm: ReportInput = {
  report_type: "WORK_REPORT",
  title: "",
  content: "",
  report_date: todayString(),
  total_amount: 0,
  recipient_ids: [],
};

const emptyExpenseItem: ExpenseItemInput = {
  expense_date: todayString(),
  category: "MEAL",
  description: "",
  amount: "",
  payment_method: "CARD",
};

function userLabel(user: UserListItem) {
  const name = user.display_name || user.email;
  const details = [user.department, user.position].filter(Boolean);
  return details.length ? `${name} (${details.join(" / ")})` : name;
}

function recipientLabel(recipient: NonNullable<Report["recipients"]>[number]) {
  const details = [recipient.department, recipient.position].filter(Boolean);
  return details.length ? `${recipient.name} (${details.join(" / ")})` : recipient.name;
}

function amountOf(value?: string | number | null) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function monthKeyOf(value?: string | null) {
  return value?.slice(0, 7) || "날짜 없음";
}

function monthLabelOf(value: string) {
  if (value === "날짜 없음") {
    return value;
  }
  const [year, month] = value.split("-");
  return `${year}년 ${Number(month)}월`;
}

function buildSettlementSummary(reports: Report[]) {
  const settledReports = reports.filter((item) => item.report_type === "EXPENSE_REPORT" && item.status === "SETTLED");
  const currentMonth = todayString().slice(0, 7);
  const monthlyMap = settledReports.reduce<Record<string, number>>((result, item) => {
    const key = monthKeyOf(item.report_date);
    result[key] = (result[key] ?? 0) + amountOf(item.total_amount);
    return result;
  }, {});

  return {
    currentMonth,
    currentMonthTotal: monthlyMap[currentMonth] ?? 0,
    settledCount: settledReports.length,
    total: settledReports.reduce((sum, item) => sum + amountOf(item.total_amount), 0),
    monthly: Object.entries(monthlyMap)
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([month, amount]) => ({ month, amount })),
  };
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
  const [expenseItem, setExpenseItem] = useState<ExpenseItemInput>(emptyExpenseItem);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedRecipients, setSelectedRecipients] = useState<UserListItem[]>([]);
  const [manualRecipients, setManualRecipients] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientResults, setRecipientResults] = useState<UserListItem[]>([]);
  const [reportAttachment, setReportAttachment] = useState<File | null>(null);
  const [returnTarget, setReturnTarget] = useState<Report | null>(null);
  const [detailTarget, setDetailTarget] = useState<Report | null>(null);
  const [expenseDetailTarget, setExpenseDetailTarget] = useState<Report | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reportTypeFilter, setReportTypeFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [writerFilter, setWriterFilter] = useState("");
  const [reportUsers, setReportUsers] = useState<UserListItem[]>([]);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<number[]>([]);
  const [bulkExpenseStatus, setBulkExpenseStatus] = useState<ExpenseWorkflowStatus>("APPROVED");
  const [bulkRejectReason, setBulkRejectReason] = useState("");
  const [managerView, setManagerView] = useState<"pending" | "all">("pending");

  const isExecutive = user?.role === "CEO" || user?.role === "SUPERUSER";
  const isManagerView = isExecutive || user?.role === "ADMIN";
  const departmentOptions = useMemo(
    () => Array.from(new Set(reportUsers.map((entry) => entry.department).filter(Boolean) as string[])).sort((left, right) => left.localeCompare(right)),
    [reportUsers],
  );
  const writerOptions = useMemo(
    () =>
      reportUsers
        .filter((entry) => !departmentFilter || entry.department === departmentFilter)
        .sort((left, right) => (left.display_name || left.email).localeCompare(right.display_name || right.email)),
    [departmentFilter, reportUsers],
  );
  const filteredReports = items.filter((item) => !reportTypeFilter || item.report_type === reportTypeFilter);
  const sentReports = isExecutive ? [] : filteredReports.filter((item) => item.writer === user?.id);
  const sentExpenseReports = sentReports.filter((item) => item.report_type === "EXPENSE_REPORT");
  const receivedReports = isExecutive
    ? filteredReports.filter((item) => !["DRAFT", "CANCELED"].includes(item.status))
    : filteredReports.filter(
        (item) =>
          item.approver === user?.id ||
          item.recipient_ids?.includes(user?.id ?? -1) ||
          item.recipients?.some((recipient) => recipient.recipient === user?.id),
      );
  const managerExpenseReports = isManagerView
    ? receivedReports.filter((item) => item.report_type === "EXPENSE_REPORT")
    : [];
  const visibleReceivedReports = useMemo(() => {
    if (!isManagerView) {
      return receivedReports;
    }
    if (managerView === "pending") {
      return receivedReports.filter((item) => item.status === "SUBMITTED");
    }
    return receivedReports;
  }, [isManagerView, managerView, receivedReports]);
  const visibleReportRows = isManagerView
    ? visibleReceivedReports.filter((item) => item.report_type !== "EXPENSE_REPORT")
    : visibleReceivedReports;
  const visibleManagerExpenseReports = isManagerView
    ? managerExpenseReports
    : [];
  const manageableExpenseReports = visibleManagerExpenseReports.filter((item) => item.writer !== user?.id && nextExpenseStatuses(item.status).length > 0);
  const hasManageableExpenseReports = manageableExpenseReports.length > 0;
  const selectedManageableExpenseReports = manageableExpenseReports.filter((item) => selectedExpenseIds.includes(item.id));
  const availableBulkExpenseStatuses = useMemo(() => {
    if (!selectedManageableExpenseReports.length) {
      return Object.keys(bulkExpenseStatusLabels) as ExpenseWorkflowStatus[];
    }

    return selectedManageableExpenseReports.reduce<ExpenseWorkflowStatus[]>((result, item, index) => {
      const nextStatuses = nextExpenseStatuses(item.status);
      if (index === 0) {
        return nextStatuses;
      }
      return result.filter((status) => nextStatuses.includes(status));
    }, []);
  }, [selectedManageableExpenseReports]);
  const canBulkUpdateExpense =
    selectedManageableExpenseReports.length > 0 && availableBulkExpenseStatuses.includes(bulkExpenseStatus);
  const settlementSummary = useMemo(() => buildSettlementSummary(sentExpenseReports), [sentExpenseReports]);
  const managerSettlementSummary = useMemo(() => buildSettlementSummary(receivedReports), [receivedReports]);
  const managerSummary = useMemo(() => ({
    pendingReports: receivedReports.filter((item) => item.report_type !== "EXPENSE_REPORT" && item.status === "SUBMITTED").length,
    pendingExpenses: receivedReports.filter((item) => item.report_type === "EXPENSE_REPORT" && item.status === "SUBMITTED").length,
    approvedExpenses: receivedReports.filter((item) => item.report_type === "EXPENSE_REPORT" && item.status === "APPROVED").length,
    settlingExpenses: receivedReports.filter((item) => item.report_type === "EXPENSE_REPORT" && ["SETTLING", "REVIEWING"].includes(item.status)).length,
    settledExpenses: receivedReports.filter((item) => item.report_type === "EXPENSE_REPORT" && item.status === "SETTLED").length,
  }), [receivedReports]);

  useEffect(() => {
    if (availableBulkExpenseStatuses.length && !availableBulkExpenseStatuses.includes(bulkExpenseStatus)) {
      setBulkExpenseStatus(availableBulkExpenseStatuses[0]);
    }
  }, [availableBulkExpenseStatuses, bulkExpenseStatus]);

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
      const response = await fetchReports(accessToken, searchTerm, {
        status: statusFilter,
        report_type: reportTypeFilter,
        writer: writerFilter,
        department: departmentFilter,
      });
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
  }, [accessToken, searchTerm, statusFilter, reportTypeFilter, writerFilter, departmentFilter]);

  useEffect(() => {
    async function loadReportUsers() {
      if (!accessToken || !isManagerView) {
        setReportUsers([]);
        return;
      }

      try {
        setReportUsers(toArray(await fetchUsers(accessToken)));
      } catch {
        setReportUsers([]);
      }
    }

    loadReportUsers();
  }, [accessToken, isManagerView]);

  useEffect(() => {
    if (router.query.mode === "create") {
      resetForm();
      setIsEditorOpen(true);
    }
    if (router.query.type === "expense") {
      setReportTypeFilter("EXPENSE_REPORT");
      setForm((current) => ({ ...current, report_type: "EXPENSE_REPORT" }));
    }
  }, [router.query.mode, router.query.type]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setExpenseItem(emptyExpenseItem);
    setSelectedRecipients([]);
    setManualRecipients([]);
    setRecipientSearch("");
    setRecipientResults([]);
    setReportAttachment(null);
    setIsEditorOpen(false);
  }

  function openCreateForm() {
    if (isEditorOpen) {
      resetForm();
      return;
    }
    setEditingId(null);
    setForm(emptyForm);
    setExpenseItem(emptyExpenseItem);
    setSelectedRecipients([]);
    setManualRecipients([]);
    setRecipientSearch("");
    setRecipientResults([]);
    setReportAttachment(null);
    setIsEditorOpen(true);
  }

  function fillEditForm(item: Report) {
    setEditingId(item.id);
    setIsEditorOpen(true);
    setForm({
      report_type: item.report_type === "EXPENSE_REPORT" ? "EXPENSE_REPORT" : "WORK_REPORT",
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
    const firstExpenseItem = item.expense_items?.[0];
    setExpenseItem(firstExpenseItem
      ? {
          expense_date: firstExpenseItem.expense_date,
          category: firstExpenseItem.category,
          description: firstExpenseItem.description,
          amount: firstExpenseItem.amount,
          payment_method: firstExpenseItem.payment_method,
        }
      : emptyExpenseItem);
  }

  async function startEdit(item: Report) {
    if (!accessToken) {
      fillEditForm(item);
      return;
    }

    setIsDetailLoading(true);
    setMessage("");
    try {
      fillEditForm(await fetchReport(accessToken, item.id));
    } catch (error) {
      setMessage(describeApiError(error));
      fillEditForm(item);
    } finally {
      setIsDetailLoading(false);
    }
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
      const isExpense = form.report_type === "EXPENSE_REPORT";
      const payload: ReportInput = {
        ...form,
        report_type: isExpense ? "EXPENSE_REPORT" : "WORK_REPORT",
        recipient_inputs: manualRecipients,
        approver: form.recipient_ids?.[0] ?? form.approver ?? null,
      };
      if (isExpense) {
        payload.total_amount = expenseItem.amount || 0;
        payload.expense_items = expenseItem.amount || expenseItem.description
          ? [{ ...expenseItem, description: expenseItem.description || form.title }]
          : [];
      }
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

  async function handleOpenReportDetail(id: number) {
    if (!accessToken) {
      return;
    }

    setIsDetailLoading(true);
    setMessage("");
    try {
      const report = await fetchReport(accessToken, id);
      setDetailTarget(report);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function handleOpenExpenseDetail(id: number) {
    if (!accessToken) {
      return;
    }

    setIsDetailLoading(true);
    setMessage("");
    try {
      const report = await fetchReport(accessToken, id);
      setExpenseDetailTarget(report);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsDetailLoading(false);
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

  function renderAttachmentPresence(files?: ReportFile[]) {
    return files?.length ? "있음" : "없음";
  }

  function renderRecipientNames(item: Report) {
    if (!item.recipients?.length) {
      return "-";
    }
    return (
      <div className="recipient-status-list">
        {item.recipients.map((recipient) => (
          <span key={recipient.id}>{recipientLabel(recipient)}</span>
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
              ? "확인완료"
              : recipient.returned_at
                ? "보완요청"
                : recipient.is_read
                  ? "읽음"
                  : "안읽음"}
          </span>
        ))}
      </div>
    );
  }

  function renderRecipientDetailStatuses(item: Report) {
    if (!item.recipients?.length) {
      return <p className="report-detail-empty">수신자가 없습니다.</p>;
    }
    return (
      <div className="recipient-detail-status-list">
        {item.recipients.map((recipient) => {
          const status = recipient.confirmed_at
            ? "확인완료"
            : recipient.returned_at
              ? "보완요청"
              : recipient.is_read
                ? "읽음"
                : "안읽음";
          const statusTime = recipient.confirmed_at || recipient.returned_at || recipient.read_at;
          return (
            <div key={recipient.id}>
              <strong>{recipientLabel(recipient)}</strong>
              <span>{status}</span>
              <small>{statusTime ? formatDateTime(statusTime) : "수신 시간 없음"}</small>
            </div>
          );
        })}
      </div>
    );
  }

  function renderExpenseItems(item: Report) {
    if (!item.expense_items?.length) {
      return <p className="report-detail-empty">등록된 경비지출 항목이 없습니다.</p>;
    }
    return (
      <div className="table-wrap expense-item-wrap">
        <table className="report-table expense-item-table">
          <thead>
            <tr>
              <th>사용일</th>
              <th>분류</th>
              <th>지출처</th>
              <th>금액</th>
              <th>결제수단</th>
            </tr>
          </thead>
          <tbody>
            {item.expense_items.map((expense) => (
              <tr key={expense.id}>
                <td>{formatDate(expense.expense_date)}</td>
                <td>{labelOf(expenseCategoryLabels, expense.category)}</td>
                <td>
                  <strong className="expense-place-cell">{expense.description || "-"}</strong>
                </td>
                <td className="money-cell">{formatMoney(expense.amount)}</td>
                <td>{labelOf(paymentMethodLabels, expense.payment_method)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function canReviseSubmittedReport(item: Report) {
    return item.status === "SUBMITTED" && !item.recipients?.some((recipient) => recipient.is_read);
  }

  function canEditSentReport(item: Report) {
    return ["DRAFT", "RETURNED"].includes(item.status) || canReviseSubmittedReport(item);
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

  async function handleApproveExpense(id: number) {
    if (!accessToken) {
      return;
    }
    try {
      await approveExpenseReport(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleSettleExpense(id: number) {
    if (!accessToken) {
      return;
    }
    try {
      await settleExpenseReport(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleCompleteExpenseSettlement(id: number) {
    if (!accessToken) {
      return;
    }
    try {
      await completeExpenseSettlement(accessToken, id);
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

  async function handleCancelReport(id: number) {
    if (!accessToken) {
      return;
    }

    try {
      await cancelReport(accessToken, id);
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
      if (returnTarget.report_type === "EXPENSE_REPORT") {
        await rejectExpenseReport(accessToken, returnTarget.id, returnReason);
      } else {
        await returnReport(accessToken, returnTarget.id, returnReason);
      }
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

  function toggleExpenseSelection(id: number) {
    setSelectedExpenseIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  function toggleAllManageableExpenses() {
    const ids = manageableExpenseReports.map((item) => item.id);
    setSelectedExpenseIds((current) => {
      const selectedSet = new Set(current);
      const allSelected = ids.length > 0 && ids.every((id) => selectedSet.has(id));
      if (allSelected) {
        return current.filter((id) => !ids.includes(id));
      }
      return Array.from(new Set([...current, ...ids]));
    });
  }

  async function handleBulkExpenseStatus() {
    if (!accessToken || !selectedManageableExpenseReports.length) {
      return;
    }
    if (!availableBulkExpenseStatuses.includes(bulkExpenseStatus)) {
      setMessage("선택한 경비지출은 현재 상태에서 해당 처리로 변경할 수 없습니다.");
      return;
    }
    try {
      await bulkUpdateExpenseStatus(accessToken, selectedManageableExpenseReports.map((item) => item.id), bulkExpenseStatus, bulkRejectReason);
      setSelectedExpenseIds([]);
      setBulkRejectReason("");
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  return (
    <AppShell
      title="보고관리"
      description="업무보고와 경비지출을 한 화면에서 작성하고 확인 상태를 관리합니다."
      actions={
        !isExecutive && (
          <button className={isEditorOpen ? "ghost-button" : "primary-button"} onClick={openCreateForm} type="button">
            {isEditorOpen ? "보고 작성 닫기" : "보고 작성"}
          </button>
        )
      }
    >
      {message && <p className="notice error">{message}</p>}

      {isManagerView && (
        <section className="stat-grid report-manager-stats">
          <StatCard label="보고 확인대기" value={managerSummary.pendingReports} tone="blue" />
          <StatCard label="경비 승인대기" value={managerSummary.pendingExpenses} tone="orange" />
          <StatCard label="승인 후 대기" value={managerSummary.approvedExpenses} tone="green" />
          <StatCard label="정산중" value={managerSummary.settlingExpenses} tone="purple" />
          <StatCard label="정산완료" value={managerSummary.settledExpenses} tone="blue" />
        </section>
      )}

      <section className="editor-layout collapsed">
        <section className="panel">
          <div className="panel-head">
            <h2>보고 목록</h2>
            <div className="panel-actions">
              <span>{isLoading ? "조회 중" : `${filteredReports.length}건`}</span>
            </div>
          </div>
          <form className={`list-filter-bar report-filter-bar${isManagerView ? " manager-report-filter" : ""}`} onSubmit={handleSearch}>
            <label className="search-field">
              <input
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="제목, 내용, 작성자 검색"
                value={searchInput}
              />
            </label>
            <label className="filter-field">
              <select onChange={(event) => setReportTypeFilter(event.target.value)} value={reportTypeFilter}>
                <option value="">유형 전체</option>
                <option value="WORK_REPORT">업무보고</option>
                <option value="EXPENSE_REPORT">경비지출</option>
              </select>
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
            {isManagerView && (
              <>
                <label className="filter-field">
                  <select
                    onChange={(event) => {
                      setDepartmentFilter(event.target.value);
                      setWriterFilter("");
                    }}
                    value={departmentFilter}
                  >
                    <option value="">부서 전체</option>
                    {departmentOptions.map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter-field">
                  <select onChange={(event) => setWriterFilter(event.target.value)} value={writerFilter}>
                    <option value="">작성자 전체</option>
                    {writerOptions.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {userLabel(entry)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <div className="table-actions">
              <button className="primary-button" type="submit">
                검색
              </button>
              {(searchTerm || statusFilter || reportTypeFilter || departmentFilter || writerFilter) && (
                <button
                  className="ghost-button"
                  onClick={() => {
                    clearSearch();
                    setStatusFilter("");
                    setReportTypeFilter("");
                    setDepartmentFilter("");
                    setWriterFilter("");
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
              <table className="report-table sent-report-table">
                <thead>
                  <tr>
                    <th>제목</th>
                    <th>유형</th>
                    <th>첨부</th>
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
                        <button className="table-title-button" onClick={() => handleOpenReportDetail(item.id)} type="button">
                          {item.title}
                        </button>
                      </td>
                      <td>{labelOf(reportTypeLabels, item.report_type)}</td>
                      <td>{renderAttachmentPresence(item.files)}</td>
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
                        {canReviseSubmittedReport(item) && (
                          <button className="ghost-button" onClick={() => handleCancelReport(item.id)} type="button">
                            취소
                          </button>
                        )}
                        {canEditSentReport(item) && (
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
                      <td colSpan={8}>보낸 보고서가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className={`table-wrap${isExecutive ? "" : " stacked-table"}`}>
            <div className="report-section-head">
              <h3 className="table-title">{isManagerView ? "보고서" : "받은 보고서"}</h3>
              {isManagerView && (
                <div className="tab-row compact-tabs">
                  <button className={managerView === "pending" ? "active" : ""} onClick={() => setManagerView("pending")} type="button">
                    처리대기
                  </button>
                  <button className={managerView === "all" ? "active" : ""} onClick={() => setManagerView("all")} type="button">
                    전체
                  </button>
                </div>
              )}
            </div>
            <table className="report-table received-report-table">
              <thead>
                <tr>
                  <th>제목</th>
                  <th>유형</th>
                  <th>첨부</th>
                  <th>작성자</th>
                  <th>상태</th>
                  <th>보고일</th>
                  <th>수신 상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {visibleReportRows.map((item) => {
                  const myRecord = item.recipients?.find((recipient) => recipient.recipient === user?.id) ?? item.recipients?.[0];
                  return (
                    <tr key={`received-${item.id}`}>
                      <td>
                        <button className="table-title-button" onClick={() => handleOpenReportDetail(item.id)} type="button">
                          {item.title}
                        </button>
                      </td>
                      <td>{labelOf(reportTypeLabels, item.report_type)}</td>
                      <td>{renderAttachmentPresence(item.files)}</td>
                      <td>{item.writer_name || "-"}</td>
                      <td>{labelOf(reportStatusLabels, item.status)}</td>
                      <td>{formatDate(item.report_date)}</td>
                      <td>{myRecord?.is_read ? "읽음" : "안읽음"}</td>
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
                {!visibleReportRows.length && (
                  <tr>
                    <td colSpan={8}>{isManagerView ? "현재 탭에 표시할 보고서가 없습니다." : "받은 보고서가 없습니다."}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {isManagerView && (
              <div className="table-wrap stacked-table">
                <div className="report-section-head">
                  <h3 className="table-title">경비 내역</h3>
                  <div className="expense-settlement-summary" aria-label="관리자 경비 내역 요약">
                    <span className="section-count">{visibleManagerExpenseReports.length}건</span>
                    <strong>이번 달 {formatMoney(managerSettlementSummary.currentMonthTotal)}</strong>
                    <strong>전체 {formatMoney(managerSettlementSummary.total)}</strong>
                  </div>
                </div>
                {hasManageableExpenseReports && (
                  <div className="expense-bulk-bar">
                    <label className="check-label">
                      <input
                        checked={manageableExpenseReports.length > 0 && manageableExpenseReports.every((item) => selectedExpenseIds.includes(item.id))}
                        onChange={toggleAllManageableExpenses}
                        type="checkbox"
                      />
                      경비지출 전체 선택
                    </label>
                    <select
                      disabled={!availableBulkExpenseStatuses.length}
                      onChange={(event) => setBulkExpenseStatus(event.target.value as ExpenseWorkflowStatus)}
                      value={availableBulkExpenseStatuses.includes(bulkExpenseStatus) ? bulkExpenseStatus : ""}
                    >
                      {availableBulkExpenseStatuses.length ? (
                        availableBulkExpenseStatuses.map((status) => (
                          <option key={status} value={status}>
                            {bulkExpenseStatusLabels[status]}
                          </option>
                        ))
                      ) : (
                        <option value="">변경 가능 상태 없음</option>
                      )}
                    </select>
                    {bulkExpenseStatus === "REJECTED" && (
                      <input
                        onChange={(event) => setBulkRejectReason(event.target.value)}
                        placeholder="반려 사유"
                        value={bulkRejectReason}
                      />
                    )}
                    <button className="primary-button" disabled={!canBulkUpdateExpense} onClick={handleBulkExpenseStatus} type="button">
                      선택 {selectedManageableExpenseReports.length}건 변경
                    </button>
                  </div>
                )}
                <table className="report-table expense-history-table">
                  <thead>
                    <tr>
                      {hasManageableExpenseReports && <th>선택</th>}
                      <th>제목</th>
                      <th>지출처</th>
                      <th>작성자</th>
                      <th>보고일</th>
                      <th>금액</th>
                      <th>상태</th>
                      <th>수신 상태</th>
                      <th>항목</th>
                      {hasManageableExpenseReports && <th>관리</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleManagerExpenseReports.map((item) => {
                      const canManageExpense = item.writer !== user?.id && nextExpenseStatuses(item.status).length > 0;
                      return (
                        <tr key={`manager-expense-${item.id}`}>
                          {hasManageableExpenseReports && (
                            <td>
                              {canManageExpense ? (
                                <input
                                  checked={selectedExpenseIds.includes(item.id)}
                                  onChange={() => toggleExpenseSelection(item.id)}
                                  type="checkbox"
                                />
                              ) : "-"}
                            </td>
                          )}
                          <td>
                            <button className="table-title-button" onClick={() => handleOpenReportDetail(item.id)} type="button">
                              {item.title}
                            </button>
                          </td>
                          <td>{item.expense_place || "-"}</td>
                          <td>{item.writer_name || "-"}</td>
                          <td>{formatDate(item.report_date)}</td>
                          <td>{formatMoney(item.total_amount)}</td>
                          <td>{labelOf(reportStatusLabels, item.status)}</td>
                          <td>{renderRecipientStatuses(item)}</td>
                          <td className="table-actions">
                            <button className="ghost-button" onClick={() => handleOpenExpenseDetail(item.id)} type="button">
                              항목 보기
                            </button>
                          </td>
                          {hasManageableExpenseReports && (
                            <td className="table-actions">
                              {item.status === "SUBMITTED" && (
                                <>
                                  <button className="primary-button" onClick={() => handleApproveExpense(item.id)} type="button">
                                    승인
                                  </button>
                                  <button className="ghost-button" onClick={() => setReturnTarget(item)} type="button">
                                    반려
                                  </button>
                                </>
                              )}
                              {item.status === "APPROVED" && (
                                <button className="ghost-button" onClick={() => handleSettleExpense(item.id)} type="button">
                                  정산중
                                </button>
                              )}
                              {["SETTLING", "REVIEWING"].includes(item.status) && (
                                <button className="primary-button" onClick={() => handleCompleteExpenseSettlement(item.id)} type="button">
                                  정산완료
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {!visibleManagerExpenseReports.length && (
                      <tr>
                        <td colSpan={hasManageableExpenseReports ? 10 : 8}>경비 내역이 없습니다.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!isExecutive && (
            <div className="table-wrap stacked-table">
              <div className="report-section-head">
                <h3 className="table-title">경비지출 내역</h3>
                <div className="expense-settlement-summary" aria-label="정산완료 기준 받을 금액">
                  <span className="section-count">정산완료 {settlementSummary.settledCount}건</span>
                  <strong>이번 달 {formatMoney(settlementSummary.currentMonthTotal)}</strong>
                  <strong>전체 {formatMoney(settlementSummary.total)}</strong>
                </div>
              </div>
              {!!settlementSummary.monthly.length && (
                <div className="expense-monthly-summary">
                  {settlementSummary.monthly.map((entry) => (
                    <span key={entry.month}>
                      {monthLabelOf(entry.month)} {formatMoney(entry.amount)}
                    </span>
                  ))}
                </div>
              )}
              <table className="report-table expense-history-table">
                <thead>
                  <tr>
                    <th>제목</th>
                    <th>지출처</th>
                    <th>보고일</th>
                    <th>금액</th>
                    <th>상태</th>
                    <th>수신자</th>
                    <th>수신 상태</th>
                    <th>항목</th>
                  </tr>
                </thead>
                <tbody>
                  {sentExpenseReports.map((item) => (
                    <tr key={`expense-history-${item.id}`}>
                      <td>
                        <button className="table-title-button" onClick={() => handleOpenReportDetail(item.id)} type="button">
                          {item.title}
                        </button>
                      </td>
                      <td>{item.expense_place || "-"}</td>
                      <td>{formatDate(item.report_date)}</td>
                      <td>{formatMoney(item.total_amount)}</td>
                      <td>{labelOf(reportStatusLabels, item.status)}</td>
                      <td>{renderRecipientNames(item)}</td>
                      <td>{renderRecipientStatuses(item)}</td>
                      <td className="table-actions">
                        <button className="ghost-button" onClick={() => handleOpenExpenseDetail(item.id)} type="button">
                          항목 보기
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!sentExpenseReports.length && (
                    <tr>
                      <td colSpan={8}>경비지출 내역이 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>

      {isEditorOpen && !isExecutive && (
        <div className="modal-backdrop">
          <form className="modal-panel report-detail-modal form-stack report-editor-modal" onSubmit={handleSubmit}>
            <div className="panel-head">
              <h2>{editingId ? "보고 수정" : "보고 작성"}</h2>
              <button className="ghost-button" onClick={openCreateForm} type="button">보고 작성 닫기</button>
            </div>

            <div className="report-detail-head">
              <strong>{form.title || (editingId ? "보고 수정" : "새 보고")}</strong>
              <span>{labelOf(reportTypeLabels, form.report_type)}</span>
            </div>

            <div className="report-detail-meta">
              <label>
                <dt>보고 유형</dt>
                <dd>
                  <select onChange={(event) => setForm((current) => ({ ...current, report_type: event.target.value }))} value={form.report_type}>
                    <option value="WORK_REPORT">업무보고</option>
                    <option value="EXPENSE_REPORT">경비지출</option>
                  </select>
                </dd>
              </label>
              <label>
                <dt>보고일</dt>
                <dd>
                  <input onChange={(event) => setForm((current) => ({ ...current, report_date: event.target.value }))} required type="date" value={form.report_date} />
                </dd>
              </label>
              <label>
                <dt>첨부</dt>
                <dd>
                  <input onChange={(event) => setReportAttachment(event.target.files?.[0] ?? null)} type="file" />
                  {reportAttachment && (
                    <button className="text-button" onClick={() => setReportAttachment(null)} type="button">
                      선택 해제: {reportAttachment.name}
                    </button>
                  )}
                </dd>
              </label>
            </div>

            <section className="report-detail-section">
              <label className="assignee-search">
                <h3>수신자</h3>
                <div className="inline-entry">
                  <input
                    onChange={(event) => handleRecipientSearch(event.target.value)}
                    onKeyDown={handleManualRecipientKeyDown}
                    placeholder="이름, 이메일, 부서, 직함 검색 또는 직접 입력"
                    value={recipientSearch}
                  />
                  <button className="ghost-button" onClick={addManualRecipients} type="button">추가</button>
                </div>
                {!!recipientResults.length && (
                  <div className="assignee-dropdown">
                    {recipientResults.map((entry) => (
                      <button key={entry.id} onClick={() => selectRecipient(entry)} type="button">{userLabel(entry)}</button>
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
            </section>

            <section className="report-detail-section">
              <label>
                <h3>제목</h3>
                <input onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required value={form.title} />
              </label>
            </section>

            {form.report_type !== "EXPENSE_REPORT" && (
              <section className="report-detail-section">
                <label>
                  <h3>내용</h3>
                  <textarea onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} rows={7} value={form.content} />
                </label>
              </section>
            )}

            {form.report_type === "EXPENSE_REPORT" && (
              <section className="report-detail-section">
                <h3>경비 내역</h3>
                <div className="expense-item-editor">
                  <label className="expense-field date-field">
                    <span>사용일</span>
                    <input onChange={(event) => setExpenseItem((current) => ({ ...current, expense_date: event.target.value }))} type="date" value={expenseItem.expense_date} />
                  </label>
                  <label className="expense-field category-field">
                    <span>분류</span>
                    <select onChange={(event) => setExpenseItem((current) => ({ ...current, category: event.target.value }))} value={expenseItem.category}>
                      {Object.entries(expenseCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label className="expense-field place-field">
                    <span>지출처</span>
                    <input onChange={(event) => setExpenseItem((current) => ({ ...current, description: event.target.value }))} value={expenseItem.description} />
                  </label>
                  <label className="expense-field amount-field">
                    <span>금액</span>
                    <input min="0" onChange={(event) => setExpenseItem((current) => ({ ...current, amount: event.target.value }))} type="number" value={expenseItem.amount} />
                  </label>
                  <label className="expense-field method-field">
                    <span>결제수단</span>
                    <select onChange={(event) => setExpenseItem((current) => ({ ...current, payment_method: event.target.value }))} value={expenseItem.payment_method}>
                      {Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                </div>
              </section>
            )}

            {form.report_type === "EXPENSE_REPORT" && (
              <section className="report-detail-section">
                <label>
                  <h3>비고</h3>
                  <textarea
                    className="expense-note-input"
                    onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                    rows={1}
                    value={form.content}
                  />
                </label>
              </section>
            )}

            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "저장 중" : editingId ? "수정" : "등록"}
            </button>
          </form>
        </div>
      )}

      {isDetailLoading && (
        <div className="modal-backdrop">
          <div className="modal-panel report-detail-modal">
            <p className="report-detail-loading">보고서를 불러오는 중입니다.</p>
          </div>
        </div>
      )}

      {detailTarget && !isDetailLoading && (
        <div className="modal-backdrop">
          <div className="modal-panel report-detail-modal">
            <div className="panel-head">
              <h2>보고서 내용</h2>
              <button className="ghost-button" onClick={() => setDetailTarget(null)} type="button">
                닫기
              </button>
            </div>

            <div className="report-detail-head">
              <strong>{detailTarget.title}</strong>
              <span>{labelOf(reportStatusLabels, detailTarget.status)}</span>
            </div>

            <dl className="report-detail-meta">
              <div>
                <dt>유형</dt>
                <dd>{labelOf(reportTypeLabels, detailTarget.report_type)}</dd>
              </div>
              <div>
                <dt>보고일</dt>
                <dd>{formatDate(detailTarget.report_date)}</dd>
              </div>
              <div>
                <dt>제출시간</dt>
                <dd>{detailTarget.submitted_at ? formatDateTime(detailTarget.submitted_at) : "-"}</dd>
              </div>
              <div>
                <dt>작성자</dt>
                <dd>{detailTarget.writer_name || "-"}</dd>
              </div>
              <div>
                <dt>수신자</dt>
                <dd>{renderRecipientNames(detailTarget)}</dd>
              </div>
              {detailTarget.report_type === "EXPENSE_REPORT" && (
                <div>
                  <dt>총액</dt>
                  <dd>{formatMoney(detailTarget.total_amount)}</dd>
                </div>
              )}
            </dl>

            <section className="report-detail-section">
              <h3>내용</h3>
              <p className="report-detail-content">{detailTarget.content?.trim() || "작성된 내용이 없습니다."}</p>
            </section>

            <section className="report-detail-section">
              <h3>첨부</h3>
              {renderReportFiles(detailTarget.files) || <p className="report-detail-empty">첨부파일이 없습니다.</p>}
            </section>

            {detailTarget.report_type === "EXPENSE_REPORT" && (
              <section className="report-detail-section expense-summary-section">
                <div>
                  <h3>경비지출 항목</h3>
                  <p>{detailTarget.expense_items?.length ? `${detailTarget.expense_items.length}건 · ${formatMoney(detailTarget.total_amount)}` : "등록된 항목 없음"}</p>
                </div>
                <button className="ghost-button" onClick={() => setExpenseDetailTarget(detailTarget)} type="button">
                  경비지출 항목 보기
                </button>
              </section>
            )}

            <section className="report-detail-section">
              <h3>수신 상태</h3>
              {renderRecipientDetailStatuses(detailTarget)}
            </section>
          </div>
        </div>
      )}

      {expenseDetailTarget && (
        <div className="modal-backdrop nested-modal-backdrop">
          <div className="modal-panel report-detail-modal expense-items-modal">
            <div className="panel-head">
              <h2>경비지출 항목</h2>
              <button className="ghost-button" onClick={() => setExpenseDetailTarget(null)} type="button">
                닫기
              </button>
            </div>
            <div className="report-detail-head">
              <strong>{expenseDetailTarget.title}</strong>
              <span>{formatMoney(expenseDetailTarget.total_amount)}</span>
            </div>
            <dl className="report-detail-meta expense-item-summary">
              <div>
                <dt>보고일</dt>
                <dd>{formatDate(expenseDetailTarget.report_date)}</dd>
              </div>
              <div>
                <dt>상태</dt>
                <dd>{labelOf(reportStatusLabels, expenseDetailTarget.status)}</dd>
              </div>
              <div>
                <dt>항목</dt>
                <dd>{expenseDetailTarget.expense_items?.length ?? 0}건</dd>
              </div>
            </dl>
            <section className="report-detail-section">
              {renderExpenseItems(expenseDetailTarget)}
            </section>
          </div>
        </div>
      )}

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
