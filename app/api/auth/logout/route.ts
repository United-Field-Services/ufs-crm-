import {sameOrigin} from '../../../../lib/policy';
import {authProvider} from '../../../../lib/auth-provider';
import {convexLogout} from '../../../../lib/convex-auth';
import {newAuthClient,restoreClientSession,revokePresentedSession,authResult,authFailure} from '../../../../lib/standalone-auth';
export const dynamic='force-dynamic';
export async function POST(req:Request){if(authProvider()==='convex')return convexLogout(req);try{
 sameOrigin(req);
 // Only a hash of a token previously verified for this app can revoke a session.
 // This grants no access and works with expired tokens/provider outages.
 await revokePresentedSession(req);
 let providerSignOutComplete=false;
 try{const client=newAuthClient();await restoreClientSession(client,req);const {error}=await client.auth.signOut({scope:'local'});providerSignOutComplete=!error}catch{/* This app session is already revoked. */}
 return authResult({ok:true,providerSignOutComplete},200,undefined,true);
 }catch(error){return authFailure(error)}}
