// Every kind of notification the app can send. Shared by the server (what to send and the defaults) and the
// preferences screen (what people can switch on or off). Modelled on common HR platforms: each kind can go to the
// in-app inbox, by email straight away, in one daily email digest, or not at all.
export type EmailMode = 'instant' | 'daily' | 'off';
export type NotificationKind =
  | 'leave_request' | 'leave_decision' | 'leave_cancelled' | 'leave_upcoming'
  | 'approval_reminder' | 'approval_escalation'
  | 'time_submitted' | 'time_decision' | 'timesheet_reminder'
  | 'task_assigned' | 'task_due'
  | 'asset_assigned' | 'asset_due'
  | 'document_expiring' | 'contract_ending' | 'work_anniversary'
  | 'announcement' | 'access_changed' | 'test';

export type KindInfo = {
  label: string;
  description: string;
  group: string;
  inApp: boolean;
  email: EmailMode;
  mandatory?: boolean; // security notices: cannot be switched off
  optIn?: boolean;     // nothing is sent until the person turns it on
  hrOnly?: boolean;    // only shown to people who can act on it
};

export const NOTIFICATION_KINDS: Record<NotificationKind, KindInfo> = {
  leave_request: { group: 'Time off', label: 'A time-off request needs your decision', description: 'Someone you approve for asked for time off.', inApp: true, email: 'instant' },
  leave_decision: { group: 'Time off', label: 'Your time-off request was decided', description: 'Approved or declined, with the reviewer’s note.', inApp: true, email: 'instant' },
  leave_cancelled: { group: 'Time off', label: 'A request was cancelled', description: 'Someone cancelled a request you were going to review.', inApp: true, email: 'off' },
  leave_upcoming: { group: 'Time off', label: 'Your time off starts tomorrow', description: 'A reminder the day before approved leave begins.', inApp: true, email: 'off' },
  approval_reminder: { group: 'Reminders', label: 'Requests are waiting for you', description: 'A daily reminder while time-off requests or timesheets wait for your decision.', inApp: true, email: 'daily' },
  approval_escalation: { group: 'Reminders', label: 'A request has waited three days', description: 'HR is told when an approver has not responded for three days.', inApp: true, email: 'instant', hrOnly: true },
  time_submitted: { group: 'Time tracking', label: 'A timesheet entry needs review', description: 'Someone submitted time for your approval.', inApp: true, email: 'daily' },
  time_decision: { group: 'Time tracking', label: 'Your time entry was reviewed', description: 'Approved, or returned with a requested correction.', inApp: true, email: 'instant' },
  timesheet_reminder: { group: 'Time tracking', label: 'Friday timesheet reminder', description: 'A Friday reminder if you have not logged time this week.', inApp: false, email: 'off', optIn: true },
  task_assigned: { group: 'Tasks', label: 'A task was assigned to you', description: 'Including onboarding and offboarding checklist steps.', inApp: true, email: 'instant' },
  task_due: { group: 'Reminders', label: 'Tasks are due or overdue', description: 'A daily summary of tasks due today, tomorrow or overdue.', inApp: true, email: 'daily' },
  asset_assigned: { group: 'Equipment', label: 'Equipment was assigned to you', description: 'A laptop, phone or other item recorded against your name.', inApp: true, email: 'instant' },
  asset_due: { group: 'Reminders', label: 'Equipment return is due', description: 'Three days before, on the day, and while an item is overdue.', inApp: true, email: 'instant' },
  document_expiring: { group: 'Reminders', label: 'A document is expiring', description: '30 days, 7 days and 1 day before a file’s expiry date, and on the day.', inApp: true, email: 'daily' },
  contract_ending: { group: 'Reminders', label: 'Probation or contract is ending', description: 'Two weeks and three days before a probation or contract end date.', inApp: true, email: 'daily', hrOnly: true },
  work_anniversary: { group: 'People', label: 'A work anniversary', description: 'Yours, and your team members’, on the day.', inApp: true, email: 'off' },
  announcement: { group: 'Company', label: 'A new company announcement', description: 'Company news published by HR.', inApp: true, email: 'off' },
  access_changed: { group: 'Security', label: 'Your account access changed', description: 'Your role or account status was changed. This cannot be turned off.', inApp: true, email: 'instant', mandatory: true },
  test: { group: 'Security', label: 'Test notification', description: 'Sent when you press “Send me a test email”.', inApp: true, email: 'instant', mandatory: true },
};

export const kindList = (Object.keys(NOTIFICATION_KINDS) as NotificationKind[]).filter((kind) => kind !== 'test');
export const isNotificationKind = (value: unknown): value is NotificationKind => typeof value === 'string' && value in NOTIFICATION_KINDS;
export const isEmailMode = (value: unknown): value is EmailMode => value === 'instant' || value === 'daily' || value === 'off';

export type InboxItem={id:string;kind:string;title:string;body:string;link:string;created_at:string;read_at:string|null};
