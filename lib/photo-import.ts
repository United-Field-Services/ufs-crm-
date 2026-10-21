import {all,bucket,db,first,now,uid} from './server';
import {AppError} from './policy';
import {photoDigest,validatePhoto} from './photos';
export const PHOTO_IMPORT_ID='talenthr-profile-photos-v1';
export const PHOTO_SOURCE_ORIGIN='https://unitedffs.talenthr.io';
const MAX_RECORDS=45;
type InputRow={sourceId:string;status:'photo'|'no-photo'|'blocked';data?:string;sha256?:string};
type Batch={digest:string;counts_json:string;imported_at:string};
function object(v:unknown,keys:string[]){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw new AppError('Unsupported photo-import fields.');return v as Record<string,unknown>}
export async function planPhotoImport(raw:unknown){
 const input=object(raw,['schemaVersion','sourceOrigin','extractedAt','records']);
 if(input.schemaVersion!==1||input.sourceOrigin!==PHOTO_SOURCE_ORIGIN||typeof input.extractedAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(input.extractedAt)||Number.isNaN(Date.parse(input.extractedAt)))throw new AppError('Invalid photo-import source.');
 if(!Array.isArray(input.records)||input.records.length!==MAX_RECORDS)throw new AppError('The authorized photo inventory must cover exactly 45 source profiles.');
 const records=input.records.map(value=>{const r=object(value,['sourceId','status','data','sha256']);if(typeof r.sourceId!=='string'||!/^\/(people\/\d+|my-profile)$/.test(r.sourceId)||!['photo','no-photo','blocked'].includes(String(r.status)))throw new AppError('Invalid source-photo record.');if(r.status==='photo'){if(typeof r.data!=='string'||r.data.length>350000||!r.data.length||r.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(r.data)||typeof r.sha256!=='string'||! /^[a-f0-9]{64}$/.test(r.sha256))throw new AppError('Invalid photo bytes or digest.')}else if(r.data!==undefined||r.sha256!==undefined)throw new AppError('Placeholder records must not contain image bytes.');return r as InputRow}).sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
 if(new Set(records.map(r=>r.sourceId)).size!==MAX_RECORDS)throw new AppError('Duplicate source-photo record.');
 const mappings=await all<{source_id:string;employee_id:string;former:number}>("SELECT s.source_id,s.employee_id,CASE WHEN LOWER(p.employment_status) IN ('terminated','inactive') OR LOWER(s.source_status) IN ('terminated','inactive','archived') THEN 1 ELSE 0 END AS former FROM source_employee_links s JOIN employees e ON e.id=s.employee_id AND e.demo=0 LEFT JOIN employee_profiles p ON p.employee_id=e.id");
 if(mappings.length!==MAX_RECORDS||records.some(r=>!mappings.some(m=>m.source_id===r.sourceId)))throw new AppError('Import the 26 current and 19 former directory mappings before their photos.',409);
 const entries=await Promise.all(records.map(async r=>{const mapping=mappings.find(m=>m.source_id===r.sourceId)!;if(r.status!=='photo')return {...r,...mapping,bytes:null,meta:null,key:null};let decoded:string;try{decoded=atob(r.data!)}catch{throw new AppError('Invalid photo encoding.')}const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0)),meta=validatePhoto(bytes);if(await photoDigest(bytes)!==r.sha256)throw new AppError('Photo digest does not match its bytes.');return {...r,...mapping,bytes,meta,key:`avatars/talenthr/${mapping.employee_id.replaceAll(':','_')}/${r.sha256}`}}));
 const digest=await photoDigest(new TextEncoder().encode(JSON.stringify({schemaVersion:1,sourceOrigin:PHOTO_SOURCE_ORIGIN,extractedAt:input.extractedAt,records:records.map(r=>Object.fromEntries(Object.entries(r).filter(([key])=>key!=='data')))})));
 const completed=await first<Batch>('SELECT digest,counts_json,imported_at FROM migration_batches WHERE id=?',PHOTO_IMPORT_ID);if(completed&&completed.digest!==digest)throw new AppError('The one-time photo migration already contains a different snapshot.',409);
 const counts={profiles:MAX_RECORDS,transferred:entries.filter(e=>e.status==='photo').length,noPhoto:entries.filter(e=>e.status==='no-photo').length,blocked:entries.filter(e=>e.status==='blocked').length,current:entries.filter(e=>!e.former).length,former:entries.filter(e=>e.former).length,currentPhotos:entries.filter(e=>!e.former&&e.status==='photo').length,formerPhotos:entries.filter(e=>e.former&&e.status==='photo').length};
 if(counts.current!==26||counts.former!==19)throw new AppError('Directory lifecycle counts do not match the authorized photo scope.',409);
 if(!completed&&await first('SELECT employee_id FROM employee_photos LIMIT 1'))throw new AppError('Existing profile photos require reconciliation before import.',409);
 return {entries,digest,completed,counts};
}
export async function applyPhotoImport(raw:unknown,expectedDigest:unknown){
 const plan=await planPhotoImport(raw);if(expectedDigest!==plan.digest)throw new AppError('Preview this exact photo inventory before applying it.',409);if(plan.completed)return {ok:true,replayed:true,digest:plan.digest,counts:JSON.parse(plan.completed.counts_json),importedAt:plan.completed.imported_at};
 const timestamp=now(),photos=plan.entries.filter(e=>e.bytes&&e.meta&&e.key),stored:string[]=[];
 try{
  for(const photo of photos){await bucket().put(photo.key!,photo.bytes!,{httpMetadata:{contentType:photo.meta!.mime},customMetadata:{sha256:photo.sha256!,source:'TalentHR profile avatar'}});stored.push(photo.key!);}
  const commands=[db().prepare('INSERT INTO migration_batches (id,source_origin,digest,counts_json,imported_at) VALUES (?,?,?,?,?)').bind(PHOTO_IMPORT_ID,PHOTO_SOURCE_ORIGIN,plan.digest,JSON.stringify(plan.counts),timestamp)];
  for(const photo of photos)commands.push(db().prepare('INSERT INTO employee_photos (employee_id,object_key,mime,size,sha256,source_id,imported_at) VALUES (?,?,?,?,?,?,?)').bind(photo.employee_id,photo.key,photo.meta!.mime,photo.meta!.size,photo.sha256,photo.sourceId,timestamp));
  commands.push(db().prepare('INSERT INTO audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(uid(),'site-owner-service',`Imported TalentHR profile photos: ${plan.counts.transferred} transferred; ${plan.counts.noPhoto} placeholders retained; ${plan.counts.blocked} blocked`,PHOTO_IMPORT_ID,timestamp));
  await db().batch(commands);
 }catch(error){
  const batch=await first<Batch>('SELECT digest,counts_json,imported_at FROM migration_batches WHERE id=?',PHOTO_IMPORT_ID);if(batch?.digest===plan.digest)return {ok:true,replayed:true,digest:plan.digest,counts:JSON.parse(batch.counts_json),importedAt:batch.imported_at};
  for(const key of stored)if(!await first('SELECT employee_id FROM employee_photos WHERE object_key=?',key))await bucket().delete(key);
  if(error instanceof AppError)throw error;throw new AppError('The photo import was not committed; retry the same approved inventory.',409);
 }
 return {ok:true,replayed:false,digest:plan.digest,counts:plan.counts,importedAt:timestamp};
}
export async function verifyPhotoImport(expectedDigest:string){
 const batch=await first<Batch>('SELECT digest,counts_json,imported_at FROM migration_batches WHERE id=?',PHOTO_IMPORT_ID);if(!batch||batch.digest!==expectedDigest)throw new AppError('The authorized photo transfer is not complete.',409);
 const expected=JSON.parse(batch.counts_json) as {transferred:number},photos=await all<{object_key:string;sha256:string;mime:string;size:number}>('SELECT object_key,sha256,mime,size FROM employee_photos');
 if(photos.length!==expected.transferred)throw new AppError('Photo metadata count needs reconciliation.',409);
 for(const photo of photos){const object=await bucket().get(photo.object_key);if(!object)throw new AppError('A transferred photo object is missing.',409);const bytes=new Uint8Array(await new Response(object.body).arrayBuffer()),meta=validatePhoto(bytes);if(bytes.length!==photo.size||meta.mime!==photo.mime||await photoDigest(bytes)!==photo.sha256)throw new AppError('A transferred photo failed byte verification.',409);}
 return {ok:true,verifiedPhotos:photos.length,digest:batch.digest,counts:JSON.parse(batch.counts_json)};
}
