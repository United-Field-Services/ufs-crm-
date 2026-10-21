'use client';
// Request-scoped credentials stay in HttpOnly cookies. The browser never reads tokens.
let refreshInFlight:Promise<boolean>|null=null;
export async function refreshEmployeeSession(){
 if(!refreshInFlight)refreshInFlight=(async()=>{
  try{const response=await fetch('/api/auth/refresh',{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});if(!response.ok)return false;const data=await response.json() as {authenticated?:boolean};return data.authenticated===true}catch{return false}
 })().finally(()=>{refreshInFlight=null});
 return refreshInFlight;
}
export async function apiFetch(input:RequestInfo|URL,init?:RequestInit){
 const options={...init,credentials:'same-origin' as const,cache:'no-store' as const};
 const replayInput:RequestInfo|URL=input instanceof Request?input.clone() as RequestInfo:input;
 let response=await fetch(input,options);
 // A 401 is returned before a protected operation can mutate anything.
 // Retry once after one shared refresh; never retry errors or other failures.
 if(response.status===401&&await refreshEmployeeSession())response=await fetch(replayInput,options);
 return response;
}
export async function signOutEmployee(){
 const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});
 if(!response.ok)throw new Error('Sign-out could not be completed. Please try again.');
 window.location.replace('/login');
}
