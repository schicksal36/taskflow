/**
 * api.ts
 * 역할: Next.js 프론트엔드에서 TaskFlow 백엔드 REST API 호출을 담당하는 공통 클라이언트
 * 주요 기능:
 *   - JWT Access Token을 Authorization 헤더에 포함
 *   - JSON 요청/응답 정규화
 *   - 파일 업로드/다운로드 처리
 *   - 업무요청, 일정, 업무보고, 경비지출, 게시판 API 함수 제공
 * 사용 API: /api/* 전체 백엔드 엔드포인트
 */
const DEFAULT_API_BASE_URL = "/api";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

type RequestOptions = {
  method?: HttpMethod;
  token?: string | null;
  body?: unknown;
};

type ListShape<T> = T[] | { results?: T[]; data?: T[] };

function normalizeApiBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export const API_BASE_URL = normalizeApiBaseUrl(
  process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
);

function joinApiPath(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function unwrapApiResponse<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}

export function toArray<T>(payload: ListShape<T> | null | undefined): T[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload.results)) {
    return payload.results;
  }

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  return [];
}

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, details: unknown) {
    super("API request failed");
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(joinApiPath(path), {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let parsed: unknown = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw new ApiError(response.status, parsed);
  }

  return unwrapApiResponse<T>(parsed);
}

export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options: { method?: "POST" | "PATCH"; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(joinApiPath(path), {
    method: options.method ?? "POST",
    headers,
    body: formData,
  });

  const text = await response.text();
  let parsed: unknown = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw new ApiError(response.status, parsed);
  }

  return unwrapApiResponse<T>(parsed);
}

