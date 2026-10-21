'use client';
import {useId,useState} from 'react';
import {ChevronLeft,ChevronRight,Clock,Plus} from 'lucide-react';

type Balance={type:string;total:number;used:number;pending:number};
type RequestRecord={id:string;employee_id:string;type:string;start_date:string;end_date:string;days:number;year?:number;status:string};
type Props={employeeId:string;balances:Balance[];requests:RequestRecord[];year:number;selectedYear?:number;loading?:boolean;error?:string;onYearChange?:(year:number)=>void;onNavigate:()=>void;onRequest:(type?:string)=>void};
const date=(value:string)=>new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const amount=(value:number)=>Number(value.toFixed(3)).toLocaleString('en-US');
export function MyTimeOffCard({employeeId,balances,requests,year,selectedYear=year,loading=false,error='',onYearChange,onNavigate,onRequest}:Props){
 const [type,setType]=useState(''),[status,setStatus]=useState('all');
 const panelId=useId(),selected=balances.find(b=>b.type===type)||balances[0],ready=!loading&&!error&&selectedYear===year;
 const own=requests.filter(r=>r.employee_id===employeeId&&Number(r.year??r.start_date.slice(0,4))===year&&r.type===selected?.type),visible=own.filter(r=>status==='all'||r.status===status).sort((a,b)=>b.start_date.localeCompare(a.start_date)||b.id.localeCompare(a.id));
 const available=selected?Number(selected.total)-Number(selected.used)-Number(selected.pending):0;
 return <section className="td-card td-my-time" aria-labelledby="dashboard-balances-title">
 <div className="td-card-heading"><span className="td-icon"><Clock size={20}/></span><h2 id="dashboard-balances-title"><button className="td-heading-link" onClick={onNavigate}>My time off</button></h2></div>
 <div className="td-my-year"><span>Annual balance</span>{onYearChange?<div><button aria-label="Previous time-off year" disabled={loading||selectedYear<=2020} onClick={()=>onYearChange(selectedYear-1)}><ChevronLeft size={16}/></button><label><span className="sr-only">My time-off year</span><select aria-label="My time-off year" value={selectedYear} disabled={loading} onChange={e=>onYearChange(Number(e.target.value))}>{Array.from({length:81},(_,i)=>2020+i).map(y=><option key={y} value={y}>{y}</option>)}</select></label><button aria-label="Next time-off year" disabled={loading||selectedYear>=2100} onClick={()=>onYearChange(selectedYear+1)}><ChevronRight size={16}/></button></div>:<strong>{year}</strong>}</div>
 {!ready?<div className="td-my-load" role={error?'alert':'status'}><p>{error||`Loading ${selectedYear} balances…`}</p>{error&&onYearChange&&<button className="td-outline" onClick={()=>onYearChange(selectedYear)}>Retry balances</button>}</div>:<>
 <div className="td-balance-list" aria-label="Choose a leave type">{balances.map(b=><button className={'td-balance-link '+(selected?.type===b.type?'active':'')} key={b.type} aria-label={`View ${b.type} balances and requests`} aria-pressed={selected?.type===b.type} aria-controls={panelId} onClick={()=>{setType(b.type);setStatus('all')}}><span>{b.type}</span><strong>{amount(Number(b.total)-Number(b.used)-Number(b.pending))}<small> days available</small></strong><small>{amount(Number(b.used))} used · {amount(Number(b.pending))} pending</small></button>)}</div>
 {selected?<div className="td-my-detail" id={panelId}>
 <div className="td-my-detail-title"><strong>{selected.type}</strong><span>{amount(Number(selected.total))} days annual allowance</span></div>
 <div className="td-usage-track" role="img" aria-label={`${selected.type}: ${amount(Number(selected.used))} used, ${amount(Number(selected.pending))} pending, ${amount(available)} available of ${amount(Number(selected.total))} days`}><i style={{width:`${selected.total>0?Math.min(100,Math.max(0,selected.used/selected.total*100)):0}%`}}/><i className="pending" style={{width:`${selected.total>0?Math.min(Math.max(0,100-selected.used/selected.total*100),Math.max(0,selected.pending/selected.total*100)):0}%`}}/></div>
 <div className="td-usage-legend"><span><i/>Used</span><span><i className="pending"/>Pending</span><span><i className="available"/>Available</span></div>
 {available<0&&<p className="td-my-warning">Usage and pending requests exceed this year’s allowance by {amount(-available)} days.</p>}
 <div className="td-my-history-heading"><strong>My requests · {year}</strong><label><span className="sr-only">My request status</span><select aria-label="My request status" value={status} onChange={e=>setStatus(e.target.value)}>{['all','pending','approved','rejected','cancelled'].map(s=><option value={s} key={s}>{s==='all'?'All statuses':s[0].toUpperCase()+s.slice(1)}</option>)}</select></label></div>
 {visible.length?<div className="td-my-requests">{visible.slice(0,3).map(r=><button key={r.id} onClick={onNavigate} aria-label={`View ${r.type} request for ${date(r.start_date)}, ${r.status}`}><span><strong>{date(r.start_date)}{r.end_date!==r.start_date?' – '+date(r.end_date):''}</strong><small>{amount(Number(r.days))} {Number(r.days)===1?'day':'days'}</small></span><span className={'td-request-status '+r.status}>{r.status}</span><ChevronRight size={14}/></button>)}</div>:<p className="td-my-empty">No {status==='all'?'':status+' '}{selected.type.toLowerCase()} requests in {year}.</p>}
 {visible.length>3&&<button className="td-text-button" onClick={onNavigate}>View all {visible.length} requests</button>}
 <button className="td-my-request-button" onClick={()=>onRequest(selected.type)}><Plus size={15}/>Request {selected.type.toLowerCase()}</button>
 </div>:<p className="td-my-empty">No balances are available for this year.</p>}
 <p className="td-my-footnote">UFS records · Available = allowance − approved − pending. Imported TalentHR balances and leave history are not included.</p>
 </>}
 <button className="td-card-link" onClick={onNavigate}>View all time-off requests <ChevronRight size={15}/></button>
 </section>
}
