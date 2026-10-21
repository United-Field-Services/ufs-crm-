import {AppError,sameOrigin} from '../../../../lib/policy';
import {authProvider} from '../../../../lib/auth-provider';
import {convexRefresh} from '../../../../lib/convex-auth';
import {newAuthClient,readAuthCookies,verifyIdentity,authStatus,authResult,authFailure} from '../../../../lib/standalone-auth';
export const dynamic='force-dynamic';
export async function POST(req:Request){if(authProvider()==='convex')return convexRefresh(req);try{
 sameOrigin(req);const {refreshToken}=readAuthCookies(req.headers);if(!refreshToken)throw new AppError('Sign in again.',401);
 const client=newAuthClient(),{data,error}=await client.auth.refreshSession({refresh_token:refreshToken});
 if(error||!data.session)throw new AppError('Your session expired. Sign in again.',401);
 const identity=await verifyIdentity(data.session.access_token);
 return authResult(await authStatus(identity),200,data.session);
 }catch(error){return authFailure(error)}}
