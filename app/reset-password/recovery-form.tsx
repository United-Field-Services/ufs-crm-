'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';

type Props={mode:'request'|'reset';authEnabled:boolean};
export default function RecoveryForm({mode,authEnabled}:Props){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
 const [ready,setReady]=useState(mode==='request'),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const token=useRef(''),initialized=useRef(false),inFlight=useRef(false),mounted=useRef(false),errorBox=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  mounted.current=true;
  if(mode==='reset'&&!initialized.current){
   initialized.current=true;
   const url=new URL(window.location.href),values=url.searchParams.getAll('token_hash');
   const valid=values.length===1&&/^[a-f0-9]{32,256}$/i.test(values[0])&&[...url.searchParams.keys()].every(key=>key==='token_hash')&&!url.hash;
   // Strip sensitive query/fragment immediately. Never persist or render the token.
   window.history.replaceState(null,'','/reset-password');
   // Hydration synchronizes the form with the browser-only recovery URL.
   // eslint-disable-next-line react-hooks/set-state-in-effect
   if(valid){token.current=values[0];setReady(true)}else setError('This reset link is invalid or missing. Request a new link.');
  }
  return()=>{mounted.current=false};
 },[mode]);
 useEffect(()=>{if(error)errorBox.current?.focus()},[error]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!authEnabled||!ready||inFlight.current||done)return;
  if(mode==='reset'&&(password.length<12||password.length>128||password!==confirmation)){setError('Use a password between 12 and 128 characters and enter it identically twice.');return}
  inFlight.current=true;setBusy(true);setError('');
  let failureMessage=mode==='request'?'We couldn’t process that request. Check your email address or try again later.':'The password was not confirmed as changed. This link may be expired or already used. Request a new link.';
  try{
   const body=mode==='request'?{email:email.trim()}:{token_hash:token.current,password,confirmPassword:confirmation};
   const pending=fetch(mode==='request'?'/api/auth/forgot-password':'/api/auth/reset-password',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
   setPassword('');setConfirmation('');
   const response=await pending,result:unknown=await response.json();
   if(!mounted.current)return;
   if(!response.ok||!result||typeof result!=='object'||!('ok' in result)||result.ok!==true){
    if(response.status===429)failureMessage='Too many attempts. Please wait before trying again.';
    throw new Error('Recovery request failed');
   }
   token.current='';setDone(true);
   setMessage(mode==='request'?'If an eligible account matches that email, you will receive a password reset link. Check your inbox and spam folder.':('sessionRevocationPending' in result&&result.sessionRevocationPending===true?'Your password changed and workspace sessions were ended. Provider session cleanup could not be confirmed. Contact your administrator, then sign in with your new password.':'Your password has been changed. Sign in with your new password.'));
  }catch{if(mounted.current)setError(failureMessage)}
  finally{inFlight.current=false;if(mounted.current){setBusy(false);setPassword('');setConfirmation('')}}
 }
 const disabled=!authEnabled||!ready||busy||done;
 return <div className="ufs-login-form-content">
  <span className="ufs-login-form-eyebrow">UFS PEOPLE</span><h2>{mode==='request'?'Forgot your password?':'Choose a new password'}</h2>
  <p className="ufs-login-description">{mode==='request'?'Enter your work email to request a reset link.':'Enter your new password below. You’ll sign in again after changing it.'}</p>
  {!authEnabled&&<div className="ufs-login-notice" role="status">Password reset is not enabled yet. Contact your UFS administrator.</div>}
  {error&&<div ref={errorBox} className="ufs-login-error" role="alert" tabIndex={-1}>{error}</div>}
  {done?<div className="ufs-login-notice" role="status">{message}</div>:<form onSubmit={submit} aria-label={mode==='request'?'Request password reset':'Set new password'} aria-busy={busy}>
   {mode==='request'?<div className="ufs-login-field"><label htmlFor="reset-email">Work email</label><input id="reset-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required value={email} onChange={event=>setEmail(event.target.value)} disabled={disabled}/></div>:<>
    <div className="ufs-login-field"><label htmlFor="new-password">New password</label><input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={event=>setPassword(event.target.value)} disabled={disabled}/></div>
    <div className="ufs-login-field"><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={disabled}/></div>
   </>}
   <button className="ufs-login-submit" type="submit" disabled={disabled}>{busy?'Please wait…':mode==='request'?'Send reset link':'Change password'}</button>
  </form>}
  <p className="ufs-login-support"><a href="/login">Back to sign in</a>{mode==='reset'&&!done&&<><br/><a href="/forgot-password">Request a new reset link</a></>}</p>
 </div>;
}
