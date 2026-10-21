import {bucket,currentEmployee,failure} from '../../../../lib/server';
import {AppError,safeText} from '../../../../lib/policy';
import {readablePhoto,photoStorageAllowed,PHOTO_MAX_BYTES} from '../../../../lib/photos';
export const dynamic='force-dynamic';
export async function GET(_req:Request,ctx:{params:Promise<{id:string}>}){try{
 const me=await currentEmployee(),id=safeText((await ctx.params).id,'Employee',100),photo=await readablePhoto(me,id);if(!photo)throw new AppError('Photo not found.',404);
 if(!photoStorageAllowed(me,photo.object_key))throw new AppError('Photo is unavailable.',404);
 if(!['image/jpeg','image/png'].includes(photo.mime)||photo.size<1||photo.size>PHOTO_MAX_BYTES)throw new AppError('Photo is unavailable.',404);
 const object=await bucket().get(photo.object_key);if(!object)throw new AppError('Photo is unavailable.',404);
 // Recheck live visibility/activation/role after storage awaits to prevent stale access.
 const current=await readablePhoto(me,id);if(!current||current.object_key!==photo.object_key||current.sha256!==photo.sha256)throw new AppError('Photo not found.',404);
 return new Response(object.body,{headers:{'Content-Type':photo.mime,'Content-Length':String(photo.size),'Content-Disposition':'inline; filename="avatar.'+(photo.mime==='image/png'?'png':'jpg')+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cross-Origin-Resource-Policy':'same-origin'}});
 }catch(error){return failure(error)}}
