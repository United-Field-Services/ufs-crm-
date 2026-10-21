import {headers} from 'next/headers';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {currentEmployee,response,failure} from './server';
import {AppError,readLimited,requireAdmin,sameOrigin} from './policy';
import {applyCurrentHistoryImport,planCurrentHistoryImport} from './current-history-import';

// Same bounded owner-private service boundary as the former profile transfer.
// This endpoint may INSERT only dated ordinary history, never update profiles.
export async function handleCurrentHistoryImport(req:Request,approvedDigest:string){try{
 if(!/^[a-f0-9]{64}$/.test(approvedDigest))throw new AppError('No approved current-history snapshot is configured.',410);
 const h=await headers(),present=h.has('oai-authenticated-user-id')||h.has('oai-authenticated-user-email'),visitor=await getChatGPTUser();
 if(present&&!visitor)throw new AppError('Incomplete verified visitor identity.',401);
 let actorId='site-owner-service';if(visitor){sameOrigin(req);const me=await currentEmployee();requireAdmin(me);actorId=me.id;}
 if(req.headers.get('sec-fetch-site')==='cross-site')throw new AppError('Cross-site import rejected.',403);
 let raw:unknown;try{raw=JSON.parse(new TextDecoder().decode(await readLimited(req,256000)))}catch(e){if(e instanceof AppError)throw e;throw new AppError('Invalid history import JSON.');}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AppError('Invalid history import request.');
 const b=raw as Record<string,unknown>;if(Object.keys(b).some(k=>!['action','payload','expectedDigest'].includes(k)))throw new AppError('Unsupported import request field.');
 if(b.action!=='preview'&&b.action!=='apply')throw new AppError('Choose preview or apply.');
 const p=await planCurrentHistoryImport(b.payload);if(p.digest!==approvedDigest)throw new AppError('Only the approved current-history snapshot can use this endpoint.',409);
 if(b.action==='preview')return response({ok:true,digest:p.digest,counts:p.counts,completed:!!p.completed});
 return response(await applyCurrentHistoryImport(b.payload,b.expectedDigest,actorId));
 }catch(e){return failure(e)}}
