import {completePasswordReset} from '../../../../lib/password-recovery';
import {authProvider} from '../../../../lib/auth-provider';
import {completeConvexReset} from '../../../../lib/convex-recovery';
export const dynamic='force-dynamic';
export const POST=(req:Request)=>authProvider()==='convex'?completeConvexReset(req):completePasswordReset(req);
