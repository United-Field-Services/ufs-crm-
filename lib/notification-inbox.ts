import {all,first} from './server';
import type {InboxItem} from './notification-kinds';


// A person's own in-app notifications, newest first, plus how many are unread.
export async function inbox(recipientId:string,limit=20){
 const [items,count]=await Promise.all([
  all<InboxItem>('SELECT id,kind,title,body,link,created_at,read_at FROM notifications WHERE recipient_id=? AND in_app=1 ORDER BY created_at DESC LIMIT ?',recipientId,limit),
  first<{n:number}>('SELECT COUNT(*) n FROM notifications WHERE recipient_id=? AND in_app=1 AND read_at IS NULL',recipientId),
 ]);
 return {items,unread:count?.n??0};
}
