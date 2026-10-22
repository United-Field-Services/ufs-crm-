'use client';
import {apiFetch} from '../lib/auth-fetch';
import {useCallback,useEffect,useState} from 'react';
import {Bell,Check,CheckCheck,Info,Mail,Trash2} from 'lucide-react';
import './notifications.css';
import type {EmailMode,InboxItem} from '../lib/notification-kinds';

type Preference={kind:string;label:string;description:string;group:string;mandatory:boolean;optIn:boolean;inApp:boolean;email:EmailMode};
type Payload={items:InboxItem[];unread:number;preferences:Preference[];emailAvailable:boolean;error?:string;message?:string};
type Props={onNavigate:(link:string)=>void;onChanged:()=>Promise<void>};

export function timeAgo(stamp:string,reference=Date.now()){
 const minutes=Math.max(0,Math.round((reference-Date.parse(stamp))/60000));
 if(minutes<1)return 'Just now';
 if(minutes<60)return `${minutes} min ago`;
 const hours=Math.round(minutes/60);
 if(hours<24)return `${hours} ${hours===1?'hour':'hours'} ago`;
 const days=Math.round(hours/24);
 if(days<7)return `${days} ${days===1?'day':'days'} ago`;
 return new Date(stamp).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

const emailLabels:Record<EmailMode,string>={instant:'Email me right away',daily:'Daily summary email',off:'No email'};

export function NotificationsPage({onNavigate,onChanged}:Props){
 const [data,setData]=useState<Payload|null>(null),[tab,setTab]=useState<'Inbox'|'Preferences'>('Inbox'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[draft,setDraft]=useState<Preference[]>([]),[dirty,setDirty]=useState(false);

 const load=useCallback(async()=>{
  try{
   const response=await apiFetch('/api/notifications',{cache:'no-store'}),body=await response.json() as Payload;
   if(!response.ok)throw new Error(body.error||'Notifications could not be loaded.');
   setData(body);setDraft(body.preferences);setDirty(false);setError('');
  }catch(cause){setError((cause as Error).message)}
 },[]);
 useEffect(()=>{void Promise.resolve().then(load)},[load]);

 async function post(body:Record<string,unknown>,success?:string){
  setBusy(true);setError('');setMessage('');
  try{
   const response=await apiFetch('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json() as {error?:string;message?:string};
   if(!response.ok)throw new Error(result.error||'That did not work. Please try again.');
   setMessage(result.message||success||'');
   await Promise.all([load(),onChanged()]);
   return true;
  }catch(cause){setError((cause as Error).message);return false}
  finally{setBusy(false)}
 }

 function change(kind:string,patch:Partial<Pick<Preference,'inApp'|'email'>>){setDraft(draft.map(item=>item.kind===kind?{...item,...patch}:item));setDirty(true);setMessage('')}
 async function open(item:InboxItem){
  if(!item.read_at)await post({action:'markRead',id:item.id});
  onNavigate(item.link);
 }

 if(!data)return <div className="panel notify-loading" aria-busy={!error}>{error?<><p role="alert">{error}</p><button className="primary" onClick={()=>void load()}>Try again</button></>:<p role="status">Loading notifications…</p>}</div>;
 const groups=[...new Set(draft.map(item=>item.group))];
 return <div className="notify-page">
  <div className="toolbar"><div className="tabs" role="tablist">{(['Inbox','Preferences'] as const).map(name=><button key={name} role="tab" aria-selected={tab===name} className={tab===name?'active':''} onClick={()=>setTab(name)}>{name}{name==='Inbox'&&data.unread>0?` (${data.unread})`:''}</button>)}</div>
   {tab==='Inbox'&&<div className="notify-tools"><button className="subtle" disabled={busy||!data.unread} onClick={()=>void post({action:'markAllRead'})}><CheckCheck size={15}/>Mark all as read</button><button className="subtle" disabled={busy||!data.items.some(item=>item.read_at)} onClick={()=>void post({action:'clearRead'},'Cleared read notifications.')}><Trash2 size={15}/>Clear read</button></div>}</div>
  {error&&<div role="alert" className="form-error"><Info size={16}/><span>{error}</span></div>}
  {message&&<div role="status" className="notify-success"><Check size={16}/>{message}</div>}
  {tab==='Inbox'&&<section className="panel">{data.items.length?<ul className="notify-list">{data.items.map(item=><li key={item.id} className={item.read_at?'':'unread'}><button onClick={()=>void open(item)}><span className="notify-dot" aria-hidden="true"/><span className="notify-text"><strong>{item.title}</strong>{item.body&&<small>{item.body}</small>}<em>{timeAgo(item.created_at)}{item.read_at?'':' · New'}</em></span></button></li>)}</ul>:<div className="empty"><Bell size={26}/><strong>You’re all caught up</strong><p>New requests, reminders and updates will appear here.</p></div>}</section>}
  {tab==='Preferences'&&<section className="panel notify-prefs">
   <p className="policy-note"><Info size={14}/>Choose how you hear about each thing. In-app notifications appear in the bell and in your inbox. Emails can come right away or in one daily summary at 8 am (Pacific time).{!data.emailAvailable&&' Email is not set up on this site yet, so only in-app notifications are sent.'}</p>
   {groups.map(group=><div key={group} className="notify-group"><h3>{group}</h3>{draft.filter(item=>item.group===group).map(item=><div key={item.kind} className="notify-pref"><div><strong>{item.label}</strong><small>{item.description}{item.optIn?' Off until you turn it on.':''}</small></div><label className="notify-check"><input type="checkbox" checked={item.inApp} disabled={item.mandatory||busy} onChange={event=>change(item.kind,{inApp:event.target.checked})}/><span>In-app</span></label><label className="notify-mode"><span className="sr-only">Email for {item.label}</span><select value={item.email} disabled={item.mandatory||busy||!data.emailAvailable} onChange={event=>change(item.kind,{email:event.target.value as EmailMode})}>{(Object.keys(emailLabels) as EmailMode[]).map(mode=><option key={mode} value={mode}>{emailLabels[mode]}</option>)}</select></label></div>)}</div>)}
   <div className="notify-actions"><button className="primary" disabled={busy||!dirty} onClick={()=>void post({action:'savePreferences',preferences:draft.map(({kind,inApp,email})=>({kind,inApp,email}))})}>{busy?'Saving…':'Save choices'}</button>{data.emailAvailable&&<button className="subtle" disabled={busy} onClick={()=>void post({action:'sendTest'})}><Mail size={15}/>Send me a test email</button>}</div>
  </section>}
 </div>;
}