export async function apiDownload(path: string, token: string, fallbackFilename: string) {
  const response = await fetch(joinApiPath(path), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  const filename = filenameMatch?.[1] ? decodeURIComponent(filenameMatch[1]) : fallbackFilename;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export function describeApiError(error: unknown) {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return "백엔드 서버에 연결할 수 없습니다. API 서버가 실행 중인지 확인해주세요.";
  }

  const details = error.details;

  if (typeof details === "string") {
    return details || `요청에 실패했습니다. (${error.status})`;
  }

  if (Array.isArray(details)) {
    return String(details[0]);
  }

  if (details && typeof details === "object") {
    const record = details as Record<string, unknown>;

    if (typeof record.detail === "string") {
      return record.detail;
    }

    if (typeof record.message === "string") {
      return record.message;
    }

    if (typeof record.error === "string") {
      return record.error;
    }

    const firstValue = Object.values(record)[0];
    if (Array.isArray(firstValue)) {
      return String(firstValue[0]);
    }
    if (typeof firstValue === "string") {
      return firstValue;
    }
  }

  return `요청에 실패했습니다. (${error.status})`;
}

export type ApiUser = {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  department?: string;
  position?: string;
  profile_image?: string | null;
  hire_date?: string | null;
  role?: string;
  is_email_verified?: boolean;
  is_active?: boolean;
  date_joined?: string;
};

export type UserListItem = ApiUser & {
  display_name?: string;
  department?: string;
  position?: string;
};

export type UserProfile = {
  bio?: string;
};

export type AdminApprovalRequest = {
  id: number;
  applicant?: number;
  applicant_name?: string;
  applicant_email?: string;
  applicant_department?: string;
  applicant_position?: string;
  reason: string;
  experience: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reject_reason?: string;
  created_at?: string;
  reviewed_at?: string | null;
};

export type AuthPayload = {
  access: string;
  refresh: string;
  user: ApiUser;
};

export type RefreshPayload = {
  access: string;
  refresh?: string;
};

export type WorkRequest = {
  id: number;
  title: string;
  content?: string;
  requester?: number;
  requester_name?: string;
  assignee?: number | null;
  assignee_name?: string | null;
  assignee_ids?: number[];
  assignee_names?: string[];
  read_records?: WorkRequestReadRecord[];
  has_read_assignee?: boolean;
  status: string;
  priority: string;
  deadline_at?: string | null;
  due_date?: string | null;
  reminder_date?: string | null;
  completed_at?: string | null;
  approved_at?: string | null;
  rejected_reason?: string;
  files?: WorkRequestFile[];
  created_at?: string;
  updated_at?: string;
};

export type WorkRequestReadRecord = {
  id: number;
  assignee: number;
  name?: string;
  department?: string;
  position?: string;
  is_read: boolean;
  read_at?: string | null;
};

export type WorkRequestInput = {
  title: string;
  content: string;
  assignee?: number | null;
  assignee_input?: string;
  assignee_ids?: number[];
  assignee_inputs?: string[];
  priority: string;
  deadline_at?: string | null;
  due_date?: string | null;
  reminder_date?: string | null;
};

export type WorkRequestFile = {
  id: number;
  work_request: number;
  media_file: number;
  original_name?: string;
  file_url?: string | null;
  file_type?: string;
  mime_type?: string;
  download_url?: string;
  uploaded_by?: number;
  created_at?: string;
};

export type Todo = {
  id: number;
  title: string;
  content?: string;
  status: string;
  priority: string;
  deadline_at?: string | null;
  remind_at?: string | null;
  completed_at?: string | null;
  item_count?: number;
  items?: TodoItem[];
  created_at?: string;
  updated_at?: string;
};

export type TodoItem = {
  id: number;
  todo: number;
  content: string;
  is_checked: boolean;
  checked_at?: string | null;
  sort_order: number;
};

export type TodoInput = {
  title: string;
  content?: string;
  status: string;
  priority: string;
  deadline_at?: string | null;
  remind_at?: string | null;
};

export type Schedule = {
  id: number;
  title: string;
  content?: string;
  owner?: number;
  owner_name?: string;
  owner_email?: string;
  owner_department?: string;
  owner_position?: string;
  schedule_type: string;
  start_at: string;
  end_at?: string | null;
  location?: string;
  is_shared?: boolean;
  remind_at?: string | null;
  color?: string;
  is_all_day?: boolean;
  repeat_type?: string;
  participant_count?: number;
  participants?: ScheduleParticipant[];
  created_at?: string;
  updated_at?: string;
};

export type ScheduleParticipant = {
  id: number;
  schedule: number;
  user: number;
  username?: string;
  email?: string;
  first_name?: string;
  display_name?: string;
  department?: string;
  position?: string;
  response?: string;
  created_at?: string;
};

export type ScheduleInput = {
  title: string;
  content?: string;
  schedule_type: string;
  start_at: string;
  end_at?: string | null;
  location?: string;
  is_shared?: boolean;
  remind_at?: string | null;
  color?: string;
  is_all_day?: boolean;
  repeat_type?: string;
  participant_ids?: number[];
};

export type GoogleCalendarSubscription = {
  feed_url: string;
  webcal_url: string;
  google_url: string;
};

export type Report = {
  id: number;
  writer?: number;
  writer_name?: string;
  writer_department?: string;
  writer_position?: string;
  approver?: number | null;
  approver_name?: string | null;
  recipient_ids?: number[];
  recipients?: ReportRecipient[];
  report_type: string;
  title: string;
  content?: string;
  status: string;
  report_date: string;
  total_amount?: string | number;
  expense_place?: string;
  is_viewed?: boolean;
  submitted_at?: string | null;
  viewed_at?: string | null;
  confirmed_at?: string | null;
  returned_at?: string | null;
  rejected_reason?: string;
  expense_items?: ExpenseItem[];
  files?: ReportFile[];
  created_at?: string;
  updated_at?: string;
};

export type ReportFile = {
  id: number;
  report: number;
  media_file: number;
  original_name?: string;
  file_url?: string | null;
  file_type?: string;
  mime_type?: string;
  download_url?: string;
  uploaded_by?: number;
  file_category?: string;
  created_at?: string;
};

export type ReportRecipient = {
  /**
   * 업무보고 수신자 상태 타입.
   * 백엔드 ReportRecipient 모델과 대응하며, 수신자별 읽음/확인완료/보완요청 상태를 표시합니다.
   */
  id: number;
  recipient: number; // 수신자 User ID
  name?: string; // 수신자 표시명
  department?: string; // 수신자 부서
  position?: string; // 수신자 직함
  is_read: boolean; // 최초 상세 조회 여부
  read_at?: string | null; // 최초 읽은 시각
  confirmed_at?: string | null; // 확인완료 시각
  returned_at?: string | null; // 보완요청 시각
  return_reason?: string; // 보완요청 사유
};

export type ReportInput = {
  approver?: number | null;
  recipient_ids?: number[];
  recipient_inputs?: string[];
  report_type: string;
  title: string;
  content?: string;
  report_date: string;
  total_amount?: string | number;
  expense_items?: ExpenseItemInput[];
};

export type ReportSummary = {
  unit: "year" | "month" | "day";
  date: string;
  total_count: number;
  submitted_count: number;
  confirmed_count: number;
  returned_count: number;
  canceled_count: number;
};

export type ExpenseSummary = {
  unit: "year" | "month" | "day";
  date: string;
  total_amount: string | number;
  total_count: number;
};

export type ExpenseItem = {
  id: number;
  report: number;
  expense_date: string;
  category: string;
  description: string;
  amount: string | number;
  payment_method: string;
  receipt_file?: number | null;
  created_at?: string;
};

export type ExpenseReceipt = {
  id: number;
  expense_item: number;
  media_file: number;
  uploaded_by?: number;
  created_at?: string;
};

export type ExpenseItemInput = {
  expense_date: string;
  category: string;
  description: string;
  amount: string | number;
  payment_method: string;
};

export type BoardPost = {
  id: number;
  author?: number;
  author_name?: string;
  author_email?: string;
  author_department?: string;
  author_position?: string;
  board_type: string;
  title: string;
  content?: string;
  is_notice?: boolean;
  is_pinned?: boolean;
  permission?: string;
  specific_user_ids?: number[];
  is_locked?: boolean;
  file_count?: number;
  files?: BoardFile[];
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type BoardPostInput = {
  board_type: string;
  title: string;
  content: string;
  is_notice?: boolean;
  is_pinned?: boolean;
  permission?: string;
  specific_user_ids?: number[];
};

export type BoardComment = {
  id: number;
  post: number;
  author?: number;
  author_name?: string;
  author_email?: string;
  author_department?: string;
  author_position?: string;
  parent?: number | null;
  content: string;
  files?: BoardCommentFile[];
  is_deleted?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type BoardCommentFile = {
  id: number;
  comment: number;
  media_file: number;
  original_name?: string;
  file_url?: string | null;
  file_type?: string;
  mime_type?: string;
  download_url?: string;
  uploaded_by?: number;
  created_at?: string;
};

export type BoardFile = {
  id: number;
  post: number;
  media_file: number;
  original_name?: string;
  file_url?: string | null;
  file_type?: string;
  mime_type?: string;
  download_url?: string;
  uploaded_by?: number;
  created_at?: string;
};

export type Notification = {
  id: number;
  notification_type: string;
  title: string;
  message: string;
  target_type?: string;
  target_id?: number | null;
  is_read: boolean;
  created_at?: string;
};

export type MediaFile = {
  id: number;
  original_name?: string;
  file?: string;
  file_url?: string;
  download_url?: string;
  size?: number;
  mime_type?: string;
  created_at?: string;
};

export function login(email: string, password: string) {
  return apiFetch<AuthPayload>("/auth/login/", {
    body: { email, identifier: email, password },
  });
}

export function logout(refresh: string) {
  return apiFetch<unknown>("/users/logout/", {
    body: { refresh },
  });
}

export function refreshAccessToken(refresh: string) {
  return apiFetch<RefreshPayload>("/auth/token/refresh/", {
    body: { refresh },
  });
}

export function register(input: {
  email: string;
  password: string;
  password_confirm: string;
  first_name?: string;
  department?: string;
  position?: string;
}) {
  return apiFetch<ApiUser>("/auth/register/", {
    body: input,
  });
}

export function fetchMe(token: string) {
  return apiFetch<ApiUser>("/profile/", { token });
}

export function updateMe(
  token: string,
  input: Pick<ApiUser, "email" | "first_name" | "department" | "position" | "hire_date">,
) {
  return apiFetch<ApiUser>("/profile/", {
    method: "PATCH",
    token,
    body: input,
  });
}

export function updateProfileImage(token: string, file: File) {
  const formData = new FormData();
  formData.append("profile_image", file);
  return apiUpload<ApiUser>("/users/me/profile/image/", formData, { method: "PATCH", token });
}

export function deleteMe(token: string) {
  return apiFetch<unknown>("/profile/", {
    method: "DELETE",
    token,
  });
}

export function fetchProfile(token: string) {
  return apiFetch<UserProfile>("/users/me/profile/", { token });
}

export function fetchUsers(token: string) {
  return apiFetch<ListShape<UserListItem>>("/users/", { token });
}

export function searchUsers(token: string, q: string) {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<ListShape<UserListItem>>(`/users/search/${query}`, { token });
}

export function fetchAdminUsers(token: string) {
  return apiFetch<ListShape<UserListItem>>("/admin/users/", { token });
}

export function promoteAdminUser(token: string, id: number) {
  return apiFetch<ApiUser>(`/admin/users/${id}/promote/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function updateProfile(token: string, input: UserProfile) {
  return apiFetch<UserProfile>("/users/me/profile/", {
    method: "PATCH",
    token,
    body: input,
  });
}

export function fetchMyAdminApprovalRequest(token: string) {
  return apiFetch<AdminApprovalRequest>("/users/admin/approval-requests/my/", { token });
}

export function createAdminApprovalRequest(token: string, input: { reason: string; experience: string }) {
  return apiFetch<AdminApprovalRequest>("/users/admin/approval-requests/", {
    token,
    body: input,
  });
}

export function fetchAdminApprovalRequests(token: string) {
  return apiFetch<ListShape<AdminApprovalRequest>>("/admin/approval-requests/", { token });
}

export function approveAdminApprovalRequest(token: string, id: number) {
  return apiFetch<AdminApprovalRequest>(`/admin/approval-requests/${id}/approve/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function rejectAdminApprovalRequest(token: string, id: number, reject_reason: string) {
  return apiFetch<AdminApprovalRequest>(`/admin/approval-requests/${id}/reject/`, {
    method: "PATCH",
    token,
    body: { reject_reason },
  });
}

export function requestPasswordReset(email: string) {
  return apiFetch<unknown>("/users/password/reset/", {
    body: { email },
  });
}

export function confirmPasswordReset(input: { email: string; code: string; new_password: string }) {
  return apiFetch<unknown>("/users/password/reset/confirm/", {
    body: input,
  });
}

export function changePassword(token: string, input: { old_password?: string; current_password?: string; new_password: string; new_password_confirm?: string }) {
  return apiFetch<unknown>("/profile/change-password/", {
    method: "PATCH",
    token,
    body: input,
  });
}

export function fetchWorkRequests(token: string) {
  return apiFetch<ListShape<WorkRequest>>("/work-requests/", { token });
}

export function fetchWorkRequest(token: string, id: number) {
  return apiFetch<WorkRequest>(`/work-requests/${id}/`, { token });
}

export function fetchInProgressWorkRequests(token: string) {
  return apiFetch<ListShape<WorkRequest>>("/work-requests/in-progress/", { token });
}

export function fetchAssignedWorkRequests(token: string) {
  return apiFetch<ListShape<WorkRequest>>("/work-requests/assigned/me/", { token });
}

export function createWorkRequest(token: string, input: WorkRequestInput) {
  return apiFetch<WorkRequest>("/work-requests/", {
    token,
    body: input,
  });
}

export function updateWorkRequest(token: string, id: number, input: WorkRequestInput) {
  return apiFetch<WorkRequest>(`/work-requests/${id}/`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteWorkRequest(token: string, id: number) {
  return apiFetch<unknown>(`/work-requests/${id}/`, {
    method: "DELETE",
    token,
  });
}

export function attachWorkRequestFile(token: string, workRequestId: number, mediaFileId: number) {
  return apiFetch<WorkRequestFile>(`/work-requests/${workRequestId}/attachments/`, {
    token,
    body: { media_file: mediaFileId },
  });
}

export function downloadWorkRequestFile(token: string, workRequestId: number, fileId: number, filename?: string) {
  return apiDownload(
    `/work-requests/${workRequestId}/attachments/${fileId}/download/`,
    token,
    filename || "attachment",
  );
}

export function downloadAllWorkRequestFiles(token: string, workRequestId: number) {
  return apiDownload(
    `/work-requests/${workRequestId}/attachments/download-all/`,
    token,
    `work-request-${workRequestId}-attachments.zip`,
  );
}

export function patchWorkRequestStatus(token: string, id: number, status: string) {
  return apiFetch<WorkRequest>(`/work-requests/${id}/status/`, {
    method: "PATCH",
    token,
    body: { status },
  });
}

export function acceptWorkRequest(token: string, id: number) {
  return apiFetch<WorkRequest>(`/work-requests/${id}/accept/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function completeWorkRequest(token: string, id: number) {
  return apiFetch<WorkRequest>(`/work-requests/${id}/complete/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function cancelWorkRequest(token: string, id: number) {
  return apiFetch<WorkRequest>(`/work-requests/${id}/cancel/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function rejectWorkRequest(token: string, id: number, rejected_reason = "") {
  return apiFetch<WorkRequest>(`/work-requests/${id}/reject/`, {
    method: "PATCH",
    token,
    body: { rejected_reason },
  });
}

export function fetchTodos(token: string) {
  return apiFetch<ListShape<Todo>>("/todos/", { token });
}

export function fetchTodo(token: string, id: number) {
  return apiFetch<Todo>(`/todos/${id}/`, { token });
}

export function fetchTodayTodos(token: string) {
  return apiFetch<ListShape<Todo>>("/todos/today/", { token });
}

export function createTodo(token: string, input: TodoInput) {
  return apiFetch<Todo>("/todos/", {
    token,
    body: input,
  });
}

export function updateTodo(token: string, id: number, input: TodoInput) {
  return apiFetch<Todo>(`/todos/${id}/`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteTodo(token: string, id: number) {
  return apiFetch<unknown>(`/todos/${id}/`, {
    method: "DELETE",
    token,
  });
}

export function completeTodo(token: string, id: number) {
  return apiFetch<Todo>(`/todos/${id}/complete/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function updateTodoStatus(token: string, id: number, status: string) {
  return apiFetch<Todo>(`/todos/${id}/status/`, {
    method: "PATCH",
    token,
    body: { status },
  });
}

export function createTodoItem(token: string, todoId: number, input: Pick<TodoItem, "content" | "sort_order">) {
  return apiFetch<TodoItem>(`/todos/${todoId}/items/`, {
    token,
    body: input,
  });
}

export function checkTodoItem(token: string, itemId: number) {
  return apiFetch<TodoItem>(`/todos/items/${itemId}/check/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function uncheckTodoItem(token: string, itemId: number) {
  return apiFetch<TodoItem>(`/todos/items/${itemId}/uncheck/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function fetchSchedules(token: string) {
  return apiFetch<ListShape<Schedule>>("/schedules/", { token });
}

export function fetchSchedule(token: string, id: number) {
  return apiFetch<Schedule>(`/schedules/${id}/`, { token });
}

export function fetchTodaySchedules(token: string) {
  return apiFetch<ListShape<Schedule>>("/schedules/today/", { token });
}

export function fetchGoogleCalendarSubscription(token: string) {
  /**
   * Google Calendar 구독 URL 조회.
   *
   * API: GET /api/schedules/google-calendar-subscription/
   * 성공: Google Calendar에 등록할 feed_url/webcal_url/google_url 반환
   * 실패: 인증 만료 또는 서버 오류를 ApiError로 전달
   */
  return apiFetch<GoogleCalendarSubscription>("/schedules/google-calendar-subscription/", { token });
}

export function createSchedule(token: string, input: ScheduleInput) {
  return apiFetch<Schedule>("/schedules/", {
    token,
    body: input,
  });
}

export function updateSchedule(token: string, id: number, input: ScheduleInput) {
  return apiFetch<Schedule>(`/schedules/${id}/`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteSchedule(token: string, id: number) {
  return apiFetch<unknown>(`/schedules/${id}/`, {
    method: "DELETE",
    token,
  });
}

export function fetchReports(
  token: string,
  search?: string,
  filters?: { status?: string; report_type?: string; writer?: string; department?: string },
) {
  /**
   * 업무보고 목록 조회.
   *
   * API: GET /api/reports/
   * 성공: 보고서 목록 또는 페이지네이션 결과 반환
   * 실패: ApiError를 throw하여 화면에서 describeApiError로 메시지 변환
   */
  const params = new URLSearchParams();
  if (search) {
    params.set("search", search);
  }
  if (filters?.status) {
    params.set("status", filters.status);
  }
  if (filters?.report_type) {
    params.set("report_type", filters.report_type);
  }
  if (filters?.writer) {
    params.set("writer", filters.writer);
  }
  if (filters?.department) {
    params.set("department", filters.department);
  }
  const query = params.toString();
  const path = query ? `/reports/?${query}` : "/reports/";
  return apiFetch<ListShape<Report>>(path, { token });
}

export function fetchReport(token: string, id: number) {
  return apiFetch<Report>(`/reports/${id}/`, { token });
}

export function fetchReportSummary(token: string, unit: ReportSummary["unit"], startDate: string, endDate: string) {
  const params = new URLSearchParams({
    unit,
    start_date: startDate,
    end_date: endDate,
  });
  return apiFetch<ReportSummary>(`/reports/summary/?${params.toString()}`, { token });
}

export function fetchWorkReports(token: string, search?: string) {
  const path = search ? `/reports/work/?search=${encodeURIComponent(search)}` : "/reports/work/";
  return apiFetch<ListShape<Report>>(path, { token });
}

export function fetchExpenseReports(
  token: string,
  search?: string,
  filters?: { startDate?: string; endDate?: string; status?: string },
) {
  const params = new URLSearchParams();
  if (search) {
    params.set("search", search);
  }
  if (filters?.startDate) {
    params.set("start_date", filters.startDate);
  }
  if (filters?.endDate) {
    params.set("end_date", filters.endDate);
  }
  if (filters?.status) {
    params.set("status", filters.status);
  }
  const query = params.toString();
  const path = query ? `/reports/expenses/?${query}` : "/reports/expenses/";
  return apiFetch<ListShape<Report>>(path, { token });
}

export function fetchExpenseSummary(token: string, unit: ExpenseSummary["unit"], date: string) {
  return apiFetch<ExpenseSummary>(`/reports/expenses/summary/?unit=${unit}&date=${date}`, { token });
}

export type ExpenseWorkflowStatus = "APPROVED" | "REJECTED" | "SETTLING" | "SETTLED";

export function bulkUpdateExpenseStatus(token: string, ids: number[], status: ExpenseWorkflowStatus, reason = "") {
  return apiFetch<{ updated_count: number }>("/reports/expenses/bulk-status/", {
    method: "PATCH",
    token,
    body: { ids, status, reason },
  });
}

export function reviewExpenseReport(token: string, id: number) {
  return apiFetch<Report>(`/reports/${id}/expenses/review/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function approveExpenseReport(token: string, id: number) {
  return apiFetch<Report>(`/reports/${id}/expenses/approve/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function rejectExpenseReport(token: string, id: number, reason: string) {
  return apiFetch<Report>(`/reports/${id}/expenses/reject/`, {
    method: "PATCH",
    token,
    body: { reason },
  });
}

export function settleExpenseReport(token: string, id: number) {
  return apiFetch<Report>(`/reports/${id}/expenses/settle/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function completeExpenseSettlement(token: string, id: number) {
  return apiFetch<Report>(`/reports/${id}/expenses/settled/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function createReport(token: string, input: ReportInput) {
  return apiFetch<Report>("/reports/", {
    token,
    body: input,
  });
}

export function updateReport(token: string, id: number, input: ReportInput) {
  return apiFetch<Report>(`/reports/${id}/`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function attachReportFile(token: string, reportId: number, mediaFileId: number) {
  return apiFetch<ReportFile>(`/reports/${reportId}/files/`, {
    token,
    body: { media_file: mediaFileId },
  });
}

export function downloadReportFile(token: string, fileId: number, filename?: string) {
  return apiDownload(`/reports/files/${fileId}/download/`, token, filename || "report-attachment");
}

export function downloadAllReportFiles(token: string, reportId: number) {
  return apiDownload(`/reports/${reportId}/files/download-all/`, token, `report-${reportId}-attachments.zip`);
}

export function deleteReport(token: string, id: number) {
  return apiFetch<unknown>(`/reports/${id}/`, {
    method: "DELETE",
    token,
  });
}

export function submitReport(token: string, id: number) {
  /**
   * 업무보고 제출.
   *
   * API: PATCH /api/reports/{id}/submit/
   * 성공: status=SUBMITTED인 보고서 반환
   * 실패: 권한 없음/상태 오류를 ApiError로 전달
   */
  return apiFetch<Report>(`/reports/${id}/submit/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function cancelReport(token: string, id: number) {
  /**
   * 업무보고/경비보고 취소.
   *
   * API: PATCH /api/reports/{id}/cancel/
   * 성공: 수신자가 읽기 전 제출 보고서를 CANCELED 상태로 변경
   * 실패: 작성자가 아니거나 이미 수신자가 읽은 경우 ApiError 전달
   */
  return apiFetch<Report>(`/reports/${id}/cancel/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function confirmReport(token: string, id: number) {
  /**
   * 업무보고 확인완료.
   *
   * API: POST /api/reports/{id}/confirm/
   * 성공: 수신자 confirmed_at 저장 후 보고서 반환
   * 실패: 수신자가 아니거나 작성자 본인인 경우 ApiError 전달
   */
  return apiFetch<Report>(`/reports/${id}/confirm/`, {
    token,
    body: {},
  });
}

export function returnReport(token: string, id: number, reason: string) {
  /**
   * 업무보고 보완요청.
   *
   * API: POST /api/reports/{id}/return/
   * 성공: 수신자 returned_at/return_reason 저장 후 status=RETURNED 보고서 반환
   * 실패: reason 누락/권한 없음/경비지출 API 혼동 시 ApiError 전달
   */
  return apiFetch<Report>(`/reports/${id}/return/`, {
    token,
    body: { reason },
  });
}

export function resubmitReport(token: string, id: number) {
  /**
   * 업무보고 재제출.
   *
   * API: POST /api/reports/{id}/resubmit/
   * 성공: 수신자 읽음/확인/보완요청 상태 초기화 후 status=SUBMITTED 보고서 반환
   * 실패: RETURNED 상태가 아니거나 작성자가 아닌 경우 ApiError 전달
   */
  return apiFetch<Report>(`/reports/${id}/resubmit/`, {
    token,
    body: {},
  });
}

export function fetchExpenseItems(token: string, reportId: number) {
  return apiFetch<ListShape<ExpenseItem>>(`/reports/${reportId}/expenses/items/`, { token });
}

export function createExpenseItem(token: string, reportId: number, input: ExpenseItemInput) {
  return apiFetch<ExpenseItem>(`/reports/${reportId}/expenses/items/`, {
    token,
    body: input,
  });
}

export function updateExpenseItem(token: string, id: number, input: ExpenseItemInput) {
  return apiFetch<ExpenseItem>(`/reports/expenses/items/${id}/`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteExpenseItem(token: string, id: number) {
  return apiFetch<unknown>(`/reports/expenses/items/${id}/`, {
    method: "DELETE",
    token,
  });
}

export function createExpenseReceipt(token: string, itemId: number, mediaFileId: number) {
  return apiFetch<ExpenseReceipt>(`/reports/expenses/items/${itemId}/receipts/`, {
    token,
    body: { media_file: mediaFileId },
  });
}

export function fetchBoardPosts(token: string, boardType?: string, search?: string) {
  const params = new URLSearchParams();
  if (boardType) {
    params.set("board_type", boardType);
  }
  if (search) {
    params.set("search", search);
  }
  const query = params.toString();
  const path = query ? `/boards/posts/?${query}` : "/boards/posts/";
  return apiFetch<ListShape<BoardPost>>(path, { token });
}

export function fetchBoardNotices(token: string) {
  return apiFetch<ListShape<BoardPost>>("/boards/notices/", { token });
}

export function fetchBoardPost(token: string, id: number) {
  return apiFetch<BoardPost>(`/boards/posts/${id}/`, { token });
}

export function createBoardPost(token: string, input: BoardPostInput) {
  return apiFetch<BoardPost>("/boards/posts/", {
    token,
    body: input,
  });
}

export function updateBoardPost(token: string, id: number, input: BoardPostInput) {
  return apiFetch<BoardPost>(`/boards/posts/${id}/`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteBoardPost(token: string, id: number) {
  return apiFetch<unknown>(`/boards/posts/${id}/`, {
    method: "DELETE",
    token,
  });
}

export function attachBoardFile(token: string, postId: number, mediaFileId: number) {
  return apiFetch<BoardFile>(`/boards/posts/${postId}/attachments/`, {
    token,
    body: { media_file: mediaFileId },
  });
}

export function downloadBoardFile(token: string, fileId: number, filename?: string) {
  return apiDownload(`/boards/files/${fileId}/download/`, token, filename || "board-attachment");
}

export function downloadAllBoardFiles(token: string, postId: number) {
  return apiDownload(`/boards/posts/${postId}/attachments/download-all/`, token, `board-${postId}-attachments.zip`);
}

export function fetchBoardComments(token: string, postId: number) {
  return apiFetch<ListShape<BoardComment>>(`/boards/posts/${postId}/comments/`, { token });
}

export function createBoardComment(token: string, postId: number, content: string) {
  return apiFetch<BoardComment>(`/boards/posts/${postId}/comments/`, {
    token,
    body: { content },
  });
}

export function updateBoardComment(token: string, commentId: number, content: string) {
  return apiFetch<BoardComment>(`/boards/comments/${commentId}/`, {
    method: "PATCH",
    token,
    body: { content },
  });
}

export function deleteBoardComment(token: string, commentId: number) {
  return apiFetch<unknown>(`/boards/comments/${commentId}/`, {
    method: "DELETE",
    token,
  });
}

export function attachBoardCommentFile(token: string, commentId: number, mediaFileId: number) {
  return apiFetch<BoardCommentFile>(`/boards/comments/${commentId}/files/`, {
    token,
    body: { media_file: mediaFileId },
  });
}

export function downloadBoardCommentFile(token: string, fileId: number, filename?: string) {
  return apiDownload(`/boards/comment-files/${fileId}/download/`, token, filename || "comment-image");
}

export function updateBoardPermission(token: string, postId: number, permission: string, specificUserIds: number[]) {
  return apiFetch<BoardPost>(`/boards/posts/${postId}/permissions/`, {
    method: "PATCH",
    token,
    body: { permission, specific_user_ids: specificUserIds },
  });
}

export function fetchNotifications(token: string) {
  return apiFetch<ListShape<Notification>>("/notifications/", { token });
}

export function fetchUnreadNotifications(token: string) {
  return apiFetch<ListShape<Notification>>("/notifications/unread/", { token });
}

export function fetchNotificationCount(token: string) {
  return apiFetch<{ unread_count: number }>("/notifications/count/", { token });
}

export function markNotificationRead(token: string, id: number) {
  return apiFetch<Notification>(`/notifications/${id}/read/`, {
    method: "PATCH",
    token,
    body: {},
  });
}

export function markAllNotificationsRead(token: string) {
  return apiFetch<unknown>("/notifications/read-all/", {
    method: "PATCH",
    token,
    body: {},
  });
}

export function deleteAllNotifications(token: string) {
  return apiFetch<unknown>("/notifications/delete-all/", {
    method: "DELETE",
    token,
  });
}

export function deleteNotification(token: string, id: number) {
  return apiFetch<unknown>(`/notifications/${id}/`, {
    method: "DELETE",
    token,
  });
}

export function uploadMediaFile(
  token: string,
  file: File,
  target?: { target_app?: string; target_id?: number | null },
) {
  const formData = new FormData();
  formData.append("file", file);
  if (target?.target_app) {
    formData.append("target_app", target.target_app);
  }
  if (target?.target_id) {
    formData.append("target_id", String(target.target_id));
  }
  return apiUpload<MediaFile>("/media/files/", formData, { token });
}
