import {env} from 'cloudflare:workers';

// Which service signs people in. Supabase (the project owner's reviewed setup) is the default;
// Convex Auth is an optional alternative selected with UFS_AUTH_PROVIDER=convex.
export type AuthProvider='supabase'|'convex';
export const authProvider=():AuthProvider=>env.UFS_AUTH_PROVIDER==='convex'?'convex':'supabase';

// Both URLs must belong to the same Convex deployment, and only Convex's own domains are accepted,
// so a mistyped or malicious setting can never point sign-in at another host.
export function convexUrls(){
 const cloud=/^https:\/\/([a-z0-9-]+)\.convex\.cloud$/.exec(env.UFS_CONVEX_URL??'');
 const site=/^https:\/\/([a-z0-9-]+)\.convex\.site$/.exec(env.UFS_CONVEX_SITE_URL??'');
 return cloud&&site&&cloud[1]===site[1]?{cloud:cloud[0],site:site[0]}:null;
}
const modeAllowsSignIn=()=>env.UFS_AUTH_MODE==='pilot'||env.UFS_AUTH_MODE==='standalone';
export const convexConfigured=()=>authProvider()==='convex'&&modeAllowsSignIn()&&convexUrls()!==null;
// Password reset stays off until this exact flag is set, whichever provider is used.
export const convexRecoveryConfigured=()=>convexConfigured()&&env.UFS_PASSWORD_RECOVERY==='enabled';
