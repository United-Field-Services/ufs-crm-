import {bucket,currentEmployee,db,now,uid,response,failure,first} from '../../../lib/server';
import {AppError,loginEligibleSql,isHR,sameOrigin,readLimited,safeText,validDate,isEmployeeRole,scopeOf,scopeSql,type Employee} from '../../../lib/policy';
export const dynamic='force-dynamic';
const mimeByExt:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain'};
export async function POST(req:Request){try{
 sameOrigin(req);const me=await currentEmployee();if(Number(req.headers.get('content-length')||0)>11*1024*1024)throw new AppError('Maximum upload size is 10 MB.');
 const bytesBody=await readLimited(req,11*1024*1024);let form:FormData;try{form=await new Response(bytesBody,{headers:{'Content-Type':req.headers.get('content-type')||''}}).formData()}catch{throw new AppError('Invalid file upload.')}if(form.has('data_scope')||form.has('scope'))throw new AppError('Data scope is managed by the server.',403);const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('Choose a non-empty file up to 10 MB.');
 const name=file.name.replace(/[\r\n\x00-\x1f]/g,'').slice(0,180),ext=name.split('.').pop()?.toLowerCase()||'',mime=mimeByExt[ext];if(!mime)throw new AppError('Allowed files: PDF, DOCX, PNG, JPG, or TXT.');
 const bytes=new Uint8Array(await file.arrayBuffer());const ascii=new TextDecoder().decode(bytes.slice(0,5));
 if((ext==='pdf'&&ascii!=='%PDF-')||(ext==='docx'&&!(bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4))||(ext==='png'&&!(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71))||(['jpg','jpeg'].includes(ext)&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))||(ext==='txt'&&bytes.includes(0)))throw new AppError('The file content does not match its extension.');
 const requestedOwner=form.get('employeeId');const ownerId=isHR(me)&&requestedOwner?safeText(requestedOwner,'Employee'):me.id;if(!await first(`SELECT id FROM employees WHERE id=? AND active=1 AND ${scopeSql(me,'employees')}`,ownerId))throw new AppError('Choose an active employee.',404);
 const count=await first<{n:number}>(`SELECT COUNT(*) n FROM documents WHERE owner_id = ? AND archived = 0 AND ${scopeSql(me,'documents')}`,ownerId);if((count?.n||0)>=100)throw new AppError('Your review workspace limit is 100 active files.');
 const visibility=String(form.get('visibility')||'personal');if(!['personal','company','hr'].includes(visibility))throw new AppError('Choose a valid document visibility.');if(visibility!=='personal'&&!isHR(me))throw new AppError('Only HR can publish company documents or store HR-confidential files.',403);
 const category=String(form.get('category')||'General');if(!['General','Policy','Contract','Leave attachment','Onboarding'].includes(category))throw new AppError('Choose a valid document category.');
 const folder=safeText(form.get('folder')||'Unsorted','Folder',100),expiry=form.get('expiryDate')?validDate(form.get('expiryDate')):null,pinned=isHR(me)&&visibility==='company'&&form.get('pinned')==='on'?1:0;
 const scope=scopeOf(me),prefix=scope==='live'?'documents/':'test/qa-bots-v1/documents/';
 const current=await first<Employee>(`SELECT * FROM employees WHERE id=? AND user_id IS ? AND ${loginEligibleSql('employees')} AND ${scopeSql(me,'employees')}`,me.id,me.user_id);
 if(!current||!isEmployeeRole(current.role)||((ownerId!==me.id||visibility!=='personal')&&!isHR(current)))throw new AppError('Your upload access changed. Refresh and try again.',403);
 const id=uid(),key=`${prefix}${ownerId}/${id}`;await bucket().put(key,bytes,{httpMetadata:{contentType:mime}});
 try{
  const stored=await db().batch([
   db().prepare(`INSERT INTO documents (id,owner_id,name,object_key,category,visibility,mime,size,uploaded_at,folder,expiry_date,pinned,data_scope) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM documents WHERE owner_id = ? AND archived = 0 AND ${scopeSql(me,'documents')}) < 100 AND EXISTS (SELECT 1 FROM employees uploader WHERE uploader.id = ? AND uploader.user_id IS ? AND ${loginEligibleSql('uploader')} AND ${scopeSql(me,'uploader')} AND uploader.role IN ('employee','manager','hr_manager','hiring_manager','admin') AND (uploader.id = ? OR uploader.role IN ('hr_manager','admin')) AND (? = 'personal' OR uploader.role IN ('hr_manager','admin'))) AND EXISTS (SELECT 1 FROM employees WHERE id = ? AND active = 1 AND ${scopeSql(me,'employees')})`).bind(id,ownerId,name,key,category,visibility,mime,file.size,now(),folder,expiry,pinned,scope,ownerId,me.id,me.user_id,ownerId,visibility,ownerId),
   db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) SELECT ?,?,?,?,?,? WHERE changes() > 0').bind(uid(),me.id,'Uploaded document',id,now(),scope)
  ]);
  if(!stored[0].meta.changes){
   const actor=await first<Employee>(`SELECT * FROM employees WHERE id = ? AND user_id IS ? AND ${loginEligibleSql('employees')} AND ${scopeSql(me,'employees')}`,me.id,me.user_id);
   if(!actor?.active||!isEmployeeRole(actor.role)||((ownerId!==me.id||visibility!=='personal')&&!isHR(actor)))throw new AppError('Your upload access changed. Refresh and try again.',403);
   if(!await first(`SELECT id FROM employees WHERE id = ? AND active = 1 AND ${scopeSql(me,'employees')}`,ownerId))throw new AppError('Choose an active employee.',404);
   throw new AppError('Your review workspace limit is 100 active files.');
  }
 }catch(e){await bucket().delete(key);throw e}
 return response({ok:true,id});
 }catch(e){return failure(e)}}
