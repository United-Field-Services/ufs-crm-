import {env} from 'cloudflare:workers';
import {all,db,now,uid} from './server';
import {NOTIFICATION_KINDS,isEmailMode,type EmailMode,type NotificationKind} from './notification-kinds';

// ---------------------------------------------------------------------------
// Notification engine. One call creates the in-app notification for each person and, depending on their
// preferences, queues an email (sent straight away or in the daily digest). It never throws: a notification
// problem must not break the action that caused it.
// ---------------------------------------------------------------------------

const shared=globalThis as unknown as {__ufsOutboxDirty?:boolean};
// The worker flushes the email queue after a request that queued something, without making the person wait.
export const takeOutboxDirty=()=>{const dirty=!!shared.__ufsOutboxDirty;shared.__ufsOutboxDirty=false;return dirty};
export const markOutboxDirty=()=>{shared.__ufsOutboxDirty=true};
// Email needs the shared secret and the Convex address that sends it (see auth-convex/convex/http.ts).
export const mailEnabled=()=>Boolean(env.UFS_NOTIFY_SECRET)&&/^https:\/\/[a-z0-9-]+\.convex\.site$/.test(env.UFS_CONVEX_SITE_URL||'');

export type NotifyInput={recipients:string|string[];kind:NotificationKind;title:string;body?:string;link?:string;relatedId?:string|null;dedupeKey?:string};
type Person={id:string;email:string;name:string;data_scope:string};
type Preference={employee_id:string;in_app:number;email:string};

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character] as string));
const publicUrl=(path:string)=>`${(env.UFS_PUBLIC_URL||'').replace(/\/$/,'')}${path.startsWith('/')?path:'/'+path}`;

export function renderEmail(input:{name:string;title:string;body:string;link:string}){
 const url=publicUrl(input.link),first=input.name.split(' ')[0]||'there';
 const text=[`Hi ${first},`,'',input.title,input.body?'':null,input.body||null,'',`Open it: ${url}`,'','You can choose which emails you get under Notifications > Preferences in UFS People.'].filter(line=>line!==null).join('\n');
 const html=`<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#23334d"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4eaf2;border-radius:12px"><tr><td style="background:#163d7b;border-radius:12px 12px 0 0;padding:18px 24px;color:#ffffff;font-size:16px;font-weight:bold">UFS People</td></tr><tr><td style="padding:24px 24px 4px;font-size:14px;color:#738198">Hi ${escapeHtml(first)},</td></tr><tr><td style="padding:4px 24px 8px;font-size:19px;line-height:1.35;font-weight:bold;color:#163d7b">${escapeHtml(input.title)}</td></tr>${input.body?`<tr><td style="padding:0 24px 16px;font-size:15px;line-height:1.55">${escapeHtml(input.body).replace(/\n/g,'<br>')}</td></tr>`:''}<tr><td style="padding:8px 24px 26px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#2467ce;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:8px">Open in UFS People</a></td></tr><tr><td style="padding:14px 24px;border-top:1px solid #e4eaf2;font-size:12px;line-height:1.5;color:#738198">United Field Services &middot; UFS People<br>Choose which emails you get under Notifications &rsaquo; Preferences.</td></tr></table></td></tr></table></body></html>`;
 return {subject:input.title,text,html};
}

export function renderDigest(name:string,items:{title:string;body:string;link:string}[]){
 const first=name.split(' ')[0]||'there';
 const text=[`Hi ${first},`,'',`Here is your UFS People summary (${items.length}):`,'',...items.map(item=>`- ${item.title}${item.body?`: ${item.body.replace(/\s+/g,' ')}`:''}\n  ${publicUrl(item.link)}`),'','Choose which emails you get under Notifications > Preferences in UFS People.'].join('\n');
 const rows=items.map(item=>`<tr><td style="padding:10px 24px;border-top:1px solid #e4eaf2"><a href="${escapeHtml(publicUrl(item.link))}" style="color:#163d7b;font-weight:bold;font-size:15px;text-decoration:none">${escapeHtml(item.title)}</a>${item.body?`<div style="font-size:14px;line-height:1.5;color:#4a5b75;margin-top:2px">${escapeHtml(item.body)}</div>`:''}</td></tr>`).join('');
 const html=`<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#23334d"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4eaf2;border-radius:12px"><tr><td style="background:#163d7b;border-radius:12px 12px 0 0;padding:18px 24px;color:#ffffff;font-size:16px;font-weight:bold">UFS People &middot; your summary</td></tr><tr><td style="padding:20px 24px 12px;font-size:15px">Hi ${escapeHtml(first)}, here is what needs your attention (${items.length}):</td></tr>${rows}<tr><td style="padding:14px 24px;border-top:1px solid #e4eaf2;font-size:12px;color:#738198">United Field Services &middot; UFS People<br>Choose which emails you get under Notifications &rsaquo; Preferences.</td></tr></table></td></tr></table></body></html>`;
 return {subject:items.length===1?items[0].title:`Your UFS People summary: ${items.length} items`,text,html};
}

