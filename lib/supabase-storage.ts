import type {StorageBucket} from './d1-storage';

// File storage in a private Supabase Storage bucket. The server-only service key is used, so files are never reachable by
// a public link: every download goes through the app's own permission checks first.
export const FILE_BUCKET='ufs-files';

const encodePath=(key:string)=>key.split('/').map(encodeURIComponent).join('/');

export function supabaseBucket(baseUrl:string,serviceKey:string,fetcher:(input:string,init:RequestInit)=>Promise<Response>=fetch):StorageBucket{
 const root=`${baseUrl.replace(/\/$/,'')}/storage/v1/object/${FILE_BUCKET}`;
 const auth={apikey:serviceKey,Authorization:`Bearer ${serviceKey}`};
 const timeout=()=>AbortSignal.timeout(60000);
 return {
  async put(key,value,options){
   const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
   const type=(options as {httpMetadata?:{contentType?:string}}|undefined)?.httpMetadata?.contentType||'application/octet-stream';
   const response=await fetcher(`${root}/${encodePath(key)}`,{method:'POST',redirect:'manual',signal:timeout(),headers:{...auth,'Content-Type':type,'x-upsert':'true'},body:bytes as BodyInit});
   if(!response.ok)throw new Error('The file could not be stored.');
  },
  async get(key){
   const response=await fetcher(`${root}/${encodePath(key)}`,{redirect:'manual',signal:timeout(),headers:auth});
   // Storage answers 400 or 404 for a file that is not there.
   if(response.status===404||response.status===400)return null;
   if(!response.ok||!response.body)throw new Error('The file could not be read.');
   return {body:response.body as ReadableStream<Uint8Array>};
  },
  async delete(key){
   const response=await fetcher(root,{method:'DELETE',redirect:'manual',signal:timeout(),headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[key]})});
   if(!response.ok)throw new Error('The file could not be removed.');
  },
 };
}
