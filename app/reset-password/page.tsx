import type {Metadata} from 'next';
import RecoveryPage from './recovery-page';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Reset password | UFS People',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function ResetPasswordPage(){return <RecoveryPage mode="reset"/>}
