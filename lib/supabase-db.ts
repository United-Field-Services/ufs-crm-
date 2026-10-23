import {toPostgres} from './pg-dialect';

// A database object shaped like Cloudflare D1 (prepare, bind, all, first, run, batch) that talks to Supabase Postgres over
// HTTPS, using the one function in supabase/executor.sql. The rest of the app does not know the difference.
// The service key stays on the server (a Worker secret) and is never sent to a browser.

type Row=Record<string,unknown>;
type Call={sql:string;params:unknown[]};
type Answer={rows:Row[];changes:number};
export type Fetcher=(input:string,init:RequestInit)=>Promise<Response>;

const clean=(value:unknown)=>value===undefined?null:typeof value==='boolean'?(value?1:0):value;

export function createSupabaseDatabase(baseUrl:string,serviceKey:string,fetcher:Fetcher=fetch){
 const endpoint=`${baseUrl.replace(/\/$/,'')}/rest/v1/rpc/ufs_batch`;
 async function execute(calls:Call[]):Promise<Answer[]>{
  const response=await fetcher(endpoint,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json',apikey:serviceKey,Authorization:`Bearer ${serviceKey}`},body:JSON.stringify({statements:calls})});
  if(!response.ok){
   let message='Database request failed';
   try{const body=await response.json() as {message?:string};if(body.message)message=body.message}catch{/* keep the generic message */}
   throw new Error(message);
  }
  return await response.json() as Answer[];
 }
 const meta=(answer:Answer)=>({changes:answer.changes,duration:0,last_row_id:0,rows_read:answer.rows.length,rows_written:answer.changes,changed_db:answer.changes>0});
 const result=(answer:Answer)=>({results:answer.rows,success:true,meta:meta(answer)});

 class Statement{
  readonly sql:string;
  readonly params:unknown[];
  constructor(sql:string,params:unknown[]=[]){this.sql=sql;this.params=params}
  bind(...values:unknown[]){return new Statement(this.sql,values.map(clean))}
  async all(){return result((await execute([{sql:this.sql,params:this.params}]))[0])}
  async run(){return result((await execute([{sql:this.sql,params:this.params}]))[0])}
  async first(column?:string){
   const [answer]=await execute([{sql:this.sql,params:this.params}]),row=answer.rows[0]??null;
   return column&&row?row[column]:row;
  }
  async raw(){return (await execute([{sql:this.sql,params:this.params}]))[0].rows.map(row=>Object.values(row))}
 }

 return {
  prepare:(sql:string)=>new Statement(toPostgres(sql)),
  async batch(statements:Statement[]){return (await execute(statements.map(statement=>({sql:statement.sql,params:statement.params})))).map(result)},
 };
}
