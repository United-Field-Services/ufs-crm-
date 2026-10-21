import {passwordRecoveryConfigured} from '../../lib/password-recovery';
import {authProvider,convexRecoveryConfigured} from '../../lib/auth-provider';
import RecoveryForm from './recovery-form';
import ConvexRecoveryForm from './convex-recovery-form';
import '../login/login.css';
import './recovery.css';
export default function RecoveryPage({mode}:{mode:'request'|'reset'}){
 return <main className="ufs-login"><section className="ufs-login-panel ufs-recovery-panel" aria-label="Password recovery"><div className="ufs-login-card">{authProvider()==='convex'?<ConvexRecoveryForm mode={mode} authEnabled={convexRecoveryConfigured()}/>:<RecoveryForm mode={mode} authEnabled={passwordRecoveryConfigured()}/>}</div></section></main>;
}
