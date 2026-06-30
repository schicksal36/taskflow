from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from .models import ExpenseItem, Report, ReportRecipient


class ReportApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.writer = User.objects.create_user("writer", "writer@example.com", "StrongPass123!")
        self.approver = User.objects.create_user("approver", "approver@example.com", "StrongPass123!")

    def test_submit_and_confirm_work_report(self):
        self.client.force_authenticate(self.writer)
        create_response = self.client.post(
            "/api/reports/",
            {
                "approver": self.approver.id,
                "report_type": "WORK_REPORT",
                "title": "업무보고",
                "content": "오늘 처리한 업무입니다.",
                "report_date": timezone.localdate().isoformat(),
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        report = Report.objects.get(title="업무보고")

        submit_response = self.client.patch(f"/api/reports/{report.id}/submit/", {}, format="json")
        self.assertEqual(submit_response.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, Report.ReportStatus.SUBMITTED)

        self.client.force_authenticate(self.approver)
        confirm_response = self.client.patch(f"/api/reports/{report.id}/confirm/", {}, format="json")
        self.assertEqual(confirm_response.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, Report.ReportStatus.CONFIRMED)

    def test_report_recipient_read_confirm_and_resubmit_flow(self):
        self.writer.first_name = "김정훈"
        self.writer.department = "개발팀"
        self.writer.position = "과장"
        self.writer.save(update_fields=["first_name", "department", "position"])
        self.approver.first_name = "부평맛남"
        self.approver.save(update_fields=["first_name"])
        self.client.force_authenticate(self.writer)
        create_response = self.client.post(
            "/api/reports/",
            {
                "recipient_ids": [self.approver.id],
                "report_type": "WORK_REPORT",
                "title": "수신자 업무보고",
                "content": "읽음 확인 대상입니다.",
                "report_date": timezone.localdate().isoformat(),
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        report = Report.objects.get(title="수신자 업무보고")
        self.assertTrue(ReportRecipient.objects.filter(report=report, recipient=self.approver).exists())

        submit_response = self.client.post(f"/api/reports/{report.id}/submit/", {}, format="json")
        self.assertEqual(submit_response.status_code, status.HTTP_200_OK)
        self.assertEqual(submit_response.data["data"]["recipients"][0]["name"], "부평맛남")
        self.assertNotIn("None", submit_response.data["data"]["recipients"][0]["name"])

        self.client.force_authenticate(self.approver)
        detail_response = self.client.get(f"/api/reports/{report.id}/")
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data["data"]["writer_name"], "김정훈 (개발팀 / 과장)")
        recipient_record = ReportRecipient.objects.get(report=report, recipient=self.approver)
        first_read_at = recipient_record.read_at
        self.assertTrue(recipient_record.is_read)

        self.client.get(f"/api/reports/{report.id}/")
        recipient_record.refresh_from_db()
        self.assertEqual(recipient_record.read_at, first_read_at)

        return_response = self.client.post(f"/api/reports/{report.id}/return/", {"reason": "내용 보완"}, format="json")
        self.assertEqual(return_response.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, Report.ReportStatus.RETURNED)

        self.client.force_authenticate(self.writer)
        resubmit_response = self.client.post(f"/api/reports/{report.id}/resubmit/", {}, format="json")
        self.assertEqual(resubmit_response.status_code, status.HTTP_200_OK)
        recipient_record.refresh_from_db()
        self.assertFalse(recipient_record.is_read)
        self.assertIsNone(recipient_record.read_at)
        self.assertEqual(recipient_record.return_reason, "")

    def test_create_work_report_accepts_manual_recipient_inputs(self):
        self.client.force_authenticate(self.writer)
        create_response = self.client.post(
            "/api/reports/",
            {
                "recipient_inputs": [self.approver.email],
                "report_type": "WORK_REPORT",
                "title": "수기 수신자 업무보고",
                "content": "수신자를 직접 입력합니다.",
                "report_date": timezone.localdate().isoformat(),
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        report = Report.objects.get(title="수기 수신자 업무보고")
        self.assertTrue(ReportRecipient.objects.filter(report=report, recipient=self.approver).exists())
        self.assertEqual(report.approver, self.approver)

    def test_create_report_with_approver_only_creates_recipient_record(self):
        self.client.force_authenticate(self.writer)
        create_response = self.client.post(
            "/api/reports/",
            {
                "approver": self.approver.id,
                "report_type": "EXPENSE_REPORT",
                "title": "확인자만 있는 경비보고",
                "content": "확인자를 수신자로 기록합니다.",
                "report_date": timezone.localdate().isoformat(),
                "expense_items": [
                    {
                        "expense_date": timezone.localdate().isoformat(),
                        "category": "MEAL",
                        "description": "점심",
                        "amount": "15000",
                        "payment_method": "CARD",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        report = Report.objects.get(title="확인자만 있는 경비보고")
        self.assertTrue(report.recipients.filter(pk=self.approver.pk).exists())
        self.assertTrue(ReportRecipient.objects.filter(report=report, recipient=self.approver).exists())

    def test_detail_repairs_missing_approver_recipient_record(self):
        report = Report.objects.create(
            writer=self.writer,
            approver=self.approver,
            report_type=Report.ReportType.EXPENSE_REPORT,
            title="누락 수신자 복구",
            content="과거 데이터 보정",
            report_date=timezone.localdate(),
            status=Report.ExpenseStatus.SUBMITTED,
        )

        self.client.force_authenticate(self.approver)
        detail_response = self.client.get(f"/api/reports/{report.id}/")

        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertTrue(ReportRecipient.objects.filter(report=report, recipient=self.approver).exists())
        self.assertEqual(detail_response.data["data"]["recipients"][0]["recipient"], self.approver.id)

    def test_ceo_cannot_create_work_report(self):
        User = get_user_model()
        ceo = User.objects.create_user(
            "ceo",
            "ceo@example.com",
            "StrongPass123!",
            role=User.UserRole.CEO,
        )

        self.client.force_authenticate(ceo)
        create_response = self.client.post(
            "/api/reports/",
            {
                "recipient_ids": [self.approver.id],
                "report_type": "WORK_REPORT",
                "title": "대표이사 작성 차단",
                "content": "대표이사는 수신만 가능합니다.",
                "report_date": timezone.localdate().isoformat(),
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Report.objects.filter(title="대표이사 작성 차단").exists())

    def test_report_cannot_be_sent_to_self(self):
        self.client.force_authenticate(self.writer)
        create_response = self.client.post(
            "/api/reports/",
            {
                "recipient_ids": [self.writer.id],
                "report_type": "WORK_REPORT",
                "title": "셀프 보고 차단",
                "content": "자기 자신에게 보고할 수 없습니다.",
                "report_date": timezone.localdate().isoformat(),
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Report.objects.filter(title="셀프 보고 차단").exists())

    def test_submitted_report_can_be_updated_until_recipient_reads(self):
        self.client.force_authenticate(self.writer)
        create_response = self.client.post(
            "/api/reports/",
            {
                "recipient_ids": [self.approver.id],
                "report_type": "WORK_REPORT",
                "title": "미열람 수정 대상",
                "content": "수정 전",
                "report_date": timezone.localdate().isoformat(),
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        report = Report.objects.get(title="미열람 수정 대상")

        submit_response = self.client.patch(f"/api/reports/{report.id}/submit/", {}, format="json")
        self.assertEqual(submit_response.status_code, status.HTTP_200_OK)

        update_response = self.client.patch(
            f"/api/reports/{report.id}/",
            {"title": "미열람 수정 완료", "content": "수정 후"},
            format="json",
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.title, "미열람 수정 완료")

        self.client.force_authenticate(self.approver)
        detail_response = self.client.get(f"/api/reports/{report.id}/")
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(self.writer)
        blocked_response = self.client.patch(
            f"/api/reports/{report.id}/",
            {"title": "읽은 뒤 수정 시도"},
            format="json",
        )
        self.assertEqual(blocked_response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_submitted_report_can_be_canceled_until_recipient_reads(self):
        self.client.force_authenticate(self.writer)
        create_response = self.client.post(
            "/api/reports/",
            {
                "recipient_ids": [self.approver.id],
                "report_type": "WORK_REPORT",
                "title": "미열람 취소 대상",
                "content": "취소 전",
                "report_date": timezone.localdate().isoformat(),
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        report = Report.objects.get(title="미열람 취소 대상")

        submit_response = self.client.patch(f"/api/reports/{report.id}/submit/", {}, format="json")
        self.assertEqual(submit_response.status_code, status.HTTP_200_OK)

        cancel_response = self.client.patch(f"/api/reports/{report.id}/cancel/", {}, format="json")
        self.assertEqual(cancel_response.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, Report.ReportStatus.CANCELED)

        report.status = Report.ReportStatus.SUBMITTED
        report.save(update_fields=["status"])
        self.client.force_authenticate(self.approver)
        detail_response = self.client.get(f"/api/reports/{report.id}/")
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(self.writer)
        blocked_response = self.client.patch(f"/api/reports/{report.id}/cancel/", {}, format="json")
        self.assertEqual(blocked_response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_expense_report_item_and_approve(self):
        self.client.force_authenticate(self.writer)
        report = Report.objects.create(
            writer=self.writer,
            approver=self.approver,
            report_type=Report.ReportType.EXPENSE_REPORT,
            title="경비지출",
            content="외근 경비",
            report_date=timezone.localdate(),
            status=Report.ExpenseStatus.SUBMITTED,
        )

        item_response = self.client.post(
            f"/api/reports/{report.id}/expenses/items/",
            {
                "expense_date": timezone.localdate().isoformat(),
                "category": "TRANSPORT",
                "description": "택시비",
                "amount": "15000.00",
                "payment_method": "CARD",
            },
            format="json",
        )
        self.assertEqual(item_response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(ExpenseItem.objects.filter(report=report).exists())

        self.client.force_authenticate(self.approver)
        approve_response = self.client.patch(f"/api/reports/{report.id}/expenses/approve/", {}, format="json")
        self.assertEqual(approve_response.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, Report.ExpenseStatus.APPROVED)

        settle_response = self.client.patch(f"/api/reports/{report.id}/expenses/settle/", {}, format="json")
        self.assertEqual(settle_response.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, Report.ExpenseStatus.SETTLING)

        settled_response = self.client.patch(f"/api/reports/{report.id}/expenses/settled/", {}, format="json")
        self.assertEqual(settled_response.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, Report.ExpenseStatus.SETTLED)

    def test_approver_can_bulk_update_expense_status(self):
        reports = [
            Report.objects.create(
                writer=self.writer,
                approver=self.approver,
                report_type=Report.ReportType.EXPENSE_REPORT,
                title=f"경비지출 {index}",
                content="외근 경비",
                report_date=timezone.localdate(),
                status=Report.ExpenseStatus.SUBMITTED,
            )
            for index in range(2)
        ]

        self.client.force_authenticate(self.approver)
        approve_response = self.client.patch(
            "/api/reports/expenses/bulk-status/",
            {"ids": [report.id for report in reports], "status": "APPROVED"},
            format="json",
        )
        self.assertEqual(approve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(approve_response.data["data"]["updated_count"], 2)
        self.assertEqual(set(Report.objects.filter(id__in=[report.id for report in reports]).values_list("status", flat=True)), {Report.ExpenseStatus.APPROVED})

        settle_response = self.client.patch(
            "/api/reports/expenses/bulk-status/",
            {"ids": [report.id for report in reports], "status": "SETTLING"},
            format="json",
        )
        self.assertEqual(settle_response.status_code, status.HTTP_200_OK)
        self.assertEqual(set(Report.objects.filter(id__in=[report.id for report in reports]).values_list("status", flat=True)), {Report.ExpenseStatus.SETTLING})

    def test_report_summary_accepts_start_and_end_date(self):
        self.client.force_authenticate(self.writer)
        today = timezone.localdate()
        Report.objects.create(
            writer=self.writer,
            report_type=Report.ReportType.WORK_REPORT,
            title="범위 안 제출",
            report_date=today,
            status=Report.ReportStatus.SUBMITTED,
        )
        Report.objects.create(
            writer=self.writer,
            report_type=Report.ReportType.WORK_REPORT,
            title="범위 안 확인",
            report_date=today + timezone.timedelta(days=1),
            status=Report.ReportStatus.CONFIRMED,
        )
        Report.objects.create(
            writer=self.writer,
            report_type=Report.ReportType.WORK_REPORT,
            title="범위 밖 제출",
            report_date=today + timezone.timedelta(days=3),
            status=Report.ReportStatus.SUBMITTED,
        )

        response = self.client.get(
            "/api/reports/summary/",
            {
                "start_date": today.isoformat(),
                "end_date": (today + timezone.timedelta(days=1)).isoformat(),
            },
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data["data"]
        self.assertEqual(data["date"], f"{today.isoformat()} ~ {(today + timezone.timedelta(days=1)).isoformat()}")
        self.assertEqual(data["total_count"], 2)
        self.assertEqual(data["submitted_count"], 1)
        self.assertEqual(data["confirmed_count"], 1)

    def test_expense_reports_filter_by_start_and_end_date(self):
        self.client.force_authenticate(self.writer)
        today = timezone.localdate()
        matching = Report.objects.create(
            writer=self.writer,
            report_type=Report.ReportType.EXPENSE_REPORT,
            title="이번 달 경비",
            report_date=today,
        )
        Report.objects.create(
            writer=self.writer,
            report_type=Report.ReportType.EXPENSE_REPORT,
            title="다음 달 경비",
            report_date=today + timezone.timedelta(days=40),
        )

        response = self.client.get(
            "/api/reports/expenses/",
            {
                "start_date": today.isoformat(),
                "end_date": today.isoformat(),
            },
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data], [matching.id])

    def test_reports_filter_by_status(self):
        self.client.force_authenticate(self.writer)
        submitted = Report.objects.create(
            writer=self.writer,
            report_type=Report.ReportType.WORK_REPORT,
            title="제출된 보고",
            report_date=timezone.localdate(),
            status=Report.ReportStatus.SUBMITTED,
        )
        Report.objects.create(
            writer=self.writer,
            report_type=Report.ReportType.WORK_REPORT,
            title="임시 보고",
            report_date=timezone.localdate(),
            status=Report.ReportStatus.DRAFT,
        )

        response = self.client.get("/api/reports/", {"status": Report.ReportStatus.SUBMITTED})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data], [submitted.id])

    def test_work_report_list_hides_draft_from_recipient(self):
        draft = Report.objects.create(
            writer=self.writer,
            report_type=Report.ReportType.WORK_REPORT,
            title="수신자에게 숨길 임시저장",
            report_date=timezone.localdate(),
            status=Report.ReportStatus.DRAFT,
        )
        draft.recipients.add(self.approver)
        submitted = Report.objects.create(
            writer=self.writer,
            report_type=Report.ReportType.WORK_REPORT,
            title="수신자에게 보일 제출",
            report_date=timezone.localdate(),
            status=Report.ReportStatus.SUBMITTED,
        )
        submitted.recipients.add(self.approver)

        self.client.force_authenticate(self.approver)
        response = self.client.get("/api/reports/work/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data], [submitted.id])
