import {requestPasswordReset} from '../../../../lib/password-recovery';
import {authProvider} from '../../../../lib/auth-provider';
import {requestConvexReset} from '../../../../lib/convex-recovery';
export const dynamic='force-dynamic';
export const POST=(req:Request)=>authProvider()==='convex'?requestConvexReset(req):requestPasswordReset(req);
