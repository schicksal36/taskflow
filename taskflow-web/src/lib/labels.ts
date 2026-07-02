export const priorityLabels: Record<string, string> = {
  LOW: "낮음",
  NORMAL: "보통",
  HIGH: "높음",
  URGENT: "긴급",
};

export const workStatusLabels: Record<string, string> = {
  PENDING: "대기",
  ACCEPTED: "수락",
  REQUESTED: "요청됨",
  ASSIGNED: "배정됨",
  IN_PROGRESS: "진행중",
  ON_HOLD: "보류",
  COMPLETED: "완료",
  APPROVED: "승인완료",
  REJECTED: "반려",
  CANCELED: "취소",
};

export const todoStatusLabels: Record<string, string> = {
  TODO: "할 일",
  DOING: "진행중",
  DONE: "완료",
  CANCELED: "취소",
};

export const scheduleTypeLabels: Record<string, string> = {
  WORK: "업무",
  MEETING: "회의",
  TODO: "할 일",
  WORK_REQUEST: "업무요청",
};

export const reportTypeLabels: Record<string, string> = {
  DAILY_REPORT: "업무보고",
  WORK_REPORT: "업무보고",
  WEEKLY_REPORT: "주간보고",
  MONTHLY_REPORT: "월간보고",
  EXPENSE_REPORT: "경비지출",
};

export const reportStatusLabels: Record<string, string> = {
  DRAFT: "임시저장",
  SUBMITTED: "제출",
  CONFIRMED: "확인완료",
  RETURNED: "보완요청",
  REVIEWING: "정산중",
  APPROVED: "승인",
  REJECTED: "반려",
  SETTLING: "정산중",
  SETTLED: "정산완료",
  CANCELED: "취소",
};

export const boardTypeLabels: Record<string, string> = {
  NOTICE: "공지사항",
  FREE: "자유게시판",
  DATA_ROOM: "자료실",
};

export const expenseCategoryLabels: Record<string, string> = {
  MEAL: "식비",
  TRANSPORT: "교통",
  SUPPLIES: "비품",
  ACCOMMODATION: "숙박",
  FUEL: "유류",
  ETC: "기타",
};

export const paymentMethodLabels: Record<string, string> = {
  CARD: "카드",
  CASH: "현금",
  TRANSFER: "계좌이체",
  COMPANY_CARD: "법인카드",
  ETC: "기타",
};

export function labelOf(labels: Record<string, string>, value?: string | null) {
  if (!value) {
    return "-";
  }

  return labels[value] ?? value;
}