export async function notify(input:NotifyInput):Promise<number>{
 try{
  const ids=[...new Set(Array.isArray(input.recipients)?input.recipients:[input.recipients])].filter(Boolean);
  if(!ids.length)return 0;
  const marks=ids.map(()=>'?').join(',');
  const people=await all<Person>(`SELECT id,email,name,data_scope FROM employees WHERE id IN (${marks}) AND active=1 AND demo=0`,...ids);
  const preferences=await all<Preference>(`SELECT employee_id,in_app,email FROM notification_preferences WHERE kind=? AND employee_id IN (${marks})`,input.kind,...ids);
  const info=NOTIFICATION_KINDS[input.kind],body=(input.body||'').slice(0,1000),link=input.link||'/notifications';
  let created=0;
  for(const person of people){
   const preference=preferences.find(item=>item.employee_id===person.id);
   const inApp=info.mandatory?info.inApp:preference?!!preference.in_app:info.inApp;
   let mode:EmailMode=info.mandatory?info.email:preference&&isEmailMode(preference.email)?preference.email:info.email;
   if(mode!=='off'&&(!mailEnabled()||!person.email))mode='off';
   if(!inApp&&mode==='off')continue;
   const id=uid(),stamp=now(),key=(input.dedupeKey||`${input.kind}:${input.relatedId||id}`).slice(0,200);
   const statements=[db().prepare('INSERT OR IGNORE INTO notifications (id,data_scope,recipient_id,kind,title,body,link,related_id,dedupe_key,in_app,email_mode,digest_pending,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,person.data_scope,person.id,input.kind,input.title.slice(0,200),body,link,input.relatedId??null,key,inApp?1:0,mode,mode==='daily'?1:0,stamp)];
   if(mode==='instant'){
    const mail=renderEmail({name:person.name,title:input.title,body,link});
    statements.push(db().prepare('INSERT INTO email_outbox (id,notification_id,to_address,subject,text_body,html_body,status,attempts,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0').bind(uid(),id,person.email,mail.subject,mail.text,mail.html,'pending',0,stamp));
   }
   const results=await db().batch(statements);
   if(results[0].meta.changes){created++;if(mode==='instant')markOutboxDirty()}
  }
  return created;
 }catch(error){
  console.error('Notification not created',{kind:input.kind,problem:error instanceof Error?error.message.slice(0,120):'unknown'});
  return 0;
 }
}

// ---------------------------------------------------------------------------
// Email delivery. The Worker cannot open an SMTP connection, so the queued messages go to the Convex backend,
// which already holds the mailbox settings. Rows are claimed before sending so two runs never send the same email.
// ---------------------------------------------------------------------------
type OutboxRow={id:string;to_address:string;subject:string;text_body:string;html_body:string;attempts:number};
const MAX_ATTEMPTS=5;

async function deliver(row:OutboxRow):Promise<string|null>{
 try{
  const response=await fetch(`${env.UFS_CONVEX_SITE_URL}/notify`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.UFS_NOTIFY_SECRET}`},body:JSON.stringify({to:row.to_address,subject:row.subject,text:row.text_body,html:row.html_body})});
  return response.ok?null:`http ${response.status}`;
 }catch{return 'network'}
}

export async function flushOutbox(limit=25):Promise<number>{
 if(!mailEnabled())return 0;
 try{
  await db().prepare("UPDATE email_outbox SET status='pending' WHERE status='sending' AND claimed_at<?").bind(new Date(Date.now()-10*60000).toISOString()).run();
  const rows=await all<OutboxRow>("SELECT id,to_address,subject,text_body,html_body,attempts FROM email_outbox WHERE status='pending' AND attempts<? ORDER BY created_at LIMIT ?",MAX_ATTEMPTS,limit);
  let sent=0;
  for(const row of rows){
   const claim=await db().prepare("UPDATE email_outbox SET status='sending',claimed_at=?,attempts=attempts+1 WHERE id=? AND status='pending'").bind(now(),row.id).run();
   if(!claim.meta.changes)continue;
   const problem=await deliver(row);
   if(!problem){await db().prepare("UPDATE email_outbox SET status='sent',sent_at=?,last_error=NULL WHERE id=?").bind(now(),row.id).run();sent++}
   else await db().prepare("UPDATE email_outbox SET status=CASE WHEN attempts>=? THEN 'failed' ELSE 'pending' END,last_error=? WHERE id=?").bind(MAX_ATTEMPTS,problem,row.id).run();
  }
  return sent;
 }catch(error){console.error('Email queue run failed',{problem:error instanceof Error?error.message.slice(0,120):'unknown'});return 0}
}

// One email per person with everything they chose to receive "daily".
export async function queueDigests():Promise<number>{
 try{
  const rows=await all<{id:string;recipient_id:string;title:string;body:string;link:string;email:string;name:string}>("SELECT n.id,n.recipient_id,n.title,n.body,n.link,e.email,e.name FROM notifications n JOIN employees e ON e.id=n.recipient_id AND e.active=1 WHERE n.digest_pending=1 ORDER BY n.recipient_id,n.created_at");
  const groups=new Map<string,typeof rows>();
  for(const row of rows)groups.set(row.recipient_id,[...(groups.get(row.recipient_id)||[]),row]);
  let queued=0;
  for(const items of groups.values()){
   const ids=items.map(item=>item.id),marks=ids.map(()=>'?').join(','),stamp=now();
   const statements=[db().prepare(`UPDATE notifications SET digest_pending=0 WHERE id IN (${marks})`).bind(...ids)];
   if(items[0].email&&mailEnabled()){
    const mail=renderDigest(items[0].name,items);
    statements.push(db().prepare('INSERT INTO email_outbox (id,notification_id,to_address,subject,text_body,html_body,status,attempts,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(uid(),null,items[0].email,mail.subject,mail.text,mail.html,'pending',0,stamp));
    queued++;
   }
   await db().batch(statements);
  }
  if(queued)markOutboxDirty();
  return queued;
 }catch(error){console.error('Digest run failed',{problem:error instanceof Error?error.message.slice(0,120):'unknown'});return 0}
}
