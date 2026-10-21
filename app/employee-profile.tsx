'use client';
import {apiFetch} from '../lib/auth-fetch';
import {EmployeeAvatar} from './employee-avatar';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowRight, BadgeCheck, BookOpen, BriefcaseBusiness, Building2, CalendarDays, Check, ChevronDown, CircleAlert, HeartHandshake, History, IdCard, Info, LoaderCircle, LockKeyhole, Mail, MapPin, Pencil, Phone, Plus, Save, ShieldCheck, Trash2, UserRound, Users, Wallet, X } from 'lucide-react';
import './profile.css';

type Item = Record<string, unknown>;
type Access = { private: boolean; employment: boolean; compensation: boolean; hr: boolean; editable: boolean };
type ProfileResponse = {
  profile: Item;
  access: Access;
  emergencyContacts: Item[];
  identifiers: Item[];
  compensation: Item[];
  history: Item[];
  education: Item[];
  benefits: Item[];
};
type Props = {
  employeeId: string;
  titleId?: string;
  me: Item;
  people: Item[];
  onSaved: () => Promise<void>;
  onManageAccess: () => void;
  onManageBudget: () => void;
};
type Tab = 'Overview' | 'Personal' | 'Contact' | 'Emergency' | 'Job' | 'Education' | 'Compensation' | 'Benefits' | 'Identifiers' | 'History';
type Field = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'date' | 'url' | 'number' | 'textarea' | 'select' | 'checkbox';
  options?: string[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  wide?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: string;
  pattern?: string;
  autoComplete?: string;
};
type Mutate = (body: Item, success: string) => Promise<boolean>;
const text = (value: unknown) => value == null ? '' : String(value);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const isPresent = (value: unknown) => value !== null && value !== undefined && text(value).trim() !== '';
const booleanFlag = (value: unknown) => value === true || value === 1 ? true : value === false || value === 0 ? false : null;
const date = (value: unknown) => {
  const raw = text(value);
  if (!raw) return 'Not added';
  const parsed = new Date(raw.length === 10 ? `${raw}T12:00:00Z` : raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const tabIcons = { Overview: UserRound, Personal: IdCard, Contact: Phone, Emergency: HeartHandshake, Job: BriefcaseBusiness, Education: BookOpen, Compensation: Wallet, Benefits: HeartHandshake, Identifiers: ShieldCheck, History };
const personalFields: Field[] = [
  { name: 'legal_first_name', label: 'Legal first name', autoComplete: 'given-name', maxLength: 100 },
  { name: 'legal_last_name', label: 'Legal last name', autoComplete: 'family-name', maxLength: 100 },
  { name: 'preferred_name', label: 'Preferred name', hint: 'The name you prefer colleagues to use.', maxLength: 100 },
  { name: 'birth_date', label: 'Date of birth', type: 'date', autoComplete: 'bday', hint: 'Private to the employee and HR.' },
  { name: 'gender', label: 'Gender', type: 'select', options: ['Female', 'Male', 'Non-binary', 'Self-described', 'Prefer not to say'] },
  { name: 'marital_status', label: 'Marital status', type: 'select', options: ['Single', 'Married', 'Domestic partnership', 'Separated', 'Divorced', 'Widowed', 'Prefer not to say'] },
  { name: 'nationality', label: 'Nationality', maxLength: 100 },
  { name: 'citizenship', label: 'Citizenship', maxLength: 100 },
  { name: 'languages', label: 'Languages', hint: 'Separate languages with commas.', placeholder: 'English, Spanish', maxLength: 300 },
  { name: 'linkedin', label: 'LinkedIn profile', type: 'url', placeholder: 'https://www.linkedin.com/in/…', maxLength: 300 },
  { name: 'bio', label: 'About this person', type: 'textarea', wide: true, maxLength: 2000, hint: 'Private profile notes. Do not enter identity numbers, medical or banking information.' },
];
const contactFields: Field[] = [
  { name: 'personal_email', label: 'Personal email', type: 'email', autoComplete: 'email', maxLength: 254 },
  { name: 'personal_phone', label: 'Personal phone', type: 'tel', autoComplete: 'tel', maxLength: 40 },
  { name: 'work_phone', label: 'Work phone', type: 'tel', maxLength: 40 },
  { name: 'work_phone_public', label: 'Show work phone in the employee directory', type: 'checkbox', hint: 'Only the work phone is shared. Personal contact details remain private.' },
];
const addressFields: Field[] = [
  { name: 'address_line1', label: 'Address line 1', autoComplete: 'address-line1', wide: true, maxLength: 200 },
  { name: 'address_line2', label: 'Address line 2', autoComplete: 'address-line2', wide: true, maxLength: 200 },
  { name: 'city', label: 'City', autoComplete: 'address-level2', maxLength: 100 },
  { name: 'state', label: 'State / province / region', autoComplete: 'address-level1', maxLength: 100 },
  { name: 'postal_code', label: 'Postal code', autoComplete: 'postal-code', maxLength: 24 },
  { name: 'country', label: 'Country', autoComplete: 'country-name', maxLength: 100 },
];
const secondaryAddressFields = addressFields.map(field => ({ ...field, name: `secondary_${field.name}`, autoComplete: `section-secondary ${field.autoComplete}` }));
const publicJobFields: Field[] = [
  { name: 'name', label: 'Directory display name', required: true, maxLength: 150 },
  { name: 'title', label: 'Job title', maxLength: 150 },
  { name: 'department', label: 'Department', maxLength: 100 },
  { name: 'location', label: 'Work location', maxLength: 100 },
  { name: 'employment', label: 'Employment type', type: 'select', required: true, options: ['Full-Time', 'Part-Time', 'Contractor', 'Intern', 'Temporary'] },
  { name: 'hire_date', label: 'Hire date', type: 'date', required: true },
  { name: 'division', label: 'Division', maxLength: 150 },
  { name: 'work_arrangement', label: 'Work arrangement', type: 'select', options: ['On-site', 'Hybrid', 'Remote'] },
];
const employmentFields: Field[] = [
  { name: 'employee_number', label: 'Employee number', maxLength: 50 },
  { name: 'employment_status', label: 'Employment status', type: 'select', required: true, options: ['Active', 'Probation', 'On leave', 'Notice period', 'Inactive', 'Terminated'], hint: 'Inactive or Terminated disables sign-in immediately. Rehire never restores login automatically.' },
  { name: 'legal_entity', label: 'Legal entity', maxLength: 150 },
    { name: 'timezone', label: 'Time zone', placeholder: 'America/Los_Angeles', maxLength: 80 },
  { name: 'work_schedule', label: 'Work schedule', placeholder: 'Monday–Friday, 9:00–17:00', maxLength: 200 },
  { name: 'hours_per_day', label: 'Working hours per day', type: 'number', min: 0.01, max: 24, step: '0.25', hint: 'Optional. More than zero, up to 24 hours.' },
  { name: 'probation_end', label: 'Probation end date', type: 'date' },
  { name: 'contract_end', label: 'Contract end date', type: 'date' },
  { name: 'exit_date', label: 'Exit date', type: 'date' },
  { name: 'exit_reason', label: 'Exit reason', type: 'textarea', maxLength: 1000, hint: 'Private to the employee and HR.' },
];
const emergencyFields: Field[] = [
  { name: 'name', label: 'Contact full name', required: true, maxLength: 150 },
  { name: 'relationship', label: 'Relationship', required: true, maxLength: 80 },
  { name: 'phone', label: 'Primary phone', type: 'tel', required: true, maxLength: 40 },
  { name: 'alternate_phone', label: 'Alternate phone', type: 'tel', maxLength: 40 },
  { name: 'email', label: 'Email', type: 'email', maxLength: 254 },
  { name: 'priority', label: 'Contact order', type: 'number', required: true, min: 1, max: 10, step: '1', hint: '1 is contacted first; maximum 10.' },
  { name: 'address', label: 'Address', type: 'textarea', wide: true, maxLength: 500 },
  { name: 'is_primary', label: 'Primary emergency contact', type: 'checkbox', wide: true, hint: 'Saving this as primary clears the previous primary designation.' },
];
const identifierFields: Field[] = [
  { name: 'type', label: 'Identifier type', type: 'select', required: true, options: ['Passport', 'National ID', 'Social Security (SSN)', 'Driver license', 'Work permit', 'Tax ID', 'Other'] },
  { name: 'country', label: 'Issuing country', required: true, maxLength: 100 },
  { name: 'last4', label: 'Last four characters only', pattern: '[A-Za-z0-9]{4}', placeholder: 'A123', hint: 'Optional. Exactly four letters or digits. Longer values are rejected, never shortened. Never enter a full number.' },
  { name: 'expiry_date', label: 'Expiry date', type: 'date' },
  { name: 'status', label: 'Record status', type: 'select', required: true, options: ['Pending', 'Recorded', 'Expired'] },
];
const educationFields: Field[] = [
  { name: 'institution', label: 'School / institution', required: true, maxLength: 200 },
  { name: 'degree', label: 'Degree / qualification', maxLength: 150 },
  { name: 'field_of_study', label: 'Field of study', maxLength: 150 },
  { name: 'department', label: 'Academic department', maxLength: 150 },
  { name: 'graduation_date', label: 'Graduation date', type: 'date' },
  { name: 'status', label: 'Status', type: 'select', required: true, options: ['In progress', 'Completed', 'Paused'] },
  { name: 'start_date', label: 'Start date', type: 'date' },
  { name: 'end_date', label: 'End / expected end date', type: 'date' },
  { name: 'notes', label: 'Notes', type: 'textarea', wide: true, maxLength: 1000, hint: 'Optional context about this qualification.' },
];
const benefitFields: Field[] = [
  { name: 'type', label: 'Benefit type', type: 'select', required: true, options: ['Health', 'Dental', 'Vision', 'Retirement', 'Life insurance', 'Wellness', 'Other'] },
  { name: 'plan', label: 'Plan name', required: true, maxLength: 150 },
  { name: 'provider', label: 'Provider', maxLength: 150 },
  { name: 'coverage', label: 'Coverage level', placeholder: 'Employee only', maxLength: 150 },
  { name: 'cost', label: 'Recorded benefit cost', type: 'number', min: 0, max: 1000000000, step: '0.01', hint: 'Optional administrative amount, not a payment.' },
  { name: 'currency', label: 'Cost currency', maxLength: 3, pattern: '[A-Z]{3}', placeholder: 'USD', hint: 'Required when recording a cost.' },
  { name: 'period', label: 'Cost period', type: 'select', options: ['Annual', 'Quarterly', 'Monthly', 'Weekly', 'Daily', 'Hourly', 'One-time'], hint: 'Required when recording a cost.' },
  { name: 'status', label: 'Enrollment status', type: 'select', required: true, options: ['Eligible', 'Enrolled', 'Waived', 'Ended'] },
  { name: 'effective_date', label: 'Effective date', type: 'date', required: true },
  { name: 'end_date', label: 'End date', type: 'date' },
  { name: 'notes', label: 'Administrative notes', type: 'textarea', wide: true, maxLength: 1000, hint: 'Do not enter medical details, dependent information, account numbers or policy identifiers.' },
];
const compensationFields: Field[] = [
  { name: 'amount', label: 'Base pay amount', type: 'number', required: true, min: 0.01, max: 1000000000, step: '0.01', hint: 'The amount for the selected pay frequency.' },
  { name: 'currency', label: 'Currency', required: true, maxLength: 3, pattern: '[A-Z]{3}', placeholder: 'USD', hint: 'Three-letter uppercase currency code.' },
  { name: 'frequency', label: 'Pay frequency', type: 'select', required: true, options: ['Annual', 'Quarterly', 'Monthly', 'Biweekly', 'Weekly', 'Daily', 'Hourly'] },
  { name: 'pay_schedule', label: 'Pay schedule', type: 'select', options: ['Monthly', 'Twice monthly', 'Biweekly', 'Weekly'] },
  { name: 'overtime_status', label: 'Overtime classification', type: 'select', options: ['Exempt', 'Nonexempt'], hint: 'Record HR’s confirmed classification; this app does not determine eligibility.' },
  { name: 'effective_date', label: 'Effective date', type: 'date', required: true },
  { name: 'reason', label: 'Reason for change', type: 'textarea', wide: true, required: true, maxLength: 500, hint: 'This note is visible to the employee and HR.' },
];

function readValues(form: HTMLFormElement, fields: Field[]): Item {
  const data = new FormData(form);
  return Object.fromEntries(fields.map(field => [field.name, field.type === 'checkbox' ? data.has(field.name) : field.type === 'number' ? (text(data.get(field.name)).trim() === '' ? '' : Number(data.get(field.name))) : text(data.get(field.name)).trim()]));
}
// Compare the actual controls with their initial values. Opening an editor is
// not a change, and undoing an edit must also remove navigation warnings.
function profileHasChanges(panel: HTMLDivElement) {
  return Array.from(panel.querySelectorAll('input[name], textarea[name], select[name]')).some(control => {
    if (control instanceof HTMLSelectElement) {
      const defaults = Array.from(control.options).filter(option => option.defaultSelected).map(option => option.value);
      if (!defaults.length && control.options.length) defaults.push(control.options[0].value);
      return JSON.stringify(Array.from(control.selectedOptions).map(option => option.value)) !== JSON.stringify(defaults);
    }
    if (control instanceof HTMLInputElement && ['checkbox', 'radio'].includes(control.type)) return control.checked !== control.defaultChecked;
    return (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) && control.value !== control.defaultValue;
  });
}
const lastFourMessage = 'Enter exactly four letters or digits, or leave this field blank. Full identifier values are not accepted.';
function LastFourInput({ id, value, field }: { id: string; value: unknown; field: Field }) {
  const initial = /^[A-Za-z0-9]{4}$/.test(text(value)) ? text(value) : '';
  // Keep only an accepted suffix in component memory. Reject an entire invalid
  // insertion instead of retaining, truncating, echoing, or sending its value.
  const accepted = useRef(initial);
  const [error, setError] = useState('');
  return <><input id={id} name={field.name} type="text" defaultValue={initial} pattern={field.pattern} placeholder={field.placeholder} autoComplete="off" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} onInput={event => {
    const input = event.currentTarget;
    if (!/^[A-Za-z0-9]{0,4}$/.test(input.value)) {
      input.value = accepted.current;
      const message = 'That input was rejected. Enter only the last four letters or digits; longer values are never shortened or saved.';
      input.setCustomValidity(message); setError(message); return;
    }
    accepted.current = input.value; input.setCustomValidity(''); setError('');
  }} onInvalid={event => { setError(event.currentTarget.validity.customError ? event.currentTarget.validationMessage : lastFourMessage); }} onBlur={event => {
    if (!event.currentTarget.validity.valid) setError(event.currentTarget.validity.customError ? event.currentTarget.validationMessage : lastFourMessage);
  }} />{error && <p className="profile-field-error" id={`${id}-error`} role="alert">{error}</p>}</>;
}
function parseResponse(value: unknown): ProfileResponse {
  const data = value as Partial<ProfileResponse> | null;
  if (!data?.profile || !data.access) throw new Error('The profile could not be loaded. Please try again.');
  return { ...data, emergencyContacts: data.emergencyContacts || [], identifiers: data.identifiers || [], compensation: data.compensation || [], history: data.history || [], education: data.education || [], benefits: data.benefits || [] } as ProfileResponse;
}
function FieldInput({ field, value, prefix }: { field: Field; value: unknown; prefix: string }) {
  const id = `${prefix}-${field.name}`;
  const common = { id, name: field.name, required: field.required, 'aria-describedby': field.hint ? `${id}-hint` : undefined };
  return <div className={`profile-field${field.wide ? ' profile-field-wide' : ''}${field.type === 'checkbox' ? ' profile-field-check' : ''}`}>
    {field.type === 'checkbox' ? <label htmlFor={id}><input {...common} type="checkbox" defaultChecked={Boolean(value)} /><span>{field.label}</span></label> : <>
      <label htmlFor={id}>{field.label}{field.required && <span className="profile-required" aria-hidden="true">*</span>}</label>
      {field.name === 'last4' ? <LastFourInput id={id} value={value} field={field} /> : field.type === 'select' ? <select {...common} defaultValue={text(value)}><option value="">{field.required ? 'Select an option' : 'Not specified'}</option>{field.options?.map(option => <option key={option} value={option}>{option}</option>)}{isPresent(value) && !field.options?.includes(text(value)) && <option value={text(value)}>{text(value)}</option>}</select> : field.type === 'textarea' ? <textarea {...common} defaultValue={text(value)} maxLength={field.maxLength} placeholder={field.placeholder} rows={3} /> : <input {...common} type={field.type || 'text'} defaultValue={text(value)} maxLength={field.maxLength || 300} min={field.min} max={field.type === 'date' && field.name === 'birth_date' ? today() : field.max} step={field.step} pattern={field.pattern} placeholder={field.placeholder} autoComplete={field.autoComplete || 'off'} />}
    </>}
    {field.hint && <p className="profile-field-hint" id={`${id}-hint`}>{field.hint}</p>}
  </div>;
}
function Fields({ fields, values, prefix, editable }: { fields: Field[]; values: Item; prefix: string; editable: boolean }) {
  return editable ? <div className="profile-fields">{fields.map(field => <FieldInput key={field.name} field={field} value={values[field.name]} prefix={prefix} />)}</div> : <dl className="profile-read-grid">{fields.map(field => <div key={field.name} className={field.wide ? 'profile-field-wide' : ''}><dt>{field.label}</dt><dd className={!isPresent(values[field.name]) ? 'profile-not-added' : ''}>{field.type === 'checkbox' ? (values[field.name] ? 'Yes' : 'No') : field.type === 'date' ? date(values[field.name]) : text(values[field.name]) || 'Not added'}</dd></div>)}</dl>;
}
function Permission({ children, publicField = false }: { children: ReactNode; publicField?: boolean }) {
  return <span className={`profile-permission${publicField ? ' profile-permission-public' : ''}`}>{publicField ? <Users size={12} /> : <LockKeyhole size={12} />}{children}</span>;
}
function SectionTitle({ title, description, permission }: { title: string; description?: string; permission?: string }) {
  return <div className="profile-section-title"><div><h3>{title}</h3>{description && <p>{description}</p>}</div>{permission && <Permission>{permission}</Permission>}</div>;
}
function FormFooter({ busy, dirty, label = 'Save changes', onReset }: { busy: boolean; dirty: boolean; label?: string; onReset: () => void }) {
  return <div className="profile-form-footer"><span>{busy ? 'Saving securely…' : dirty ? 'You have unsaved changes' : 'Changes are saved only when you select Save.'}</span><div><button type="button" disabled={busy || !dirty} onClick={onReset}>Reset</button><button className="profile-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="profile-spin" size={15} /> : <Save size={15} />}{busy ? 'Saving…' : label}</button></div></div>;
}
function Empty({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div className="profile-empty"><span>{icon}</span><h4>{title}</h4><p>{description}</p></div>;
}
function formatPay(record: Item) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: text(record.currency), maximumFractionDigits: 2 }).format(Number(record.amount)); }
  catch { return `${text(record.currency)} ${Number(record.amount).toLocaleString('en-US')}`; }
}

