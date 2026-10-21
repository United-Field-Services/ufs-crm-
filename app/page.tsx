import {requireChatGPTUser} from './chatgpt-auth';
import {standaloneMode,readAuthCookies} from '../lib/standalone-auth';
import {currentEmployee} from '../lib/server';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import Workspace from './workspace';
export const dynamic='force-dynamic';
export default async function Page(){
 let employeeLogin=false;
 if(standaloneMode()){
  const cookies=readAuthCookies(await headers());employeeLogin=!!(cookies.accessToken||cookies.refreshToken);
  // Only the data-free application shell is rendered here; each API authorizes.
  // Expired sessions can refresh through the same-origin endpoint in the shell.
  if(!cookies.accessToken&&!cookies.refreshToken){try{await currentEmployee()}catch{redirect('/login')}}
 }else await requireChatGPTUser('/');
 return <Workspace standalone={employeeLogin}/>;
}
