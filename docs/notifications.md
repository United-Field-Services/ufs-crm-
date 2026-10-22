# Notifications and reminders

Every important event reaches people in the app (the bell and the Notifications page) and, if they choose, by email.
The design follows what common HR platforms do: one inbox as the permanent record, per-category choices, a daily summary option,
reminders with escalation, and security notices that cannot be switched off.

## What people receive

| Group | Notification | Who | Default |
|---|---|---|---|
| Time off | A request needs your decision | The approver | In-app + email now |
| Time off | Your request was approved or declined (with the note) | The employee | In-app + email now |
| Time off | A request was cancelled | The approver | In-app |
| Time off | Your time off starts tomorrow | The employee | In-app |
| Reminders | Requests or timesheets waiting for you (daily, after one day) | The approver | In-app + daily summary |
| Reminders | A request has waited three days | HR and admins | In-app + email now |
| Time tracking | An entry was submitted for review | The approver | In-app + daily summary |
| Time tracking | An entry was approved or returned | The employee | In-app + email now |
| Time tracking | Friday timesheet reminder | Opt-in only | Off |
| Tasks | A task (or checklist step) was assigned to you | The assignee | In-app + email now |
| Reminders | Tasks due today, tomorrow or overdue (one summary a day) | The assignee | In-app + daily summary |
| Equipment | Equipment was assigned to you | The holder | In-app + email now |
| Reminders | Equipment return due (3 days before, on the day, then while overdue) | Holder; HR when late | In-app + email now |
| Reminders | A file is expiring (30, 7, 1 days, on the day) | Owner and HR | In-app + daily summary |
| Reminders | Probation or contract ending (14 and 3 days, on the day) | HR and the manager | In-app + daily summary |
| People | Work anniversary | The person and their manager | In-app |
| Company | A company announcement was published | Everyone except the author | In-app |
| Security | Your role or account status changed | The person | In-app + email now, cannot be turned off |

Each person can change in-app on/off and email (right away, daily summary at 8 am Pacific, or none) for every row under
Notifications, Preferences. They can also send themselves a test email there.

## How it works
- **Inbox:** the `notifications` table. Each notification has a dedupe key, so the same event never alerts a person twice.
- **Email:** messages are queued in `email_outbox` and sent by the Convex backend (`POST /notify`, protected by a shared secret and limited to invited
  addresses), because the Worker cannot open an SMTP connection. A queued email is sent right after the request that created it and, as a safety net,
  by a cron run every minute. A failed send is retried up to five times.
- **Reminders:** `lib/reminders.ts` runs every 30 minutes from the Worker cron, only between 7 am and 7 pm Pacific; the daily summary goes out at 8 am.
- **Privacy:** people only ever read their own notifications. Reminders about private records (probation, contract) go only to HR and the manager.

## Settings
- Worker variables: `UFS_PUBLIC_URL` (links in emails). Worker secret: `UFS_NOTIFY_SECRET`.
- Convex setting: `NOTIFY_SECRET` (the same value). Both are set on the development and production deployments.
- Without the secret the app still creates in-app notifications and simply sends no email.

## Not built yet
Push notifications to phones, SMS, Slack or Teams, per-person quiet hours, and birthday notices (they need private birth dates).
