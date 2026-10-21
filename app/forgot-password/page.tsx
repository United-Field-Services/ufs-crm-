import type {Metadata} from 'next';
import RecoveryPage from '../reset-password/recovery-page';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Forgot password | UFS People',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function ForgotPasswordPage(){return <RecoveryPage mode="request"/>}
