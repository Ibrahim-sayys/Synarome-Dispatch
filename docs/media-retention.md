# Media retention and cleanup

Synarome Dispatch can automatically remove stored dispatch attachments in batches. **Deletion from the application's storage is irreversible unless you have a separate backup.** Review this document and test restoration before enabling the database migration in an environment containing important files.

## Setup and administration

1. Back up the database and uploaded files, and verify that they can be restored.
2. Deploy the updated backend and frontend, then run `alembic upgrade head` from the backend environment (for the existing development Compose setup: `docker compose exec backend alembic upgrade head`). This migration creates the schedule and sets the first cleanup for ten days after the migration runs. Without it, the cleanup schedule does not exist and automatic cleanup cannot run.
3. Sign in as a **super admin** and open **Account menu → Media cleanup**. The default interval is ten days; a super admin can set a whole number from 2 to 3,650 days. The same value controls the batch interval and minimum attachment age.
4. Saving an interval cancels any existing notice and schedules the next batch that many days from the time of the change. It does not delete files immediately. The next batch receives a new notice.

The application must be running for notices and cleanup to be processed. Its background task checks approximately once a minute. PostgreSQL row locking coordinates cleanup across backend workers. If the application is offline when cleanup is due, it resumes after startup; it does not skip the notice period.

## Notice and timing

- Approximately 24 hours before a scheduled batch, the application saves a notice. Super admins see an in-app banner while signed in, including the scheduled time, number of eligible stored files, and earliest and latest associated dispatch dates, when available. This is an in-app notice; it does not send email or a phone notification.
- The notice must exist for **at least 24 hours** before deletion. If the server was offline or the notice was created late, cleanup is postponed until at least 24 hours after the notice was saved.
- Cleanup runs even when no admin is online or has read the notice. The banner is not a guarantee that anyone saw it.
- The notice fixes an eligibility cutoff: the scheduled cleanup time (or the notice time if the schedule was already overdue), minus the configured number of days. Files that become old enough after that cutoff wait for a later batch. This can retain files longer than the configured minimum.
- After a successful batch, the next batch is scheduled for the configured interval after that run. Times are stored in UTC; the interface displays them in the browser's local time.

## What is deleted

- The task considers any files referenced by dispatch records in the configured `UPLOAD_DIR`. It removes the local attachment from that directory and clears its stored file path from every associated dispatch record. Current uploads are JPG, PNG, or PDF files; older referenced files are also eligible.
- A shared file is eligible only when **all** dispatches referring to it have a timestamp at or before the batch cutoff. Files with missing timestamps, or with a pending or uncertain send, are skipped. They may be considered again in a future batch once the condition is resolved.
- Paths outside the upload directory and symbolic links are not deleted. Unreferenced files are not removed by this process.
- Dispatch records, message text, recipient and status information, and the original filename remain. The conversation shows that the attachment was removed. A failed media message cannot be retried after its original attachment has been removed.
- This task only affects the app's local stored copy. It does not delete copies already sent to WhatsApp recipients or remove copies from external systems or backups.

If an eligible file is already missing, its stored path is cleared. If an unsafe path or filesystem error prevents deletion, the task logs an error and retains the current notice and batch for a later attempt. Other eligible files in that batch may already have been removed; inspect the logs and storage before resolving the issue. A restored database or backup may contain references to files that are absent, or may reintroduce files that become eligible for a future cleanup.

## Operational checks

Monitor free disk space and backend logs, and keep tested, independent backups of both the database and upload volume. Before a production rollout, test the migration, notice, deletion, access permissions, and recovery on a staging copy. Deleting attachments is permanent in the live application; changing the retention interval later does not restore files already removed.
