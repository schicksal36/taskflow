from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def create_read_records(apps, schema_editor):
    WorkRequest = apps.get_model("work_requests", "WorkRequest")
    WorkRequestReadRecord = apps.get_model("work_requests", "WorkRequestReadRecord")
    through = WorkRequest.assignees.through
    records = []
    for link in through.objects.all().iterator():
        records.append(WorkRequestReadRecord(work_request_id=link.workrequest_id, assignee_id=link.user_id))
    if records:
        WorkRequestReadRecord.objects.bulk_create(records, ignore_conflicts=True)


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("work_requests", "0002_workrequest_assignees"),
    ]

    operations = [
        migrations.CreateModel(
            name="WorkRequestReadRecord",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("is_read", models.BooleanField(default=False)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("assignee", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="work_request_read_records", to=settings.AUTH_USER_MODEL)),
                ("work_request", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="read_records", to="work_requests.workrequest")),
            ],
            options={
                "indexes": [
                    models.Index(fields=["assignee", "is_read"], name="work_reques_assigne_c2d5d8_idx"),
                    models.Index(fields=["work_request", "read_at"], name="work_reques_work_re_7663d6_idx"),
                ],
                "unique_together": {("work_request", "assignee")},
            },
        ),
        migrations.RunPython(create_read_records, migrations.RunPython.noop),
    ]
