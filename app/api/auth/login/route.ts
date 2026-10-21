import {AppError,jsonBody,sameOrigin} from '../../../../lib/policy';
import {authProvider} from '../../../../lib/auth-provider';
import {convexLogin} from '../../../../lib/convex-auth';
import {newAuthClient,verifyIdentity,authStatus,authResult,authFailure,rateLimit} from '../../../../lib/standalone-auth';
export const dynamic='force-dynamic';
export async function POST(req:Request){if(authProvider()==='convex')return convexLogin(req);try{
 sameOrigin(req);if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError('Use the sign-in form.',415);
 const b=await jsonBody(req);const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof b.password!=='string'||b.password.length<1||b.password.length>1024)throw new AppError('Check your email and password.',400);
 const client=newAuthClient();await rateLimit(req,email);
 const {data,error}=await client.auth.signInWithPassword({email,password:b.password});
 b.password='';
 if(error||!data.session)throw new AppError('Check your email and password, or contact your administrator.',401);
 try{const identity=await verifyIdentity(data.session.access_token,{registerSession:true});return authResult(await authStatus(identity),200,data.session)}
 catch(error){await client.auth.signOut({scope:'local'}).catch(()=>{});throw error}
 }catch(error){return authFailure(error)}}
