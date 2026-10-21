import {headers} from 'next/headers';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {currentEmployee,response,failure} from './server';
import {AppError,readLimited,requireAdmin,sameOrigin} from './policy';
import {applyFormerImport,planFormerImport} from './former-import';

// Temporary owner-private Site service operation. The platform validates its
// documented service header, which never supplies or impersonates visitor ID.
// Every present visitor identity must pass the application's admin authorization.
// Caller must pin one approved snapshot; close the route after native readback.
export async function handleFormerImport(req:Request,approvedDigest:string){try{
 if(!/^[a-f0-9]{64}$/.test(approvedDigest))throw new AppError('No approved former-staff snapshot is configured.',410);
 const identityHeaders=await headers();
 const present=identityHeaders.has('oai-authenticated-user-id')||identityHeaders.has('oai-authenticated-user-email');
 const visitor=await getChatGPTUser();if(present&&!visitor)throw new AppError('Incomplete verified visitor identity.',401);
 let actorId='site-owner-service';
 if(visitor){sameOrigin(req);const me=await currentEmployee();requireAdmin(me);actorId=me.id;}
 if(req.headers.get('sec-fetch-site')==='cross-site')throw new AppError('Cross-site import rejected.',403);
 let raw:unknown;try{raw=JSON.parse(new TextDecoder().decode(await readLimited(req,256000)))}catch(e){if(e instanceof AppError)throw e;throw new AppError('Invalid import JSON.');}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AppError('Invalid former-staff import request.');
 const b=raw as Record<string,unknown>;if(Object.keys(b).some(k=>!['action','payload','expectedDigest'].includes(k)))throw new AppError('Unsupported import request field.');
 if(b.action!=='preview'&&b.action!=='apply')throw new AppError('Choose preview or apply.');
 const plan=await planFormerImport(b.payload);if(plan.digest!==approvedDigest)throw new AppError('This endpoint accepts only the approved former-staff snapshot.',409);
 if(b.action==='preview')return response({ok:true,digest:plan.digest,counts:plan.counts,completed:!!plan.completed});
 return response(await applyFormerImport(b.payload,b.expectedDigest,actorId));
 }catch(e){return failure(e)}}
