'use client';
import {useRef,useState,type FormEvent} from 'react';

// Password reset when sign-in runs on Convex Auth, one question per screen:
//   1. work email  ->  2. the emailed 8-digit code  ->  3. a new password.
// Convex checks the code and sets the password in one step, so the code is only confirmed when the
// password is saved. A wrong code sends the person back to step 2. Nothing is stored in the browser.
type Props={mode:'request'|'reset';authEnabled:boolean};
type Step='email'|'code'|'password'|'done';
const send=(path:string,body:Record<string,string>)=>fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
const cleanCode=(value:string)=>value.replace(/\s+/g,'');

export default function ConvexRecoveryForm({mode,authEnabled}:Props){
 // The reset page is reached with a code already in hand, so it starts at step 2 and asks for the email there.
 const [step,setStep]=useState<Step>(mode==='request'?'email':'code');
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const inFlight=useRef(false);

 async function requestCode(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!authEnabled||inFlight.current||!email.trim())return;
  inFlight.current=true;setBusy(true);setError('');
  try{
   const response=await send('/api/auth/forgot-password',{email:email.trim()});
   const result:unknown=await response.json().catch(()=>null);
   if(!response.ok||!result||typeof result!=='object'||!('ok' in result)||result.ok!==true)throw new Error(response.status===429?'Too many attempts. Please wait before trying again.':'We couldn’t process that request. Check your email address or try again later.');
   setMessage('If an eligible account matches that email, a reset code was sent. Check your inbox and spam folder, then enter the code below.');setStep('code');
  }catch(cause){setError(cause instanceof Error?cause.message:'We couldn’t process that request.')}
  finally{inFlight.current=false;setBusy(false)}
 }
 function continueWithCode(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!authEnabled||busy)return;
  if(mode==='reset'&&!email.trim()){setError('Enter your work email.');return}
  if(!/^\d{8}$/.test(cleanCode(code))){setError('Enter the 8-digit code from the email.');return}
  setError('');setMessage('');setStep('password');
 }
 async function changePassword(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!authEnabled||inFlight.current)return;
  if(password.length<12||password.length>72||password!==confirmation){setError('Use a password between 12 and 72 characters and enter it identically twice.');return}
  inFlight.current=true;setBusy(true);setError('');
  let failure='That code didn’t work. It may be wrong, expired, or already used. Check it or request a new code.';
  let backToCode=true;
  try{
   const pending=send('/api/auth/reset-password',{email:email.trim(),code:cleanCode(code),password,confirmPassword:confirmation});
   setPassword('');setConfirmation('');
   const response=await pending,result:unknown=await response.json().catch(()=>null);
   if(!response.ok||!result||typeof result!=='object'||!('ok' in result)||result.ok!==true){
    if(response.status===429){failure='Too many attempts. Please wait before trying again.';backToCode=false}
    else if(response.status===503){failure='Password reset is temporarily unavailable. Contact your UFS administrator.';backToCode=false}
    throw new Error(failure);
   }
   setCode('');setMessage('sessionRevocationPending' in result&&result.sessionRevocationPending===true?'Your password changed and works for new sign-ins, but signing out other devices could not be confirmed. Contact your UFS administrator if you suspect someone else has access.':'Your password changed. Other devices were signed out. Sign in with your new password.');
   setStep('done');
  }catch(cause){
   setError(cause instanceof Error?cause.message:failure);
   // A rejected code is entered again on step 2; the new password is typed again afterwards.
   if(backToCode){setCode('');setStep('code')}
  }
  finally{inFlight.current=false;setBusy(false);setPassword('');setConfirmation('')}
 }
 const disabled=!authEnabled||busy;
 const headings:Record<Step,[string,string]>={
  email:['Forgot your password?','Enter your work email and we will email you a reset code.'],
  code:['Enter your code','Enter the 8-digit code we emailed you.'],
  password:['Choose a new password','Use at least 12 characters. You will sign in again afterwards.'],
  done:['Password changed','You can now sign in.'],
 };
 const number={email:1,code:2,password:3,done:3}[step];
 return <div className="ufs-login-form-content" data-stage={step}>
  <span className="ufs-login-form-eyebrow">{step==='done'?'UFS PEOPLE':`UFS PEOPLE · STEP ${number} OF 3`}</span>
  <h2>{headings[step][0]}</h2>
  <p className="ufs-login-description">{headings[step][1]}</p>
  {!authEnabled&&<div className="ufs-login-notice" role="status">Password reset is not enabled yet. Contact your UFS administrator.</div>}
  {message&&<div className="ufs-login-notice" role="status">{message}</div>}
  {error&&<div className="ufs-login-error" role="alert">{error}</div>}
  {step==='email'&&<form onSubmit={requestCode} aria-label="Request a reset code" aria-busy={busy}>
   <div className="ufs-login-field"><label htmlFor="convex-reset-email">Work email</label><input id="convex-reset-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required value={email} onChange={event=>setEmail(event.target.value)} disabled={disabled}/></div>
   <button className="ufs-login-submit" type="submit" disabled={disabled}>{busy?'Please wait…':'Send reset code'}</button>
  </form>}
  {step==='code'&&<form onSubmit={continueWithCode} aria-label="Enter the reset code" aria-busy={busy}>
   {mode==='reset'&&<div className="ufs-login-field"><label htmlFor="convex-reset-email-2">Work email</label><input id="convex-reset-email-2" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required value={email} onChange={event=>setEmail(event.target.value)} disabled={disabled}/></div>}
   <div className="ufs-login-field"><label htmlFor="convex-reset-code">8-digit code</label><input id="convex-reset-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={12} required value={code} onChange={event=>setCode(event.target.value)} disabled={disabled}/></div>
   <button className="ufs-login-submit" type="submit" disabled={disabled}>Continue</button>
  </form>}
  {step==='password'&&<form onSubmit={changePassword} aria-label="Choose a new password" aria-busy={busy}>
   <div className="ufs-login-field"><label htmlFor="convex-new-password">New password</label><input id="convex-new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={password} onChange={event=>setPassword(event.target.value)} disabled={disabled}/></div>
   <div className="ufs-login-field"><label htmlFor="convex-confirm-password">Confirm new password</label><input id="convex-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={disabled}/></div>
   <button className="ufs-login-submit" type="submit" disabled={disabled}>{busy?'Please wait…':'Change password'}</button>
  </form>}
  <p className="ufs-login-support"><a href="/login">{step==='done'?'Go to sign in':'Back to sign in'}</a>{(step==='code'||step==='password')&&<><br/><a href="/forgot-password">Request a new code</a></>}</p>
 </div>;
}
