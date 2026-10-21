// Server-only: the source aggregate and imported history must never enter a client bundle.
import {directoryActiveSql} from './employment-directory';
import {getHeadcountSnapshot} from './hr-report';
import {AppError,requireHR,scopeOf,scopeSql,type Employee} from './policy';
import {all} from './server';

export type HeadcountRosterRow={
 id:string;name:string;has_photo:boolean;photo_version:string|null;
 title:string|null;department:string|null;division:string|null;location:string|null;
 employment:string|null;work_arrangement:string|null;jobAsOf:string|null;
 jobEvidence:'historical'|'unknown'|'synthetic_current';identityEvidence:'current_profile';
};
export type HeadcountRoster={
 month:string;label:string;asOf:string;reportedCount:number;supportedCount:number;
 reconciliation:'count_match'|'partial'|'mismatch'|'unavailable';
 sourceLabel:string;verifiedAt:string;semantics:'imported_source_history'|'synthetic_current_roster';
 note:string;rows:HeadcountRosterRow[];
};
type SourceRow={
 id:string;name:string;source_id:string;photo_version:string|null;
 history_id:string|null;effective_date:string|null;snapshot:string|null;
};
type SourceEvent={date:string;kind:'status'|'job'|'manager'|'unknown';valid:boolean;value:Record<string,unknown>|null};
type SourcePerson={identity:SourceRow;events:SourceEvent[]};
type JobFields=Pick<HeadcountRosterRow,'title'|'department'|'division'|'location'|'work_arrangement'>;
const jobKeys=['title','department','division','location','work_arrangement'] as const;
const unknownJob:JobFields={title:null,department:null,division:null,location:null,work_arrangement:null};
// These are the exact ordinary source categories accepted by the completed import.
const categories=new Set(['Full-Time','Part-Time','Contractor','Furloughed','Temporary','Intern','Volunteer','Per-Diem','Other','Consultant','Fixed term contract','Trainee']);
const provenanceKeys=['source_kind','source_record','source_order'];
function ordinaryText(value:unknown):value is string{return typeof value==='string'&&value.length<=180&&!/[\u0000-\u001f\u007f]/.test(value)}
function sourceDate(value:unknown):value is string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'2100-12-31')return false;
 const date=new Date(value+'T00:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)}
function only(value:Record<string,unknown>,keys:readonly string[]){return Object.keys(value).every(key=>keys.includes(key))}
function readEvent(row:SourceRow):SourceEvent|null{
 if(!row.history_id)return null;
 // Local job edits are deliberately excluded, even when their dates precede the bar.
 if(!row.history_id.startsWith('talenthr-history:'))return null;
 const idKind=row.history_id.match(/:(status|job|manager):\d+$/)?.[1];
 let value:unknown;try{value=JSON.parse(row.snapshot||'')}catch{value=null}
 const snapshotKind=object(value)?value.source_kind:null;
 const kind=idKind&&(snapshotKind===null||snapshotKind===undefined||idKind===snapshotKind)?idKind:(!idKind&&['status','job','manager'].includes(String(snapshotKind))?snapshotKind:'unknown');
 const event:SourceEvent={date:sourceDate(row.effective_date)?row.effective_date:'',kind:kind==='status'||kind==='job'||kind==='manager'?kind:'unknown',valid:false,value:null};
 if(!object(value)||!sourceDate(row.effective_date)||!/^\/(people\/\d+|my-profile)$/.test(row.source_id)||value.source_record!==row.source_id||!Number.isSafeInteger(value.source_order)||Number(value.source_order)<0||Number(value.source_order)>99)return event;
 const expectedId='talenthr-history:'+row.source_id.slice(1).replaceAll('/',':')+':'+value.source_kind+':'+value.source_order;
 if(expectedId!==row.history_id||idKind!==snapshotKind)return event;
 if(kind==='status'){
  const terminated=value.employment_status==='Terminated';
  event.valid=terminated
   ?only(value,[...provenanceKeys,'employment_status','exit_date'])&&value.exit_date===row.effective_date
   :only(value,[...provenanceKeys,'employment','source_employment_category'])&&typeof value.employment==='string'&&categories.has(value.employment)&&value.source_employment_category===value.employment;
 }else if(kind==='job'){
  event.valid=only(value,[...provenanceKeys,...jobKeys])&&jobKeys.every(key=>ordinaryText(value[key]))&&['','On-site','Hybrid','Remote'].includes(String(value.work_arrangement));
 }else if(kind==='manager'){
  // Manager history does not establish employment or job membership.
  event.valid=true;
 }
 event.value=event.valid?value:null;return event;
}
function statusValue(event:SourceEvent){return event.value?.employment_status==='Terminated'?'Terminated':event.value?.employment}
function newest(events:SourceEvent[],asOf:string){
 const eligible=events.filter(event=>event.date&&event.date<=asOf);
 const date=eligible.reduce((latest,event)=>event.date>latest?event.date:latest,'');
 return eligible.filter(event=>event.date===date);
}
function historicalRow(person:SourcePerson,asOf:string):HeadcountRosterRow|null{
 const statuses=person.events.filter(event=>event.kind==='status'||event.kind==='unknown');
 // A malformed date cannot safely be positioned on either side of the requested cutoff.
 if(statuses.some(event=>!event.date))return null;
 const latest=newest(statuses,asOf);
 if(!latest.length||latest.some(event=>!event.valid)||new Set(latest.map(statusValue)).size!==1)return null;
 const employment=statusValue(latest[0]);if(typeof employment!=='string'||!categories.has(employment))return null;
 // A clear status after an uncertain/terminated event starts a new supported stint.
 // Do not silently carry an old job into a rehire or across unknown lifecycle data.
 const boundary=statuses.filter(event=>event.date<=asOf&&(!event.valid||statusValue(event)==='Terminated')).reduce((date,event)=>event.date>date?event.date:date,'');
 const stintStart=boundary?statuses.filter(event=>event.valid&&event.date>boundary&&event.date<=asOf&&categories.has(String(statusValue(event)))).reduce((date,event)=>!date||event.date<date?event.date:date,''):'';
 const jobs=person.events.filter(event=>event.kind==='job'||event.kind==='unknown');
 const selected=jobs.some(event=>!event.date)?[]:newest(jobs,asOf);
 const signatures=selected.map(event=>JSON.stringify(jobKeys.map(key=>event.value?.[key])));
 const hasJob=selected.length>0&&selected.every(event=>event.valid)&&new Set(signatures).size===1&&(!stintStart||selected[0].date>=stintStart);
 const job=hasJob?Object.fromEntries(jobKeys.map(key=>[key,selected[0].value![key]||null])) as JobFields:unknownJob;
 return {id:person.identity.id,name:person.identity.name,has_photo:!!person.identity.photo_version,photo_version:person.identity.photo_version,
  ...job,employment,jobAsOf:hasJob?selected[0].date:null,jobEvidence:hasJob?'historical':'unknown',identityEvidence:'current_profile'};
}
function reconciliation(reported:number,supported:number):HeadcountRoster['reconciliation']{
 return supported===reported?'count_match':supported===0?'unavailable':supported<reported?'partial':'mismatch';
}
export async function getHeadcountRoster(actor:Employee,month:string):Promise<HeadcountRoster>{
 requireHR(actor);
 const snapshot=getHeadcountSnapshot(actor),point=snapshot.rows.find(row=>row.month===month);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!point)throw new AppError('Choose a month shown in the headcount snapshot.');
 const monthEnd=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
 const asOf=monthEnd<snapshot.verifiedAt?monthEnd:snapshot.verifiedAt;
 if(scopeOf(actor)!=='live'){
  // The test chart is explicitly today's synthetic directory count, not a source history bar.
  const people=await all<{id:string;name:string;title:string;department:string;location:string;employment:string;division:string|null;work_arrangement:string|null;photo_version:string|null}>(
   "SELECT e.id,e.name,e.title,e.department,e.location,e.employment,p.division,p.work_arrangement,ph.sha256 AS photo_version FROM employees e LEFT JOIN employee_profiles p ON p.employee_id=e.id AND p.data_scope=e.data_scope LEFT JOIN source_employee_links s ON s.employee_id=e.id AND e.data_scope='live' LEFT JOIN employee_photos ph ON ph.employee_id=e.id AND ph.data_scope=e.data_scope WHERE "+scopeSql(actor,'e')+' AND '+directoryActiveSql+'=1 ORDER BY e.name,e.id');
  const rows:HeadcountRosterRow[]=people.map(person=>({...person,title:person.title||null,department:person.department||null,location:person.location||null,employment:person.employment||null,division:person.division||null,work_arrangement:person.work_arrangement||null,has_photo:!!person.photo_version,jobAsOf:null,jobEvidence:'synthetic_current',identityEvidence:'current_profile'}));
  return {month,label:point.label,asOf,reportedCount:rows.length,supportedCount:rows.length,reconciliation:'count_match',sourceLabel:snapshot.sourceLabel,verifiedAt:snapshot.verifiedAt,semantics:'synthetic_current_roster',note:'Synthetic test data only. This bar lists the current test-directory roster in your account scope, including any same-scope demo profiles; it is not a historical source roster. Names, photos and job fields are current test-profile values.',rows};
 }
 // Explicit columns only. No account IDs, email, compensation, private profile data or raw histories leave this module.
 const records=await all<SourceRow>(
  "SELECT e.id,e.name,s.source_id,ph.sha256 AS photo_version,h.id AS history_id,h.effective_date,h.snapshot FROM employees e JOIN source_employee_links s ON s.employee_id=e.id LEFT JOIN employee_photos ph ON ph.employee_id=e.id AND ph.data_scope=e.data_scope LEFT JOIN employment_history h ON h.employee_id=e.id AND h.data_scope=e.data_scope AND h.id LIKE 'talenthr-history:%' WHERE "+scopeSql(actor,'e')+' AND e.demo=0 ORDER BY e.name,e.id,h.effective_date,h.id');
 const people=new Map<string,SourcePerson>();
 for(const record of records){const person=people.get(record.id)||{identity:record,events:[]};const event=readEvent(record);if(event)person.events.push(event);people.set(record.id,person)}
 const rows=[...people.values()].map(person=>historicalRow(person,asOf)).filter((row):row is HeadcountRosterRow=>row!==null);
 return {month,label:point.label,asOf,reportedCount:point.value,supportedCount:rows.length,reconciliation:reconciliation(point.value,rows.length),sourceLabel:snapshot.sourceLabel,verifiedAt:snapshot.verifiedAt,semantics:'imported_source_history',note:'Supported by imported dated source status history at month-end, capped at the snapshot verification date. Missing, invalid or conflicting evidence is omitted; current login status and hire dates are not used to infer membership. Matching counts alone do not prove exact membership of the source headcount bar. Names and photos identify current profiles; job fields use dated source history and remain unknown where unsupported.',rows};
}
