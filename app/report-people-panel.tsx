'use client';
import {useEffect,useState} from 'react';
import {ChevronRight,Info,Search,Users} from 'lucide-react';
import {apiFetch} from '../lib/auth-fetch';
import {EmployeeAvatar} from './employee-avatar';

type Person={id:string;name:string;title?:string|null;department?:string|null;division?:string|null;location?:string|null;has_photo?:number|boolean;photo_version?:string|null;jobAsOf?:string|null;jobEvidence?:string;[key:string]:unknown};
export type ReportSelection={label:string;ids:string[]}|{month:string};
type Roster={month:string;label:string;asOf:string;reportedCount:number;supportedCount:number;reconciliation:string;sourceLabel:string;verifiedAt:string;semantics:string;note:string;rows:Person[]};
const date=(value:string)=>new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
export function ReportPeoplePanel({selection,people,onProfile,onAccessLost}:{selection:ReportSelection;people:Person[];onProfile:(person:Person)=>void;onAccessLost:()=>void}){
 const month='month' in selection?selection.month:null;
 const [result,setResult]=useState<Roster|null>(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!month)return;let active=true;const abort=new AbortController();
  async function load(){try{const response=await apiFetch('/api/headcount-roster?month='+encodeURIComponent(month!),{signal:abort.signal});if(!active)return;if(response.status===401||response.status===403){onAccessLost();return}const data=await response.json() as Roster&{error?:string};if(!active)return;if(!response.ok)throw new Error(data.error||'Could not load the period roster.');setResult(data)}catch(e){if(active)setError((e as Error).message)}}
  load();return()=>{active=false;abort.abort()};
 },[month,retry,onAccessLost]);
 const current='ids' in selection?people.filter(p=>selection.ids.includes(p.id)):[],rows=month?result?.rows||[]:current;
 const filtered=rows.filter(p=>`${p.name} ${p.title||''} ${p.department||''} ${p.division||''} ${p.location||''}`.toLowerCase().includes(query.toLowerCase()));
 return <div className="td-roster-panel"><span className="icon-tile blue"><Users/></span><h2 id="modal-title">{month?`${result?.label||month} employees`:('label' in selection?selection.label:'Employees')}</h2>
 {month&&!result&&!error?<p role="status" className="td-roster-loading">Loading the period’s supported employee records…</p>:error?<div role="alert" className="td-roster-warning"><p>{error}</p><button className="td-outline" onClick={()=>{setError('');setResult(null);setRetry(value=>value+1)}}>Retry employee list</button></div>:<>
 {result?<><div className="td-roster-counts"><div><strong>{result.reportedCount}</strong><span>in the source bar</span></div><div><strong>{result.supportedCount}</strong><span>supported employee records</span></div></div><p className={'td-roster-warning '+(result.reconciliation==='count_match'?'matched':'')}><Info size={16}/><span><strong>{result.reconciliation==='count_match'?'Counts reconcile':result.reconciliation==='partial'?'Partial employee list':result.reconciliation==='mismatch'?'Counts need reconciliation':'Employee list unavailable'}</strong>{result.note}</span></p><p className="td-roster-source">{result.semantics==='synthetic_current_roster'?'Synthetic current roster':`Employment evidence as of ${date(result.asOf)}`} · {result.sourceLabel} snapshot verified {date(result.verifiedAt)}. Names and photos identify current UFS profiles.</p></>:<p className="td-roster-source">{current.length} current UFS profiles match this bar.</p>}
 {rows.length>0&&<><label className="td-directory-search"><Search size={16}/><input autoComplete="off" aria-label="Search employees in selected period" placeholder="Search this employee list…" value={query} onChange={event=>setQuery(event.target.value)}/></label><p className="td-roster-list-count" aria-live="polite">{filtered.length} of {rows.length} {rows.length===1?'employee':'employees'} shown</p><div className="td-roster-list">{filtered.map(person=><button className="td-person-row" key={person.id} onClick={()=>onProfile(person)} aria-label={`Open ${person.name} profile`}><EmployeeAvatar className="td-avatar" person={person}/><span className="td-person-copy"><strong>{person.name}</strong><small>{[person.title,person.department,person.location].filter(Boolean).join(' · ')||(result?'Historical job details unavailable':'Job details not recorded')}</small>{result&&<small className="td-roster-evidence">{person.jobEvidence==='historical'&&person.jobAsOf?`Job details effective ${date(person.jobAsOf)}`:person.jobEvidence==='synthetic_current'?'Synthetic current job details':'No dated job details for this period'}</small>}</span><ChevronRight size={16}/></button>)}</div>{!filtered.length&&<p className="td-my-empty">No employee matches that search.</p>}</>}
 {!rows.length&&<p className="td-my-empty">{result?'No employee memberships can be supported from the available records for this period.':'No employees match this bar.'}</p>}
 </>}
 </div>
}
