// Shapes of the rows returned by GET /api/state and GET /api/operations.
// Keep these in step with the SELECT lists in app/api/state/route.ts and
// app/api/operations/route.ts. SQLite stores true/false as 1/0, so flags are numbers.
// Type-only module: it is safe to import from client components.

/** A person in the directory. HR and super admin receive the optional fields. */
export type PersonRow = {
  id: string; name: string; title: string; department: string; location: string; employment: string; hire_date: string;
  demo: number; active: number; manager_id: string | null; has_photo: number; photo_version: string | null;
  directory_active: number; imported: number; source_manager_name: string; source_manager_employee_id: string | null;
  division: string; work_arrangement: string; work_phone: string;
  email?: string; user_id?: string | null; role?: string;
  annual_allowance?: number; sick_allowance?: number; wfh_allowance?: number; bereavement_allowance?: number;
  source_id?: string | null; source_email?: string | null; directory_phone?: string | null; source_status?: string | null;
  source_employment_type?: string | null; review_flag?: string | null; imported_at?: string | null;
};

/** The signed-in employee: their own full record plus photo metadata. */
export type MeRow = {
  id: string; user_id: string | null; email: string; name: string; title: string; department: string; location: string;
  employment: string; hire_date: string; manager_id: string | null; role: string; active: number;
  annual_allowance: number; sick_allowance: number; wfh_allowance: number; bereavement_allowance: number;
  demo: number; created_at: string; data_scope: string; has_photo: boolean; photo_version: string | null;
};

export type LeaveRequestRow = {
  id: string; employee_id: string; type: string; start_date: string; end_date: string; days: number; year: number;
  note: string; status: string; created_at: string; reviewed_at: string | null; reviewer_id: string | null; review_note: string;
  required_manager_id: string | null; attachment_id: string | null; name: string; department: string; demo: number;
  manager_name: string | null; attachment_name: string | null;
};

export type TeamAwayRow = { id: string; employee_id: string; name: string; department: string; start_date: string; end_date: string; demo: number };

export type DocumentRow = {
  id: string; owner_id: string; name: string; category: string; visibility: string; mime: string; size: number;
  uploaded_at: string; folder: string; expiry_date: string | null; pinned: number; owner_name: string; demo: number;
  read_count?: number | null;
};

export type EventRow = { id: string; title: string; date: string; kind: string; location: string; created_by: string; demo: number };
export type BalanceRow = { type: string; total: number; used: number; pending: number };
export type TaskRow = {
  id: string; title: string; assignee_id: string; related_employee_id: string | null; workflow_id: string | null;
  description: string; due_date: string; status: string; created_by: string; created_at: string; demo: number; assignee_name: string;
};
export type ActivityRow = { action: string; created_at: string; name: string | null };
export type BudgetRow = { employee_id: string; year: number; type: string; total: number };
export type AcknowledgementRow = { document_id: string; acknowledged_at: string; employee_id?: string; employee_name?: string };
export type ApproverRow = { id: string; name: string; role: string };

export type HeadcountSnapshot = { sourceLabel: string; sourceUrl: string; verifiedAt: string; rows: { month: string; label: string; value: number }[] };

/** What the settings page shows from the one-time directory import. */
export type SourceSettings = {
  timezone: string; language: string; currency: string; workingDays: number[]; cycleStart: string;
  requestInHours?: boolean; calendarNotes?: boolean; importedAt?: string;
  leaveTypes: { name: string; days: number; allowExceed: boolean | null; calendarDays: boolean | null }[];
};
export type ImportSummary = {
  completed: boolean; importedAt: string; employees: number; excluded: number; holidays: number; pendingAccess: number;
  formerEmployees?: number; formerHistoryRows?: number; currentHistoryRows?: number; profilePhotos?: number; photoPlaceholders?: number;
};
/** The record a detail panel is showing. Which fields exist depends on what was opened (person, request or file). */
export type SelectedRecord = { id: string; name: string; department?: string; demo?: number; has_photo?: number | boolean }
  & Partial<Omit<PersonRow, 'id' | 'name' | 'department' | 'demo' | 'has_photo'>>
  & Partial<Omit<DocumentRow, 'id' | 'name' | 'demo'>>
  & Partial<Omit<LeaveRequestRow, 'id' | 'name' | 'department' | 'demo'>>;

export type NotificationSummary = { unread: number; items: { id: string; kind: string; title: string; body: string; link: string; created_at: string; read_at: string | null }[] };
export type StateData = {
  notifications?: NotificationSummary; invitesEnabled?: boolean; testMode?: boolean; me: MeRow; eligibleApprovers?: ApproverRow[]; people: PersonRow[]; requests: LeaveRequestRow[];
  teamAway: TeamAwayRow[]; documents: DocumentRow[]; events: EventRow[]; balances: BalanceRow[]; tasks: TaskRow[];
  activity: ActivityRow[]; year: number; currentYear?: number; employeeBudgets: BudgetRow[]; acknowledgements: AcknowledgementRow[];
  importSummary?: ImportSummary | null; sourceSettings?: SourceSettings | null;
  headcountSnapshot?: HeadcountSnapshot | null;
};

export type WorkflowKind = 'Onboarding' | 'Offboarding';
export type WorkflowStep = { title: string; assignee: string; offset: number; description: string };
export type WorkflowTemplateRow = {
  id: string; name: string; kind: WorkflowKind; steps: WorkflowStep[]; active: number; created_by: string; updated_at: string;
};
export type WorkflowRunRow = {
  id: string; template_id: string; employee_id: string; name: string; kind: WorkflowKind; start_date: string; created_by: string;
  created_at: string; employee_name: string; total: number; completed: number;
};
export type AssetRow = {
  id: string; name: string; category: string; tag: string; serial: string; status: string; assigned_to: string | null;
  assigned_at: string | null; return_due: string | null; notes: string; created_by: string; updated_at: string; employee_name: string | null;
};
export type AnnouncementRow = {
  id: string; title: string; body: string; category: string; status: string; pinned: number; created_by: string;
  created_at: string; published_at: string | null; author: string; read_count?: number; read_at: string | null;
};
export type TimeEntryRow = {
  id: string; employee_id: string; date: string; minutes: number; project: string; notes: string; status: string;
  required_manager_id: string | null; review_note: string; reviewed_by: string | null; created_at: string; updated_at: string;
  employee_name: string; manager_name: string | null;
};
export type OperationsData = {
  templates: WorkflowTemplateRow[]; archivedTemplates: WorkflowTemplateRow[]; workflows: WorkflowRunRow[]; assets: AssetRow[];
  announcements: AnnouncementRow[]; timeEntries: TimeEntryRow[]; acknowledgements: AcknowledgementRow[]; today: string;
};

/** A birthday shown on the dashboard (month and day only). */
export type BirthdayRow = { id?: string; employee_id?: string; name: string; month_day?: string; demo?: number };
