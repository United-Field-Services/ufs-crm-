import {bucket,currentEmployee,db,first,now,uid,response,failure} from '../../../../lib/server';
import {AppError,loginEligibleSql,isHR,sameOrigin,jsonBody,safeText,validDate,scopeOf,scopeSql,type Employee} from '../../../../lib/policy';
export const dynamic='force-dynamic';
type Doc={id:string;owner_id:string;visibility:string;archived:number;object_key:string;name:string;mime:string;pinned:number;data_scope:string};
const supportedRoles="'employee','manager','hr_manager','hiring_manager','admin'";
const storagePrefix=(me:Employee)=>scopeOf(me)==='live'?'documents/':'test/qa-bots-v1/documents/';
const validKey=(me:Employee,d:Doc)=>d.object_key===`${storagePrefix(me)}${d.owner_id}/${d.id}`;
const keySql=(me:Employee,alias:string)=>`${alias}.object_key = '${storagePrefix(me)}' || ${alias}.owner_id || '/' || ${alias}.id`;
// The document, its owner and the current viewer must share a scope, both before and after storage access.
async function readableDocument(me:Employee,id:string){return first<Doc>(`SELECT d.* FROM documents d JOIN employees viewer ON viewer.id = ? AND viewer.user_id IS ? AND ${scopeSql(me,'viewer')} JOIN employees owner ON owner.id=d.owner_id AND ${scopeSql(me,'owner')} WHERE d.id = ? AND d.archived = 0 AND ${scopeSql(me,'d')} AND ${keySql(me,'d')} AND ${loginEligibleSql('viewer')} AND viewer.role IN (${supportedRoles}) AND (viewer.role IN ('hr_manager','admin') OR d.visibility = 'company' OR (d.visibility = 'personal' AND (d.owner_id = viewer.id OR (viewer.role = 'manager' AND EXISTS (SELECT 1 FROM leave_requests l JOIN employees subject ON subject.id=l.employee_id AND ${scopeSql(me,'subject')} WHERE l.attachment_id = d.id AND l.employee_id=d.owner_id AND l.required_manager_id = viewer.id AND ${scopeSql(me,'l')})))))`,me.id,me.user_id,id)}
// Ownership grants self-service writes only to personal files; company and HR files remain HR-managed.
const writeAccess=(me:Employee)=>`${scopeSql(me,'documents')} AND ${keySql(me,'documents')} AND EXISTS (SELECT 1 FROM employees owner WHERE owner.id=documents.owner_id AND ${scopeSql(me,'owner')}) AND EXISTS (SELECT 1 FROM employees editor WHERE editor.id = ? AND editor.user_id IS ? AND ${scopeSql(me,'editor')} AND ${loginEligibleSql('editor')} AND editor.role IN (${supportedRoles}) AND (editor.role IN ('hr_manager','admin') OR (documents.visibility = 'personal' AND documents.owner_id = editor.id)))`;
function audit(me:Employee,action:string,id:string){return db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at,data_scope) SELECT ?,?,?,?,?,? WHERE changes() > 0').bind(uid(),me.id,action,id,now(),scopeOf(me))}
export async function GET(_req:Request,ctx:{params:Promise<{id:string}>}){try{
 const me=await currentEmployee(),id=safeText((await ctx.params).id,'Document',100),d=await readableDocument(me,id);if(!d||!validKey(me,d))throw new AppError('Document not found.',404);
 const obj=await bucket().get(d.object_key);if(!obj)throw new AppError('Document is unavailable.',404);
 const current=await readableDocument(me,id);if(!current||!validKey(me,current)||current.object_key!==d.object_key)throw new AppError('Document not found.',404);
 const extension=current.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g,'').slice(0,10)||'bin';
 return new Response(obj.body,{headers:{'Content-Type':current.mime,'Content-Disposition':`attachment; filename="download.${extension}"; filename*=UTF-8''${encodeURIComponent(current.name.toWellFormed())}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }catch(e){return failure(e)}}
export async function DELETE(req:Request,ctx:{params:Promise<{id:string}>}){try{
 sameOrigin(req);const me=await currentEmployee(),id=safeText((await ctx.params).id,'Document',100);
 const result=await db().batch([db().prepare(`UPDATE documents SET archived = 1 WHERE id = ? AND archived = 0 AND ${writeAccess(me)}`).bind(id,me.id,me.user_id),audit(me,'Archived document',id)]);
 if(!result[0].meta.changes)throw new AppError('Document not found.',404);return response({ok:true});
 }catch(e){return failure(e)}}

export async function PATCH(req:Request,ctx:{params:Promise<{id:string}>}){try{
 sameOrigin(req);const me=await currentEmployee(),id=safeText((await ctx.params).id,'Document',100),b=await jsonBody(req);
 if('data_scope' in b||'scope' in b)throw new AppError('Data scope is managed by the server.',403);
 const d=await first<Doc>(`SELECT * FROM documents WHERE id=? AND archived=0 AND ${writeAccess(me)}`,id,me.id,me.user_id);if(!d||!validKey(me,d))throw new AppError('Document not found.',404);
 const name=safeText(b.name,'File name',180);if(name.split('.').pop()?.toLowerCase()!==d.name.split('.').pop()?.toLowerCase()||/[\r\n\x00-\x1f]/.test(name)||!name.isWellFormed())throw new AppError('Keep the original file extension and use a valid file name.');const folder=safeText(b.folder||'Unsorted','Folder',100),expiry=b.expiryDate?validDate(b.expiryDate):null;
 if(b.pinned===true&&(!isHR(me)||d.visibility!=='company'))throw new AppError('Only HR may pin company resources.',403);
 const changePin=isHR(me)&&b.pinned!==undefined;
 const result=await db().batch([db().prepare(`UPDATE documents SET name=?,folder=?,expiry_date=?,pinned=CASE WHEN ? = 1 THEN ? ELSE pinned END WHERE id=? AND archived=0 AND ${writeAccess(me)} AND (? = 0 OR EXISTS (SELECT 1 FROM employees WHERE id = ? AND ${scopeSql(me,'employees')} AND role IN ('hr_manager','admin'))) AND (? = 0 OR visibility = 'company')`).bind(name,folder,expiry,changePin?1:0,b.pinned===true?1:0,id,me.id,me.user_id,changePin?1:0,me.id,b.pinned===true?1:0),audit(me,'Updated document metadata',id)]);
 if(!result[0].meta.changes)throw new AppError('Document not found or your access changed.',404);return response({ok:true});
 }catch(e){return failure(e)}}
