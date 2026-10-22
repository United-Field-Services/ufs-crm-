import {Buffer} from 'node:buffer';
// File storage for deployments without an R2 bucket (R2 needs a payment method on the Cloudflare account).
// Files are kept in D1 as base64 chunks of 750 KB (a D1 row can hold 2 MB). It offers the small part of the
// R2 interface the app uses: put, get, delete. When an R2 bucket is bound it is used instead (see bucket()).
const CHUNK_CHARS=1_000_000;
export type StoredObject={body:ReadableStream<Uint8Array>};
export type StorageBucket={
 put(key:string,value:ArrayBuffer|Uint8Array,options?:unknown):Promise<unknown>;
 get(key:string):Promise<StoredObject|null>;
 delete(key:string):Promise<void>;
};
export function d1Bucket(d1:D1Database):StorageBucket{
 return {
  async put(key,value){
   const text=Buffer.from(value instanceof Uint8Array?value:new Uint8Array(value)).toString('base64');
   const statements=[d1.prepare('DELETE FROM file_chunks WHERE object_key=?').bind(key)];
   for(let index=0,at=0;at<text.length;index++,at+=CHUNK_CHARS)statements.push(d1.prepare('INSERT INTO file_chunks (object_key,idx,data) VALUES (?,?,?)').bind(key,index,text.slice(at,at+CHUNK_CHARS)));
   await d1.batch(statements);
  },
  async get(key){
   const {results}=await d1.prepare('SELECT data FROM file_chunks WHERE object_key=? ORDER BY idx').bind(key).all<{data:string}>();
   if(!results.length)return null;
   const bytes=Buffer.from(results.map(row=>row.data).join(''),'base64');
   return {body:new Response(bytes).body as ReadableStream<Uint8Array>};
  },
  async delete(key){await d1.prepare('DELETE FROM file_chunks WHERE object_key=?').bind(key).run()},
 };
}
