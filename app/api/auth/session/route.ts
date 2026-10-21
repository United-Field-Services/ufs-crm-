import {authProvider} from '../../../../lib/auth-provider';
import {convexRequestIdentity} from '../../../../lib/convex-auth';
import {standaloneConfigured,requestIdentity,authStatus,authResult,authFailure,readAuthCookies} from '../../../../lib/standalone-auth';
export const dynamic='force-dynamic';
export async function GET(req:Request){if(!standaloneConfigured())return authResult({enabled:false,authenticated:false});try{if(!readAuthCookies(req.headers).accessToken)return authResult({enabled:true,authenticated:false});return authResult(await authStatus(authProvider()==='convex'?await convexRequestIdentity(req):await requestIdentity(req)))}catch(error){return authFailure(error)}}
