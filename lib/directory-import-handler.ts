import {headers} from 'next/headers';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {currentEmployee,response,failure} from './server';
import {AppError,readLimited,requireAdmin,sameOrigin} from './policy';
import {applyImport,planImport} from './directory-import';
// TEMPORARY one-time organization import. The Site is confirmed owner-private with one owner.
// Sites dispatch validates existing service access before this route. It is not visitor identity.
// Never enable this route on a public/shared Site; remove it after native DB reconciliation.
export async function handleDirectoryImport(req:Request){try{
 const identityHeaders=await headers();const hasIdentityHeader=identityHeaders.has('oai-authenticated-user-id')||identityHeaders.has('oai-authenticated-user-email');
 const visitor=await getChatGPTUser();if(hasIdentityHeader&&!visitor)throw new AppError('Incomplete verified visitor identity.',401);let actorId='site-owner-service';
 if(visitor){sameOrigin(req);const me=await currentEmployee();requireAdmin(me);actorId=me.id}
 if(req.headers.get('sec-fetch-site')==='cross-site')throw new AppError('Cross-site import rejected.',403);
 let input:unknown;try{input=JSON.parse(new TextDecoder().decode(await readLimited(req,160000)))}catch(e){if(e instanceof AppError)throw e;throw new AppError('Invalid import JSON.')}
 if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('Invalid import request.');const b=input as Record<string,unknown>;
 if(Object.keys(b).some(k=>!['action','payload','expectedDigest'].includes(k)))throw new AppError('Unsupported import request field.');
 if(b.action==='preview'){const p=await planImport(b.payload);return response({ok:true,digest:p.digest,counts:p.counts,completed:!!p.completed})}
 if(b.action==='apply')return response(await applyImport(b.payload,b.expectedDigest,actorId));
 throw new AppError('Choose preview or apply.');
 }catch(e){return failure(e)}}
