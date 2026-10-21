# Test accounts and sample data

Added to the live site on 2026-10-21 for hands-on testing. Everything is tagged: ids start with  and emails end with .

| Role | Account |
|---|---|
| Administrator | test.admin@ufs-test.example |
| HR manager | test.hr@ufs-test.example |
| Manager | test.manager@ufs-test.example |
| Hiring manager | test.hiring@ufs-test.example |
| Employee | test.employee@ufs-test.example, test.employee2@ufs-test.example |

Passwords are only in the git-ignored files  and .

Data: 36 people in six teams with a manager hierarchy (four more team leads and 26 staff without sign-ins), about 116 leave requests
(approved, pending and rejected, past and upcoming), 15 tasks, 8 events and holidays, 5 announcements, 12 equipment items and 140 timesheet days.

## Commands (project root)
- : create the six sign-ins in Convex (passwords set directly, no email)
- , then  ⛅️ wrangler 4.92.0 (update available 4.151.3)
──────────────────────────────────────────────
Resource location: remote 

🌀 Executing on remote database DB (109f7c1d-2235-4aa8-b6a0-148c7d6346b5):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
Note: if the execution fails to complete, your DB will return to its original state and you can safely retry.
├ Checking if file needs uploading
│
🌀 File already uploaded. Processing.
🌀 Starting import...
🌀 Processed 410 queries.
🚣 Executed 410 queries in 31.02ms (805 rows read, 0 rows written)
   Database is currently at bookmark 00000006-00000077-0000510b-e49637bce8fb512ec76ba7f2cf258221.
[
  {
    "results": [
      {
        "Total queries executed": 410,
        "Rows read": 805,
        "Rows written": 0,
        "Database size (MB)": "0.45"
      }
    ],
    "success": true,
    "finalBookmark": "00000006-00000077-0000510b-e49637bce8fb512ec76ba7f2cf258221",
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "ENAM",
      "served_by_colo": "ORD",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 31.024
      },
      "duration": 31.024,
      "changes": 1,
      "last_row_id": 0,
      "changed_db": true,
      "size_after": 450560,
      "rows_read": 805,
      "rows_written": 0,
      "num_tables": 33,
      "total_attempts": 1
    }
  }
]: load the data (safe to repeat)
- , then run the same  with : remove all test data
- Remove the Convex sign-ins with  for each address.

Remove all of it before real employees are added, and never use the test password command () for real people.
