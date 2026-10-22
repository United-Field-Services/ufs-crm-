import {requireChatGPTUser} from './chatgpt-auth';
import {standaloneMode,readAuthCookies} from '../lib/standalone-auth';
import {currentEmployee} from '../lib/server';
import {sectionPath} from '../lib/sections';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import Workspace from './workspace';
// Shared by every section address (/, /people, /time-off, ...): same checks, different starting section.
export async function WorkspaceRoute({section}:{section:string}){
 const path=sectionPath(section);
 let employeeLogin=false;
 if(standaloneMode()){
  const cookies=readAuthCookies(await headers());employeeLogin=!!(cookies.accessToken||cookies.refreshToken);
  // Only the data-free application shell is rendered here; each API authorizes.
  // Expired sessions can refresh through the same-origin endpoint in the shell.
  if(!cookies.accessToken&&!cookies.refreshToken){try{await currentEmployee()}catch{redirect(path==='/'?'/login':`/login?next=${encodeURIComponent(path)}`)}}
 }else await requireChatGPTUser(path);
 return <Workspace standalone={employeeLogin} initialPage={section}/>;
}