export function EmployeeProfile({ employeeId, me, people, onSaved, onManageAccess, onManageBudget, titleId = 'modal-title' }: Props) {
  return <ProfileSession key={`${text(me.id)}-${employeeId}`} titleId={titleId} employeeId={employeeId} me={me} people={people} onSaved={onSaved} onManageAccess={onManageAccess} onManageBudget={onManageBudget} />;
}
function ProfileSession({ employeeId, me, people, onSaved, onManageAccess, onManageBudget, titleId = 'modal-title' }: Props) {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    apiFetch(`/api/profiles/${encodeURIComponent(employeeId)}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json() as Item;
      if (!response.ok) throw new Error(text(result.error) || 'Unable to load this employee profile.');
      const next = parseResponse(result);
      if (!controller.signal.aborted) { setData(next); setError(''); setLoading(false); }
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Unable to load this profile.'); setLoading(false); } });
    return () => { alive.current = false; controller.abort(); };
  }, [employeeId, reload]);
  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const mutate: Mutate = async (body, message) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await apiFetch(`/api/profiles/${encodeURIComponent(employeeId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as Item;
      if (!response.ok) throw new Error(text(result.error) || 'Your changes could not be saved.');
      const next = parseResponse(result);
      if (!alive.current) return true;
      setData(next); setRevision(value => value + 1); setDirty(false); setPendingTab(null); setNotice(message);
      try { await onSaved(); } catch { if (alive.current) setNotice(`${message} The directory could not refresh; reopen the directory to see the latest changes.`); }
      return true;
    } catch (cause) {
      if (alive.current) { setError(cause instanceof Error ? cause.message : 'Your changes could not be saved. Please try again.'); statusRef.current?.focus(); }
      return false;
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  function changeTab(next: Tab) {
    if (busy || next === tab) return;
    if (dirty) { setPendingTab(next); return; }
    setTab(next); setPendingTab(null); setError(''); setNotice('');
  }
  function reset() { setRevision(value => value + 1); setDirty(false); setError(''); setPendingTab(null); }
  function trackChanges(panel: HTMLDivElement) { setDirty(profileHasChanges(panel)); setPendingTab(null); }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, current: Tab, available: Tab[]) {
    const index = available.indexOf(current);
    const next = event.key === 'ArrowRight' ? available[(index + 1) % available.length] : event.key === 'ArrowLeft' ? available[(index - 1 + available.length) % available.length] : event.key === 'Home' ? available[0] : event.key === 'End' ? available[available.length - 1] : null;
    if (!next) return;
    event.preventDefault();
    changeTab(next);
    document.getElementById(`profile-tab-${next}`)?.focus();
  }
  if (loading || !data) return <div className="profile-root"><div className="profile-load"><span className="profile-load-icon">{loading ? <LoaderCircle size={26} className="profile-spin" /> : <CircleAlert size={26} />}</span><h2 id={titleId}>{loading ? 'Opening employee profile' : 'Profile unavailable'}</h2><p>{loading ? 'Checking permissions and loading the latest record…' : error}</p>{!loading && <button type="button" className="profile-primary" onClick={() => { setLoading(true); setReload(value => value + 1); }}>Try again</button>}</div></div>;
  const { profile, access } = data;
  const isSelf = text(me.id) === employeeId;
  const tabs: Tab[] = ['Overview', ...(access.private ? ['Personal', 'Contact', 'Emergency'] as Tab[] : []), 'Job', ...(access.private ? ['Education'] as Tab[] : []), ...(access.compensation ? ['Compensation'] as Tab[] : []), ...(access.private ? ['Benefits', 'Identifiers'] as Tab[] : []), ...(access.employment ? ['History'] as Tab[] : [])];
  const activeTab = tabs.includes(tab) ? tab : 'Overview';
  const permission = access.hr ? 'Employee + HR · HR editing' : 'Employee + HR';
  const sourcePerson = people.find(person => text(person.id) === employeeId) || {};
  const manager = people.find(person => text(person.id) === text(profile.manager_id));
  const managerName = text(profile.manager_name) || text(manager?.name) || 'Not assigned';
  const loginActive = booleanFlag(profile.active);
  // Directory classification comes from the server's lifecycle/source checks.
  // Neither login activation nor a defaulted profile status establishes membership.
  const currentEmployee = booleanFlag(sourcePerson.directory_active);
  const employmentStatus = access.employment ? text(profile.employment_status).trim() : '';
  const completenessFields = ['legal_first_name', 'legal_last_name', 'birth_date', 'personal_email', 'personal_phone', 'address_line1', 'city', 'country'];
  const completed = completenessFields.filter(field => isPresent(profile[field])).length;
  const completeness = Math.round(completed / completenessFields.length * 100);
  const jobValues = { ...profile, manager_name: managerName };
  async function submitPersonal(event: FormEvent<HTMLFormElement>, fields: Field[], label: string) {
    event.preventDefault();
    await mutate({ action: 'update_personal', values: readValues(event.currentTarget, fields) }, label);
  }
  async function submitJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = readValues(form, [...publicJobFields, ...employmentFields, ...(me.role === 'admin' ? [{ name: 'manager_id', label: '' }] : [])]);
    const formData = new FormData(form);
    await mutate({ action: 'update_employment', values, effective_date: formData.get('effective_date'), reason: formData.get('reason') }, 'Employment details saved and added to history.');
  }
  return <div className="profile-root" aria-busy={busy} data-profile-dirty={dirty ? 'true' : 'false'} data-profile-busy={busy ? 'true' : 'false'}>
    <div className="profile-topline"><span>PEOPLE</span><span>/</span><span>EMPLOYEE PROFILE</span></div>
    <header className="profile-header">
      <div className="profile-avatar" aria-hidden="true"><EmployeeAvatar className="profile-avatar-image" person={profile}/><span><UserRound size={13} /></span></div>
      <div className="profile-identity"><div className="profile-name-row"><h2 id={titleId}>{text(profile.name)}</h2>{Boolean(profile.demo) && <span className="profile-demo">DEMO</span>}{isSelf && <span className="profile-you">YOU</span>}</div><p>{text(profile.title) || 'Employee'}<span>·</span>{text(profile.department)}</p><div className="profile-identity-meta"><span><MapPin size={13} />{text(profile.location) || 'Location not set'}</span><span><BriefcaseBusiness size={13} />{text(profile.employment) || 'Employment not set'}</span></div></div>
      <div className="profile-header-status">
        {currentEmployee !== null && <span className={`profile-status profile-directory-status${currentEmployee ? '' : ' profile-status-inactive'}`}><i />{currentEmployee ? 'Current employee' : 'Former employee'}</span>}
        {employmentStatus && <span className="profile-view-label profile-employment-status">Employment status: {employmentStatus}</span>}
        {loginActive !== null && <span className={`profile-status profile-login-status${loginActive ? '' : ' profile-status-inactive'}`}><i />Login: {loginActive ? 'Active' : 'Inactive'}</span>}
        <span className="profile-view-label"><ShieldCheck size={12} />{access.hr ? 'HR view' : isSelf ? 'Your private profile' : 'Directory view'}</span>
      </div>
    </header>
    <div className="profile-review-note"><Info size={15} /><p><strong>Private review build.</strong> {profile.imported?'Ordinary directory/job data was imported. Private HR fields, documents and compensation were not transferred.':'Real employee data has not been migrated.'} Use fictional private details only; production privacy and security review is still required.</p></div>
    <div className="profile-tabs" role="tablist" aria-label="Employee profile sections">{tabs.map(name => { const Icon = tabIcons[name]; return <button key={name} id={`profile-tab-${name}`} type="button" role="tab" aria-selected={activeTab === name} aria-controls={`profile-panel-${name}`} tabIndex={activeTab === name ? 0 : -1} className={activeTab === name ? 'profile-tab-active' : ''} disabled={busy} onClick={() => changeTab(name)} onKeyDown={event => tabKey(event, name, tabs)}><Icon size={15} />{name}</button>; })}</div>
    <div className="profile-feedback" ref={statusRef} tabIndex={-1}>
      {error && <div className="profile-alert profile-alert-error" role="alert"><CircleAlert size={17} /><div><strong>Changes weren’t saved</strong><p>{error}</p></div><button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
      {notice && <div className="profile-alert profile-alert-success" role="status"><Check size={17} /><p>{notice}</p><button type="button" onClick={() => setNotice('')} aria-label="Dismiss saved message"><X size={15} /></button></div>}
      {pendingTab && <div className="profile-alert profile-alert-warning" role="alert"><CircleAlert size={17} /><div><strong>Keep your changes?</strong><p>Save this section first, or discard changes to open {pendingTab}.</p></div><div className="profile-alert-actions"><button type="button" onClick={() => setPendingTab(null)}>Keep editing</button><button type="button" onClick={() => { setTab(pendingTab); reset(); setNotice(''); }}>Discard changes</button></div></div>}
    </div>
    <div id={`profile-panel-${activeTab}`} role="tabpanel" aria-labelledby={`profile-tab-${activeTab}`} tabIndex={0} className="profile-body" key={`${activeTab}-${revision}`} onInput={event => trackChanges(event.currentTarget)} onChange={event => trackChanges(event.currentTarget)}><fieldset className="profile-fields-shell" disabled={busy}>
      {activeTab === 'Overview' && <>
        <div className="profile-summary-grid"><div><span className="profile-summary-icon"><Building2 size={20} /></span><div><span>Department</span><strong>{text(profile.department) || 'Not set'}</strong></div></div><div><span className="profile-summary-icon"><CalendarDays size={20} /></span><div><span>Joined UFS</span><strong>{date(profile.hire_date)}</strong></div></div><div><span className="profile-summary-icon"><Users size={20} /></span><div><span>Assigned leave approver</span><strong>{managerName}</strong></div></div></div>
        <div className="profile-overview-grid"><section className="profile-card"><SectionTitle title="Work at a glance" description="Current directory information." /><Fields fields={publicJobFields.filter(field => field.name !== 'name')} values={profile} prefix="overview" editable={false} /><div className="profile-card-footer"><Permission publicField>Visible in the directory</Permission><button type="button" onClick={() => changeTab('Job')}>View job details <ArrowRight size={14} /></button></div></section>
          <aside className="profile-overview-aside">{access.private ? <section className="profile-card profile-completeness"><div className="profile-section-title"><h3>Personal profile</h3><span>{completeness}%</span></div><div className="profile-progress" role="progressbar" aria-label="Personal profile completion" aria-valuenow={completeness} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${completeness}%` }} /></div><p>{completed} of {completenessFields.length} basic personal and contact fields added. Optional fields can be left blank.</p><div className="profile-completion-links"><button type="button" onClick={() => changeTab('Personal')}><IdCard size={16} /><span>Personal information</span><ArrowRight size={14} /></button><button type="button" onClick={() => changeTab('Contact')}><Phone size={16} /><span>Contact details</span><ArrowRight size={14} /></button><button type="button" onClick={() => changeTab('Emergency')}><HeartHandshake size={16} /><span>{data.emergencyContacts.length ? `${data.emergencyContacts.length} emergency contact${data.emergencyContacts.length === 1 ? '' : 's'}` : 'Add an emergency contact'}</span><ArrowRight size={14} /></button></div></section> : <section className="profile-card profile-access-card"><span className="profile-large-icon"><LockKeyhole size={25} /></span><h3>Private details stay private</h3><p>You can view this person’s work profile. Personal details, compensation, identifiers and emergency contacts are available only to the employee and HR.</p>{Boolean(profile.work_phone) && <div className="profile-work-phone"><Phone size={15} />{text(profile.work_phone)}</div>}</section>}
          {access.hr && Boolean(sourcePerson.imported) && <section className="profile-card profile-admin-card"><h3>Imported directory record</h3><p>Ordinary source work information. This does not grant account access or approval powers.</p><dl className="profile-details"><dt>Source email</dt><dd>{text(sourcePerson.source_email)||'Not recorded'}</dd><dt>Source phone</dt><dd>{text(sourcePerson.directory_phone)||'Not recorded'}</dd><dt>Source reporting manager</dt><dd>{text(sourcePerson.source_manager_name)||'Not recorded'}</dd><dt>Login access</dt><dd>{loginActive === null ? 'Not available' : loginActive ? 'Active' : 'Inactive'}</dd></dl><p>Imported contact values are HR-only in this review.</p></section>}{access.hr && <section className="profile-card profile-admin-card"><h3>Employee administration</h3><p>Manage account access and time-off entitlements separately from profile information. Employment changes do not automatically restore login access; the super admin must explicitly restore it.</p><div>{me.role === 'admin' && <button type="button" onClick={onManageAccess}><ShieldCheck size={15} />Manage access</button>}<button type="button" onClick={onManageBudget}><CalendarDays size={15} />Time-off budgets</button></div></section>}</aside></div>
      </>}
      {activeTab === 'Personal' && <form onSubmit={event => submitPersonal(event, personalFields, 'Personal information saved.')}><section className="profile-card"><SectionTitle title="Personal information" description="The details that make this profile yours. All fields in this section are optional." permission={permission} /><Fields fields={personalFields} values={profile} prefix="personal" editable={access.editable} /></section>{access.editable && <FormFooter busy={busy} dirty={dirty} onReset={reset} />}</form>}
      {activeTab === 'Contact' && <form onSubmit={event => submitPersonal(event, [...contactFields, ...addressFields, ...secondaryAddressFields], 'Contact details saved.')}><section className="profile-card"><SectionTitle title="Email & phone" description="Keep personal and work contact details separate." permission={permission} /><div className="profile-readonly-email"><Mail size={17} /><div><span>Work email / sign-in identity</span><strong>{text(profile.email) || 'Not assigned'}</strong><p>Managed with the account; this field cannot be edited here.</p></div><span className="profile-read-only">READ ONLY</span></div><Fields fields={contactFields} values={profile} prefix="contact" editable={access.editable} /></section><section className="profile-card"><SectionTitle title="Home address" description="This address is not included in the employee directory." permission="Employee + HR only" /><Fields fields={addressFields} values={profile} prefix="address" editable={access.editable} /></section><details className="profile-card profile-disclosure"><summary><span>Secondary address <small>Optional mailing or alternate address</small></span><ChevronDown size={17} /></summary><Fields fields={secondaryAddressFields} values={profile} prefix="secondary-address" editable={access.editable} /></details>{access.editable && <FormFooter busy={busy} dirty={dirty} onReset={reset} />}</form>}
      {activeTab === 'Job' && <form onSubmit={submitJob}><section className="profile-card"><SectionTitle title="Employment details" description={access.hr ? 'Maintain the employee’s current work profile and record effective-dated changes.' : 'Employment details are maintained by HR.'} permission={access.hr ? 'HR editing only' : 'Read only'} /><div className="profile-inline-note"><Users size={14} /><p>Display name, title, department, location, employment type, hire date, division and work arrangement are directory fields.</p></div><Fields fields={publicJobFields} values={profile} prefix="job" editable={access.hr} />{access.hr ? <div className="profile-fields"><div className="profile-field profile-field-wide"><label htmlFor="profile-manager">Assigned leave approver</label><select id="profile-manager" name="manager_id" defaultValue={text(profile.manager_id)} disabled={me.role !== 'admin'}><option value="">Not assigned</option>{people.filter(person => text(person.id) !== employeeId && ((person.active && ['admin','hr_manager','manager'].includes(text(person.role))) || text(person.id) === text(profile.manager_id))).map(person => <option key={text(person.id)} value={text(person.id)}>{text(person.name)}{person.active ? '' : ' (inactive)'}</option>)}</select><p className="profile-field-hint">Only the super admin can change this assignment. It controls required leave and time-entry approval, not a verified organization reporting line. Pending approvals are rerouted when changed.</p></div></div> : <Fields fields={[{ name: 'manager_name', label: 'Assigned leave approver' }]} values={jobValues} prefix="manager" editable={false} />}</section>{access.employment && <section className="profile-card"><SectionTitle title="Employment administration" description="Private employee record. Inactive or Terminated disables sign-in. After rehire, the super admin must explicitly restore access." permission="Employee + HR only" /><Fields fields={employmentFields} values={profile} prefix="employment" editable={access.hr} /></section>}{access.hr && <><section className="profile-card profile-change-note"><SectionTitle title="Record this change" description="Every saved job update is appended to employment history." /><Fields fields={[{ name: 'effective_date', label: 'Effective date', type: 'date', required: true }, { name: 'reason', label: 'Reason for change', required: true, maxLength: 500, placeholder: 'Promotion, team move, contract update…' }]} values={{ effective_date: today() }} prefix="job-history" editable /></section><FormFooter busy={busy} dirty={dirty} onReset={reset} label="Save job details" /></>}</form>}
      {activeTab === 'Emergency' && <RecordSection title="Emergency contacts" description="Add people to contact in an emergency, with a clear primary contact and contact order." rows={data.emergencyContacts} fields={emergencyFields} editable={access.editable} busy={busy} dirty={dirty} setDirty={setDirty} mutate={mutate} kind="emergency_contact" payloadKey="contact" titleKey="name" subtitleKeys={['relationship', 'phone']} defaultValues={{ priority: Math.min(10, data.emergencyContacts.length + 1), is_primary: !data.emergencyContacts.length }} addLabel="Add contact" emptyTitle="No emergency contacts yet" emptyText="Add a fictional contact for review. Personal contacts are visible only to the employee and HR." icon={<HeartHandshake size={27} />} permission={permission} />}
      {activeTab === 'Education' && <RecordSection title="Education & qualifications" description="Keep a record of qualifications, institutions and study dates." rows={data.education} fields={educationFields} editable={access.editable} busy={busy} dirty={dirty} setDirty={setDirty} mutate={mutate} kind="education" payloadKey="education" titleKey="institution" subtitleKeys={['degree', 'field_of_study']} defaultValues={{ status: 'Completed' }} addLabel="Add education" emptyTitle="No education records yet" emptyText="Add qualifications when available. No education records have been imported." icon={<BookOpen size={27} />} permission={permission} />}
      {activeTab === 'Compensation' && <CompensationSection rows={data.compensation} editable={access.hr} busy={busy} dirty={dirty} setDirty={setDirty} mutate={mutate} />}
      {activeTab === 'Benefits' && <><div className="profile-inline-note"><Info size={15} /><p>These are administrative enrollment records only. Saving here does not enroll, cancel or change a policy with a provider.</p></div><RecordSection title="Benefits & enrollment" description="A private record of benefit plans and enrollment status." rows={data.benefits} fields={benefitFields} editable={access.hr} busy={busy} dirty={dirty} setDirty={setDirty} mutate={mutate} kind="benefit" payloadKey="benefit" titleKey="plan" subtitleKeys={['type', 'provider', 'coverage']} defaultValues={{ status: 'Eligible', effective_date: today() }} addLabel="Add benefit record" emptyTitle="No benefit records yet" emptyText="HR can add a fictional enrollment record for review. No provider integration is connected." icon={<HeartHandshake size={27} />} permission={access.hr ? 'HR editing only' : 'Employee + HR · read only'} /></>}
      {activeTab === 'Identifiers' && <><div className="profile-vault-notice"><span><LockKeyhole size={24} /></span><div><h3>Full identifier collection is disabled.</h3><p>Do not enter full SSNs, tax IDs, passport numbers or identity documents. A separately approved secure vault and production security review are required before full identifiers can be collected.</p><button type="button" disabled><LockKeyhole size={13} />Full identifier entry unavailable</button></div></div><RecordSection title="Identifier metadata" description="Track document type, country, expiry and an optional masked last-four reference only." rows={data.identifiers} fields={identifierFields} editable={access.editable} busy={busy} dirty={dirty} setDirty={setDirty} mutate={mutate} kind="identifier" payloadKey="identifier" titleKey="type" subtitleKeys={['country']} defaultValues={{ status: 'Pending' }} addLabel="Add metadata" emptyTitle="No identifier metadata" emptyText="Only masked metadata is supported. Full identifier values are neither collected nor displayed." icon={<ShieldCheck size={27} />} permission={permission} /></>}
      {activeTab === 'History' && <section className="profile-card"><SectionTitle title="Employment history" description="Effective-dated job snapshots. Earlier records are preserved when HR saves a new change." permission="Employee + HR only" />{data.history.length ? <ol className="profile-timeline">{data.history.map(record => { const snapshot = (record.snapshot || {}) as Item; const snapshotManager = snapshot.manager_id ? text(people.find(person => person.id === snapshot.manager_id)?.name) || 'Former or unavailable approver' : 'Not assigned'; return <li key={text(record.id)}><span className="profile-timeline-marker"><BriefcaseBusiness size={14} /></span><div className="profile-history-entry"><div className="profile-history-heading"><div><span>Effective {date(record.effective_date)}</span><h4>{text(snapshot.title) || 'Employment update'}</h4></div><span className="profile-record-status">Recorded</span></div><p>{text(record.reason) || 'Employment details updated'}</p><div className="profile-history-tags">{['department', 'location', 'employment_status'].filter(key => isPresent(snapshot[key])).map(key => <span key={key}>{text(snapshot[key])}</span>)}</div><details className="profile-history-details"><summary>View saved job details <ChevronDown size={13} /></summary><Fields fields={[...publicJobFields, ...employmentFields, ...(snapshot.source_kind ? [{ name: 'source_kind', label: 'Imported history type' }, { name: 'source_manager_name', label: 'Source reporting manager at this change' }, { name: 'source_employment_category', label: 'Source employment category' }] : [{ name: 'manager_name', label: 'Assigned leave approver at this change' }])]} values={{ ...snapshot, manager_name: snapshotManager }} prefix={`history-${text(record.id)}`} editable={false} /></details><small>Saved {date(record.created_at)}</small></div></li>; })}</ol> : <Empty icon={<History size={27} />} title="No employment changes recorded" description="The first HR job update will create a dated snapshot here. Past employment history has not been imported." />}</section>}
    </fieldset></div>
    <div className="profile-bottom-note"><ShieldCheck size={13} /><span>{access.private ? 'Private sections are limited to this employee and HR.' : 'You are viewing directory information only.'} Access is checked on every server request.</span></div>
  </div>;
}

type RecordSectionProps = {
  title: string; description: string; rows: Item[]; fields: Field[]; editable: boolean; busy: boolean; dirty: boolean;
  setDirty: (dirty: boolean) => void; mutate: Mutate; kind: string; payloadKey: string; titleKey: string; subtitleKeys: string[];
  defaultValues: Item; addLabel: string; emptyTitle: string; emptyText: string; icon: ReactNode; permission: string;
};
function RecordSection({ title, description, rows, fields, editable, busy, dirty, setDirty, mutate, kind, payloadKey, titleKey, subtitleKeys, defaultValues, addLabel, emptyTitle, emptyText, icon, permission }: RecordSectionProps) {
  const [editing, setEditing] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [localReset, setLocalReset] = useState(0);
  const [discardRequested, setDiscardRequested] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (editing) editorRef.current?.querySelector<HTMLElement>('input,select')?.focus(); }, [editing]);
  function openEditor(record: Item) { setEditing(record); setDeleting(null); setDiscardRequested(false); setLocalReset(value => value + 1); setDirty(false); }
  function cancel() { if (dirty) { setDiscardRequested(true); return; } setEditing(null); setDirty(false); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const values = readValues(event.currentTarget, fields);
    if (editing?.id) values.id = editing.id;
    if (await mutate({ action: `save_${kind}`, [payloadKey]: values }, `${kind === 'emergency_contact' ? 'Emergency contact' : kind === 'identifier' ? 'Identifier metadata' : kind === 'education' ? 'Education record' : 'Benefit record'} saved.`)) { setEditing(null); setDirty(false); }
  }
  async function remove(id: string) {
    const idKey = kind === 'emergency_contact' ? 'contact_id' : `${kind}_id`;
    if (await mutate({ action: `delete_${kind}`, [idKey]: id }, 'Record removed.')) setDeleting(null);
  }
  return <section className="profile-card profile-record-section"><SectionTitle title={title} description={description} permission={permission} />
    {!editing && editable && <div className="profile-record-toolbar"><span>{rows.length} record{rows.length === 1 ? '' : 's'}</span><button type="button" className="profile-primary" disabled={busy} onClick={() => openEditor(defaultValues)}><Plus size={15} />{addLabel}</button></div>}
    {!rows.length && !editing && <Empty icon={icon} title={emptyTitle} description={emptyText} />}
    {rows.length > 0 && <div className="profile-record-list">{rows.map(record => <article key={text(record.id)} className={`profile-record${editing?.id === record.id ? ' profile-record-editing' : ''}`}><div className="profile-record-top"><span className="profile-record-icon">{kind === 'emergency_contact' ? <HeartHandshake size={19} /> : kind === 'education' ? <BookOpen size={19} /> : kind === 'identifier' ? <IdCard size={19} /> : <HeartHandshake size={19} />}</span><div className="profile-record-title"><h4>{text(record[titleKey]) || 'Record'}{Boolean(record.is_primary) && <span className="profile-primary-label"><BadgeCheck size={11} />Primary</span>}</h4><p>{subtitleKeys.map(key => text(record[key])).filter(Boolean).join(' · ') || 'Details not added'}</p></div>{Boolean(record.status) && <span className="profile-record-status">{text(record.status)}</span>}{editable && !editing && <div className="profile-record-actions"><button type="button" title="Edit record" aria-label={`Edit ${text(record[titleKey])}`} disabled={busy} onClick={() => openEditor(record)}><Pencil size={14} /></button><button type="button" title="Remove record" aria-label={`Remove ${text(record[titleKey])}`} disabled={busy} onClick={() => setDeleting(text(record.id))}><Trash2 size={14} /></button></div>}</div>
      {kind === 'identifier' && <div className="profile-masked-id"><span>{record.last4 ? `•••• ${text(record.last4)}` : 'No last-four reference'}</span><small>Expires {date(record.expiry_date)}</small></div>}
      {kind === 'emergency_contact' && <div className="profile-record-meta"><span>Contact order: {text(record.priority) || 'Not set'}</span>{Boolean(record.alternate_phone) && <span>Alternate: {text(record.alternate_phone)}</span>}{Boolean(record.email) && <span>{text(record.email)}</span>}</div>}
      {kind === 'education' && <div className="profile-record-meta"><span>{date(record.start_date)} → {date(record.end_date)}</span>{Boolean(record.department) && <span>{text(record.department)}</span>}{Boolean(record.graduation_date) && <span>Graduated {date(record.graduation_date)}</span>}</div>}
      {kind === 'benefit' && <div className="profile-record-meta"><span>Effective {date(record.effective_date)}</span>{Boolean(record.end_date) && <span>Ends {date(record.end_date)}</span>}{isPresent(record.cost) && <span>Cost: {formatPay({ ...record, amount: record.cost })} / {text(record.period).toLowerCase()}</span>}</div>}
      {Boolean(record.address || record.notes) && <p className="profile-record-note">{text(record.address || record.notes)}</p>}
      {deleting === record.id && <div className="profile-delete-confirm" role="alert"><p>Remove this {kind === 'identifier' ? 'metadata' : kind.replaceAll('_', ' ')} record?</p><button type="button" disabled={busy} onClick={() => setDeleting(null)}>Keep record</button><button type="button" disabled={busy} className="profile-danger" onClick={() => remove(text(record.id))}>{busy ? 'Removing…' : 'Remove record'}</button></div>}
    </article>)}</div>}
    {editing && <div className="profile-record-editor" ref={editorRef}><div className="profile-editor-heading"><h4>{editing.id ? 'Edit record' : addLabel}</h4><button type="button" disabled={busy} onClick={cancel} aria-label="Cancel editing"><X size={17} /></button></div>{discardRequested && <div className="profile-inline-discard" role="alert"><p>Discard this record’s unsaved changes?</p><button type="button" onClick={() => setDiscardRequested(false)}>Keep editing</button><button type="button" onClick={() => { setEditing(null); setDirty(false); setDiscardRequested(false); }}>Discard</button></div>}<form key={localReset} onSubmit={submit} onInput={() => setDiscardRequested(false)} onChange={() => setDiscardRequested(false)}><Fields fields={fields} values={editing} prefix={kind} editable /><FormFooter busy={busy} dirty={dirty} onReset={() => { setLocalReset(value => value + 1); setDirty(false); setDiscardRequested(false); }} label={editing.id ? 'Save record' : 'Add record'} /></form></div>}
    {!editable && rows.length > 0 && <p className="profile-readonly-note"><LockKeyhole size={13} />HR maintains these records. Contact HR if something needs to change.</p>}
  </section>;
}
function CompensationSection({ rows, editable, busy, dirty, setDirty, mutate }: { rows: Item[]; editable: boolean; busy: boolean; dirty: boolean; setDirty: (dirty: boolean) => void; mutate: Mutate }) {
  const [adding, setAdding] = useState<'salary' | 'bonus' | null>(null);
  const [reset, setReset] = useState(0);
  const [discardRequested, setDiscardRequested] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const sorted = [...rows].sort((a, b) => text(b.effective_date).localeCompare(text(a.effective_date)) || text(b.created_at).localeCompare(text(a.created_at)));
  const current = sorted.find(record => record.record_type !== 'Bonus' && text(record.effective_date) <= today());
  const bonus = adding === 'bonus';
  const fields = bonus ? compensationFields.filter(field => !['frequency', 'pay_schedule', 'overtime_status'].includes(field.name)).map(field => field.name === 'amount' ? { ...field, label: 'One-time bonus amount', hint: 'Recorded for review only. This does not initiate a payment.' } : field) : compensationFields;
  useEffect(() => { if (adding) formRef.current?.querySelector<HTMLInputElement>('input')?.focus(); }, [adding]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate({ action: bonus ? 'add_bonus' : 'add_compensation', record: readValues(event.currentTarget, fields) }, bonus ? 'Bonus recorded. No payment has been initiated.' : 'Compensation change added. Previous records are preserved.')) { setAdding(null); setDirty(false); }
  }
  return <><section className="profile-card"><SectionTitle title="Compensation & bonuses" description="Base pay and one-time bonuses with effective-dated history. These records do not run payroll or initiate payments." permission={editable ? 'HR editing only' : 'Employee + HR · read only'} /><div className="profile-pay-summary"><span className="profile-pay-icon"><Wallet size={25} /></span><div><span>Current base pay</span><strong>{current ? formatPay(current) : 'Not recorded'}</strong><p>{current ? `${text(current.frequency)} · Effective ${date(current.effective_date)}` : sorted.some(record => record.record_type !== 'Bonus') ? 'Only future-dated salary records are available.' : 'No base-pay information has been imported.'}</p>{current && (Boolean(current.pay_schedule) || Boolean(current.overtime_status)) && <p>{[current.pay_schedule ? `Paid ${text(current.pay_schedule).toLowerCase()}` : '', text(current.overtime_status)].filter(Boolean).join(' · ')}</p>}</div>{editable && !adding && <div className="profile-compensation-actions"><button className="profile-primary" type="button" disabled={busy} onClick={() => { setAdding('salary'); setDirty(false); setDiscardRequested(false); }}><Plus size={15} />Pay change</button><button type="button" disabled={busy} onClick={() => { setAdding('bonus'); setDirty(false); setDiscardRequested(false); }}><Plus size={15} />Bonus</button></div>}</div></section>
    {adding && <section className="profile-card"><div className="profile-editor-heading"><div><h3>{bonus ? 'Record a one-time bonus' : 'Add compensation change'}</h3><p>Records are appended to history and cannot be edited or removed here. Use fictional amounts for review.</p></div><button type="button" disabled={busy} aria-label="Cancel compensation change" onClick={() => { if (dirty) setDiscardRequested(true); else setAdding(null); }}><X size={17} /></button></div>{discardRequested && <div className="profile-inline-discard" role="alert"><p>Discard this unsaved compensation change?</p><button type="button" onClick={() => setDiscardRequested(false)}>Keep editing</button><button type="button" onClick={() => { setAdding(null); setDirty(false); setDiscardRequested(false); }}>Discard</button></div>}<form key={reset} ref={formRef} onSubmit={submit} onInput={() => setDiscardRequested(false)} onChange={() => setDiscardRequested(false)}><Fields fields={fields} values={{ currency: current?.currency || 'USD', frequency: current?.frequency || 'Annual', pay_schedule: current?.pay_schedule || '', overtime_status: current?.overtime_status || '', effective_date: today() }} prefix="compensation" editable /><FormFooter busy={busy} dirty={dirty} onReset={() => { setReset(value => value + 1); setDirty(false); setDiscardRequested(false); }} label={bonus ? 'Record bonus' : 'Record compensation change'} /></form></section>}
    <section className="profile-card"><SectionTitle title="Compensation history" description="Newest effective dates first. Future changes take effect on the date shown." />{sorted.length ? <div className="profile-pay-history">{sorted.map(record => <article key={text(record.id)}><span className="profile-timeline-marker"><Wallet size={14} /></span><div><span className="profile-pay-type">{record.record_type === 'Bonus' ? 'ONE-TIME BONUS' : 'BASE PAY'}</span><div className="profile-pay-row"><strong>{formatPay(record)}<span>{record.record_type === 'Bonus' ? '' : ` / ${text(record.frequency).toLowerCase()}`}</span></strong><span className={`profile-record-status${text(record.effective_date) > today() ? ' profile-status-future' : ''}`}>{text(record.effective_date) > today() ? 'Future-dated' : record.record_type === 'Bonus' ? 'Recorded' : record.id === current?.id ? 'Current' : 'Previous'}</span></div><p>{text(record.reason) || 'Compensation record'}</p>{record.record_type !== 'Bonus' && (Boolean(record.pay_schedule) || Boolean(record.overtime_status)) && <p>{[record.pay_schedule ? `Paid ${text(record.pay_schedule).toLowerCase()}` : '', text(record.overtime_status)].filter(Boolean).join(' · ')}</p>}<small>Effective {date(record.effective_date)} · Recorded {date(record.created_at)}</small></div></article>)}</div> : <Empty icon={<Wallet size={27} />} title="No compensation records yet" description={editable ? 'Add a fictional base-pay or bonus record to review the effective-dated history.' : 'HR can add compensation details when available.'} />}</section>
  </>;
}
