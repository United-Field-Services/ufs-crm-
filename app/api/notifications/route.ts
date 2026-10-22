import {all,currentEmployee,db,now,response,failure} from '../../../lib/server';
import {AppError,isHR,jsonBody,sameOrigin,safeText} from '../../../lib/policy';
import {NOTIFICATION_KINDS,isEmailMode,isNotificationKind,kindList,type EmailMode} from '../../../lib/notification-kinds';
import {mailEnabled,notify,flushOutbox} from '../../../lib/notifications';
import {inbox} from '../../../lib/notification-inbox';
export const dynamic='force-dynamic';

type Stored={kind:string;in_app:number;email:string};

// The signed-in person's own notifications and preferences. Nobody can read or change anyone else's.
export async function GET(){try{
 const me=await currentEmployee(),hr=isHR(me);
 const [items,stored]=await Promise.all([inbox(me.id,60),all<Stored>('SELECT kind,in_app,email FROM notification_preferences WHERE employee_id=?',me.id)]);
 const preferences=kindList.filter(kind=>hr||!NOTIFICATION_KINDS[kind].hrOnly).map(kind=>{
  const info=NOTIFICATION_KINDS[kind],saved=stored.find(row=>row.kind===kind);
  return {kind,label:info.label,description:info.description,group:info.group,mandatory:!!info.mandatory,optIn:!!info.optIn,inApp:info.mandatory?info.inApp:saved?!!saved.in_app:info.inApp,email:(info.mandatory?info.email:saved&&isEmailMode(saved.email)?saved.email:info.email) as EmailMode};
 });
 return response({...items,preferences,emailAvailable:mailEnabled()});
}catch(e){return failure(e)}}

export async function POST(req:Request){try{
 sameOrigin(req);const me=await currentEmployee(),b=await jsonBody(req),action=b.action;
 if(action==='markRead'){
  const id=safeText(b.id,'Notification',100);
  await db().prepare('UPDATE notifications SET read_at=? WHERE id=? AND recipient_id=? AND read_at IS NULL').bind(now(),id,me.id).run();
  return response({ok:true});
 }
 if(action==='markAllRead'){
  await db().prepare('UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL').bind(now(),me.id).run();
  return response({ok:true});
 }
 if(action==='clearRead'){
  await db().prepare('DELETE FROM notifications WHERE recipient_id=? AND read_at IS NOT NULL').bind(me.id).run();
  return response({ok:true});
 }
 if(action==='savePreferences'){
  if(!Array.isArray(b.preferences)||b.preferences.length>40)throw new AppError('Send the notification choices to save.');
  const statements=[];
  for(const entry of b.preferences as Record<string,unknown>[]){
   if(!entry||typeof entry!=='object'||!isNotificationKind(entry.kind))throw new AppError('Unknown notification type.');
   const info=NOTIFICATION_KINDS[entry.kind];
   if(info.mandatory)continue; // security notices always stay on
   if(typeof entry.inApp!=='boolean'||!isEmailMode(entry.email))throw new AppError('Choose in-app on or off, and instant, daily or no email.');
   statements.push(db().prepare('INSERT INTO notification_preferences (employee_id,kind,in_app,email) VALUES (?,?,?,?) ON CONFLICT(employee_id,kind) DO UPDATE SET in_app=excluded.in_app,email=excluded.email').bind(me.id,entry.kind,entry.inApp?1:0,entry.email));
  }
  if(statements.length)await db().batch(statements);
  return response({ok:true,message:'Notification choices saved.'});
 }
 if(action==='sendTest'){
  if(!mailEnabled())throw new AppError('Email is not set up on this site yet, so a test email cannot be sent.',503);
  const sent=await notify({recipients:me.id,kind:'test',title:'This is a test notification from UFS People',body:'If you can read this email, your notifications are working.',link:'/notifications',dedupeKey:`test:${me.id}:${now().slice(0,16)}`});
  if(!sent)throw new AppError('A test was just sent. Wait a minute before sending another.',429);
  await flushOutbox(5);
  return response({ok:true,message:'Test sent. Check your inbox and the bell.'});
 }
 throw new AppError('Unknown action.');
}catch(e){return failure(e)}}
