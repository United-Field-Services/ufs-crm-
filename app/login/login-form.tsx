'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
type Props={authEnabled:boolean;reason?:string};
type AuthResponse={ok?:boolean;enabled?:boolean;authenticated?:boolean};
async function authRequest(path:string,body?:Record<string,string>,signal?:AbortSignal):Promise<AuthResponse>{
 const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),...(signal?{signal}:{})});
 if(!response.ok)throw new Error('Sign-in failed');
 const result:unknown=await response.json();
 if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('Invalid response');
 for(const key of ['ok','enabled','authenticated'])if(key in result&&typeof result[key as keyof typeof result]!=='boolean')throw new Error('Invalid response');
 return result as AuthResponse;
}
export default function LoginForm({authEnabled,reason}:Props){
 const [stage,setStage]=useState<'checking'|'credentials'|'redirecting'|'unavailable'>(authEnabled?'checking':'unavailable');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const mounted=useRef(false),inFlight=useRef(false),passwordInput=useRef<HTMLInputElement>(null),errorBox=useRef<HTMLDivElement>(null);
 const messages:Record<string,string>={expired:'Your session has ended. Please sign in again.',access_denied:'Workspace access is unavailable for this account. Contact your UFS administrator.',signed_out:'You have signed out.'};
 function openWorkspace(){setStage('redirecting');/* eslint-disable-line @next/next/no-location-assign-relative-destination -- full page load on purpose: the API has just set the session cookies */window.location.assign('/')}
 useEffect(()=>{
  mounted.current=true;if(!authEnabled)return()=>{mounted.current=false};
  const controller=new AbortController();
  authRequest('/api/auth/session',undefined,controller.signal).then(result=>{
   if(!mounted.current||controller.signal.aborted)return;
   if(result.enabled===false)setStage('unavailable');
   else if(result.enabled!==true||typeof result.authenticated!=='boolean')throw new Error('Invalid session');
   else if(result.authenticated)openWorkspace();else setStage('credentials');
  }).catch(()=>{if(mounted.current&&!controller.signal.aborted){setStage('credentials');setError('Please sign in to continue.')}});
  return()=>{mounted.current=false;controller.abort()};
 },[authEnabled]);
 useEffect(()=>{if(error)errorBox.current?.focus()},[error]);
 async function submitCredentials(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!authEnabled||stage!=='credentials'||inFlight.current||!email.trim()||!password)return;
  inFlight.current=true;setBusy(true);setError('');
  try{
   const pending=authRequest('/api/auth/login',{email:email.trim(),password});setPassword('');if(passwordInput.current)passwordInput.current.value='';
   const result=await pending;if(!mounted.current)return;if(result.ok!==true||result.authenticated!==true)throw new Error('Sign-in failed');openWorkspace();
  }catch{if(mounted.current)setError('We couldn’t sign you in. Check your email and password, then try again. If you still need help, contact your UFS administrator.')}
  finally{inFlight.current=false;if(mounted.current){setPassword('');setBusy(false)}}
 }
 const unavailable=!authEnabled||stage==='unavailable',waiting=stage==='checking'||stage==='redirecting',disabled=unavailable||waiting||busy;
 return <div className="ufs-login-form-content" data-stage={stage}>
  <span className="ufs-login-form-eyebrow">WELCOME TO UFS PEOPLE</span><h2>Sign in to your workspace</h2>
  <p className="ufs-login-description">Use your work email as your username and enter your password.</p>
  {unavailable&&<div className="ufs-login-notice" role="status">Sign-in is temporarily unavailable. Contact your UFS administrator.</div>}
  {!error&&reason&&messages[reason]&&<div className="ufs-login-notice" role="status">{messages[reason]}</div>}
  {error&&<div ref={errorBox} className="ufs-login-error" id="ufs-login-error" role="alert" tabIndex={-1}>{error}</div>}
  <form onSubmit={submitCredentials} aria-label="Sign in with your account" aria-busy={busy||waiting}>
   <div className="ufs-login-field"><label htmlFor="ufs-email">Username (work email)</label><input id="ufs-email" name="email" type="email" enterKeyHint="next" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} onChange={event=>setEmail(event.target.value)} disabled={disabled} aria-describedby={error?'ufs-login-error':undefined}/></div>
   <div className="ufs-login-field"><label htmlFor="ufs-password">Password</label><input ref={passwordInput} id="ufs-password" name="password" type="password" enterKeyHint="go" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)} disabled={disabled} aria-describedby={error?'ufs-login-error':undefined}/></div>
   <button className="ufs-login-submit" type="submit" disabled={disabled}>{unavailable?'Sign-in unavailable':stage==='checking'?'Checking your session…':stage==='redirecting'?'Opening your workspace…':busy?'Signing in…':'Sign in'}<span aria-hidden="true">→</span></button>
   {waiting&&<span className="ufs-login-sr-only" role="status">{stage==='checking'?'Checking your session.':'Opening your workspace.'}</span>}
  </form>
  <p className="ufs-login-support"><a href="/forgot-password">Forgot your password?</a><br/>Need access? Contact your UFS administrator.</p>
 </div>;
}
