import {env} from 'cloudflare:workers';
import {createSupabaseDatabase} from './supabase-db';

// Which database the app uses. Cloudflare D1 is the default. Setting UFS_DATABASE=supabase switches every query to the
// Supabase Postgres database (URL in UFS_SUPABASE_URL, the server-only key in the Worker secret UFS_SUPABASE_SERVICE_KEY).
let cached:{key:string;db:D1Database}|null=null;

export function database():D1Database{
 if(env.UFS_DATABASE==='supabase'){
  const url=env.UFS_SUPABASE_URL,key=env.UFS_SUPABASE_SERVICE_KEY;
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url??'')||!key)throw new Error('The database is not configured.');
  const id=`${url}|${key}`;
  if(!cached||cached.key!==id)cached={key:id,db:createSupabaseDatabase(url as string,key) as unknown as D1Database};
  return cached.db;
 }
 if(!env.DB)throw new Error('The database is not configured.');
 return env.DB;
}
