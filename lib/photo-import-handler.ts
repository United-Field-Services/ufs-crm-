import {headers} from 'next/headers';
import {AppError,readLimited} from './policy';
import {response,failure} from './server';
import {planPhotoImport,applyPhotoImport,verifyPhotoImport} from './photo-import';
// TEMPORARY one-time service importer for this confirmed sole-owner private Site.
// Sites dispatch validates and consumes OAI-Sites-Authorization. It is not a visitor identity.
// Reject all visitor and browser requests. Remove route after native DB/R2 reconciliation.
export async function handlePhotoImport(req:Request,authorizedDigest:string){try{
 const identity=await headers();if(identity.has('oai-authenticated-user-id')||identity.has('oai-authenticated-user-email')||req.headers.has('origin')||req.headers.has('sec-fetch-site'))throw new AppError('This one-time transfer requires private Site service access.',403);
 let value:unknown;try{value=JSON.parse(new TextDecoder().decode(await readLimited(req,6*1024*1024)))}catch(error){if(error instanceof AppError)throw error;throw new AppError('Invalid photo import JSON.');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['action','payload','expectedDigest'].includes(k)))throw new AppError('Invalid photo import request.');const input=value as Record<string,unknown>;
 if(input.action==='verify')return response(await verifyPhotoImport(authorizedDigest));
 const plan=await planPhotoImport(input.payload);if(plan.digest!==authorizedDigest)throw new AppError('This photo snapshot is outside the authorized one-time transfer.',409);
 if(input.action==='preview'){return response({ok:true,digest:plan.digest,counts:plan.counts,completed:!!plan.completed});}
 if(input.action==='apply')return response(await applyPhotoImport(input.payload,input.expectedDigest));
 throw new AppError('Choose preview, apply, or verify.');
 }catch(error){return failure(error)}}
