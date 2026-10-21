import {directoryActiveSql} from './employment-directory';
import {first} from './server';
import {AppError,loginEligibleSql,scopeSql,scopeOf,type Employee} from './policy';
export const PHOTO_MAX_BYTES=256*1024;
export const PHOTO_MAX_DIMENSION=1024;
export type PhotoRow={employee_id:string;object_key:string;mime:string;size:number;sha256:string;source_id:string;imported_at:string};
// Same employment lifecycle as the directory; sign-in activation is separate.
export const PHOTO_DIRECTORY_ACTIVE=directoryActiveSql;
export async function photoMetadata(employeeId:string,actor:Employee){const row=await first<{sha256:string}>('SELECT sha256 FROM employee_photos WHERE '+scopeSql(actor,'employee_photos')+' AND employee_id=?',employeeId);return {has_photo:!!row,photo_version:row?.sha256||null}}
export async function readablePhoto(me:Employee,id:string){return first<PhotoRow>(`SELECT ph.* FROM employee_photos ph JOIN employees e ON e.id=ph.employee_id AND e.data_scope=ph.data_scope LEFT JOIN employee_profiles p ON p.employee_id=e.id AND p.data_scope=e.data_scope LEFT JOIN source_employee_links s ON s.employee_id=e.id AND e.data_scope='live' JOIN employees viewer ON viewer.id=? AND viewer.user_id IS ? WHERE ph.employee_id=? AND ${scopeSql(me,'ph')} AND ${scopeSql(me,'viewer')} AND ${loginEligibleSql('viewer')} AND viewer.role IN ('employee','manager','hr_manager','hiring_manager','admin') AND (viewer.role IN ('hr_manager','admin') OR (${PHOTO_DIRECTORY_ACTIVE})=1)`,me.id,me.user_id,id)}
export function photoDigest(bytes:Uint8Array){return crypto.subtle.digest('SHA-256',bytes as BufferSource).then(value=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join(''))}
export function validatePhoto(bytes:Uint8Array){
 if(bytes.length<24||bytes.length>PHOTO_MAX_BYTES)throw new AppError('Photo must be a valid JPEG or PNG of at most 256 KB.');
 let mime='',width=0,height=0;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i])){
  if(view.getUint32(8)!==13||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw new AppError('Invalid PNG photo.');
  width=view.getUint32(16);height=view.getUint32(20);mime='image/png';
  if(bytes.length<45||String.fromCharCode(...bytes.slice(-8,-4))!=='IEND')throw new AppError('Incomplete PNG photo.');
 }else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){
  if(bytes.at(-2)!==255||bytes.at(-1)!==217)throw new AppError('Incomplete JPEG photo.');
  let offset=2;while(offset+4<bytes.length){if(bytes[offset]!==255)break;while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;const len=view.getUint16(offset);if(len<2||offset+len>bytes.length)throw new AppError('Invalid JPEG photo.');if([192,193,194].includes(marker)){if(len<8)throw new AppError('Invalid JPEG dimensions.');height=view.getUint16(offset+3);width=view.getUint16(offset+5);break;}offset+=len;}mime='image/jpeg';
 }else throw new AppError('Only JPEG or PNG profile photos are supported.');
 if(width<1||height<1||width>PHOTO_MAX_DIMENSION||height>PHOTO_MAX_DIMENSION)throw new AppError('Photo dimensions must be between 1 and 1024 pixels.');
 return {mime,width,height,size:bytes.length};
}

export function photoStorageAllowed(actor:Employee,key:string){return scopeOf(actor)==='live'?!key.startsWith('test/') : key.startsWith(`test/${scopeOf(actor)}/photos/`)}
