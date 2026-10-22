'use client';
// Request-scoped credentials stay in HttpOnly cookies. The browser never reads tokens.
let refreshInFlight:Promise<boolean>|null=null;
export async function refreshEmployeeSession(){
 if(!refreshInFlight)refreshInFlight=(async()=>{
  try{const response=await fetch('/api/auth/refresh',{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});if(!response.ok)return false;const data=await response.json() as {authenticated?:boolean};return data.authenticated===true}catch{return false}
 })().finally(()=>{refreshInFlight=null});
 return refreshInFlight;
}
const REQUEST_TIMEOUT_MS=25000;
// People see a plain sentence instead of the browser's "Failed to fetch", and a request that hangs ends instead of locking the screen.
async function timedFetch(input:RequestInfo|URL,options:RequestInit){
 const timeout=AbortSignal.timeout(REQUEST_TIMEOUT_MS);
 const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
 try{return await fetch(input,{...options,signal})}
 catch(error){
  if(options.signal?.aborted)throw error;
  if(timeout.aborted)throw new Error('This is taking longer than expected. Check the list before trying again, then retry if it is missing.');
  if(error instanceof TypeError)throw new Error('We couldn’t reach UFS People. Check your connection and try again.');
  throw error;
 }
}
export async function apiFetch(input:RequestInfo|URL,init?:RequestInit){
 const options={...init,credentials:'same-origin' as const,cache:'no-store' as const};
 const replayInput:RequestInfo|URL=input instanceof Request?input.clone() as RequestInfo:input;
 let response=await timedFetch(input,options);
 // A 401 is returned before a protected operation can mutate anything.
 // Retry once after one shared refresh; never retry errors or other failures.
 if(response.status===401&&await refreshEmployeeSession())response=await timedFetch(replayInput,options);
 return response;
}
export async function signOutEmployee(){
 const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});
 if(!response.ok)throw new Error('Sign-out could not be completed. Please try again.');
 window.location.replace('/login');
}
