// Real React DOM events, mocked fetch, and synthetic records only.
// JSDOM does not establish hosted/browser-pixel acceptance.
import {test,beforeEach,afterEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {JSDOM} from 'jsdom';
const rootPath=fileURLToPath(new URL('../',import.meta.url));
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://synthetic.invalid/'});
const restored=new Map();
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLFormElement','FormData','Event','MouseEvent']){restored.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true,writable:true})}
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const hook=registerHooks({
 resolve(specifier,context,next){try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)){for(const ext of ['.tsx','.ts'])try{return next(specifier+ext,context)}catch{}}throw error}},
 load(url,context,next){if(url.startsWith('file:')&&fileURLToPath(url).startsWith(rootPath)&&!url.includes('/node_modules/')){
  if(url.endsWith('.css'))return{format:'module',source:'export {};',shortCircuit:true};
  if(/\.tsx?$/.test(url))return{format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
 }return next(url,context)}
});
const {createElement,act}=await import('react'),{createRoot}=await import('react-dom/client');
const {OperationsPage}=await import('../app/operations.tsx');
const realFetch=globalThis.fetch;
let root,container,data,ops,calls,handler,refreshed;
const template=(id,name,kind='Onboarding')=>({id,name,kind,active:1,steps:[{title:'Synthetic step',assignee:'employee',offset:0}]});
const empty=()=>({templates:[],archivedTemplates:[],workflows:[],assets:[],announcements:[],timeEntries:[],acknowledgements:[]});
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(body)});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}};
beforeEach(()=>{
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 data={me:{id:'self',user_id:'synthetic-user',name:'Synthetic HR',role:'hr_manager',data_scope:'live',active:1},people:[{id:'subject',name:'Synthetic Employee',active:1}]};
 ops={...empty(),templates:[template('one','Synthetic Onboarding'),template('two','Synthetic Offboarding','Offboarding')],workflows:[{id:'run',name:'Existing checklist',kind:'Onboarding',employee_name:'Synthetic Employee',start_date:'2026-01-01',completed:0,total:1}]};calls=[];handler=null;refreshed=0;
 globalThis.fetch=async(url,init={})=>{
  const call={url:String(url),method:init.method||'GET',body:init.body?JSON.parse(init.body):null,signal:init.signal};calls.push(call);
  if(handler){const result=await handler(call);if(result)return result}
  if(call.method==='GET'&&call.url.startsWith('/api/operations?section='))return response(ops);
  if(call.url==='/api/operations'&&call.method==='POST'){
   const {action,id}=call.body;
   if(action==='archiveTemplate'){const row=ops.templates.find(t=>t.id===id);ops.templates=ops.templates.filter(t=>t.id!==id);ops.archivedTemplates.push({...row,active:0})}
   if(action==='restoreTemplate'){const row=ops.archivedTemplates.find(t=>t.id===id);ops.archivedTemplates=ops.archivedTemplates.filter(t=>t.id!==id);ops.templates.push({...row,active:1})}
   if(action==='readAnnouncement')ops.announcements.find(a=>a.id===id).read_at='2026-01-01';
   return response({ok:true,message:action==='archiveTemplate'?'Template archived. Existing checklists and tasks are unchanged.':'Saved'});
  }
  throw new Error('Unexpected synthetic request '+call.method+' '+call.url);
 };
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();globalThis.fetch=realFetch});
after(()=>{hook.deregister();dom.window.close();for(const[name,descriptor]of restored)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];delete globalThis.IS_REACT_ACT_ENVIRONMENT});
const mount=async(page='Workflows')=>act(async()=>root.render(createElement(OperationsPage,{page,data,onSaved:async()=>{refreshed++}})));
const all=(selector,within=container)=>Array.from(within.querySelectorAll(selector));
const query=(selector)=>container.querySelector(selector);
const text=()=>container.textContent;
const button=(name,within=container)=>all('button',within).find(el=>el.textContent===name||el.getAttribute('aria-label')===name);
const click=async(el)=>{assert.ok(el,'Expected button');await act(async()=>el.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})))};
const submit=async()=>act(async()=>query('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
const posts=()=>calls.filter(c=>c.method==='POST'&&c.url==='/api/operations');

test('archive confirmation is reversible, retains existing checklists, and prevents archived Start/Edit',async()=>{
 await mount();const row=all('.ops-template-list>div')[0];await click(button('Archive',row));
 assert.match(text(),/Existing employee checklists and assigned tasks will stay unchanged/);assert.match(text(),/cannot start new checklists/);
 await click(button('Cancel'));assert.equal(posts().length,0);assert.equal(query('form'),null);
 await click(button('Archive',row));await submit();assert.deepEqual(posts().map(p=>p.body),[{action:'archiveTemplate',id:'one'}]);
 assert.match(text(),/Existing checklist/);assert.equal(all('.ops-template-list>div').length,1);assert.equal(query('form'),null);
 await click(button('Archived templates'));const archived=all('.ops-template-list>div')[0];assert.match(archived.textContent,/Synthetic Onboarding/);
 assert.equal(button('Start',archived),undefined);assert.equal(button('Edit',archived),undefined);assert.equal(button('Archive',archived),undefined);
 await click(button('Restore',archived));assert.deepEqual(posts().map(p=>p.body.action),['archiveTemplate','restoreTemplate']);
 await click(button('Active templates'));assert.equal(all('.ops-template-list>div').length,2);assert.match(text(),/Existing checklist/);
});
test('archive duplicate submits are locked until the server responds',async()=>{
 await mount();await click(button('Archive'));const pending=deferred();handler=call=>call.method==='POST'?pending.promise:null;
 await act(async()=>{const form=query('form');form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))});
 assert.equal(posts().length,1);assert.equal(button('Saving…').disabled,true);assert.equal(button('Cancel').disabled,true);assert.equal(button('Close form').disabled,true);
 await act(async()=>pending.resolve(response({ok:true})));
});
test('failed archive preserves the confirmation and permits deliberate retry',async()=>{
 await mount();await click(button('Archive'));handler=call=>call.method==='POST'?response({error:'Synthetic archive failure'},409):null;await submit();
 assert.match(query('[role="alert"]').textContent,/Synthetic archive failure/);assert.ok(query('form'));assert.equal(button('Archive template').disabled,false);
 handler=null;await submit();assert.equal(query('form'),null);assert.equal(ops.archivedTemplates.length,1);
});
for(const role of ['manager','hiring_manager','employee'])test(`${role}: no template archive, restore, edit, or start controls`,async()=>{
 data.me.role=role;await mount();for(const label of ['Archive','Restore','Edit','Start','Create template','Archived templates'])assert.equal(button(label),undefined);assert.match(text(),/Existing checklist/);
});
test('workflow type filtering also applies to archived templates',async()=>{
 ops.archivedTemplates=[{...template('old-on','Archived Onboarding'),active:0},{...template('old-off','Archived Offboarding','Offboarding'),active:0}];
 await mount();await click(button('Archived templates'));await click(button('Offboarding'));assert.equal(all('.ops-template-list>div').length,1);assert.match(all('.ops-template-list>div')[0].textContent,/Archived Offboarding/);
});
for(const [page,section]of [['Workflows','workflows'],['Assets','assets'],['Company news','news'],['Time tracking','time']])test(`${page}: requests only its operations section`,async()=>{
 await mount(page);assert.equal(calls[0].url,'/api/operations?section='+section);assert.equal(calls.filter(c=>c.method==='GET').length,1);
});
test('initial loading failure offers Retry, then clears the error on success',async()=>{
 handler=()=>response({error:'Synthetic temporary failure'},503);await mount();assert.match(text(),/Synthetic temporary failure/);assert.ok(button('Retry'));assert.doesNotMatch(text(),/Synthetic Onboarding/);
 handler=null;await click(button('Retry'));assert.match(text(),/Synthetic Onboarding/);assert.equal(query('[role="alert"]'),null);
});
test('committed archive stays committed if refresh fails and Retry does not repeat POST',async()=>{
 await mount();await click(button('Archive'));handler=call=>call.method==='GET'?response({error:'Synthetic refresh failure'},503):null;await submit();
 assert.equal(ops.archivedTemplates.length,1);assert.equal(query('form'),null);assert.match(query('[role="status"]').textContent,/Template archived/);assert.match(query('[role="status"]').textContent,/Retry/);
 handler=null;await click(button('Retry'));assert.equal(posts().length,1);await click(button('Archived templates'));assert.match(text(),/Synthetic Onboarding/);
});
for(const status of [401,403])test(`final ${status} on refresh clears previously loaded protected operations`,async()=>{
 await mount();await click(button('Archive'));
 handler=call=>call.url==='/api/auth/refresh'?response({authenticated:false},401):call.method==='GET'?response({error:'Synthetic access change'},status):null;
 await submit();assert.doesNotMatch(text(),/Synthetic Onboarding|Synthetic Offboarding|Existing checklist/);assert.ok(button('Reload workspace'));assert.match(query('[role="alert"]').textContent,status===401?/session has ended/:/access changed/);assert.ok(refreshed>=1);
});
test('permission-denied mutation clears protected records and asks parent to recheck access',async()=>{
 await mount();await click(button('Archive'));handler=call=>call.method==='POST'?response({error:'Synthetic permission change'},403):null;await submit();
 assert.doesNotMatch(text(),/Synthetic Onboarding|Existing checklist/);assert.match(text(),/access changed/);assert.equal(refreshed,1);
});
test('late page response cannot replace the current module or revive an old error',async()=>{
 const old=deferred();handler=call=>call.url.endsWith('workflows')?old.promise:null;await mount();assert.match(text(),/Loading workflows/);
 await mount('Assets');assert.match(text(),/Your asset register is ready/);assert.equal(calls[0].signal.aborted,true);
 await act(async()=>old.resolve(response({error:'Stale workflow failure'},500)));assert.match(text(),/Your asset register is ready/);assert.doesNotMatch(text(),/Stale workflow failure|Synthetic Onboarding/);
});
for(const change of ['identity','role','scope'])test(`${change} change immediately removes the old module and draft`,async()=>{
 await mount();await click(button('Create template'));assert.ok(query('form'));
 const pending=deferred();handler=call=>call.method==='GET'?pending.promise:null;
 data={...data,me:{...data.me,...(change==='identity'?{id:'new-user',user_id:'new-subject'}:change==='role'?{role:'employee'}:{data_scope:'qa-bots-v1'})}};
 await mount();assert.equal(query('form'),null);assert.doesNotMatch(text(),/Synthetic Onboarding|Existing checklist/);assert.match(text(),/Loading workflows/);
 await act(async()=>pending.resolve(response(empty())));assert.doesNotMatch(text(),/Synthetic Onboarding/);
});
test('late read from a previous identity cannot override a newer successful read',async()=>{
 const old=deferred();handler=()=>old.promise;await mount();data={...data,me:{...data.me,id:'new-user',user_id:'new-subject'}};
 handler=()=>response({...empty(),templates:[template('fresh','New identity template')]});await mount();assert.match(text(),/New identity template/);
 await act(async()=>old.resolve(response(ops)));assert.match(text(),/New identity template/);assert.doesNotMatch(text(),/Synthetic Onboarding/);
});
test('leaving the page during a POST does not refresh or close a newer page',async()=>{
 await mount();await click(button('Archive'));const pending=deferred();handler=call=>call.method==='POST'?pending.promise:null;await submit();await mount('Assets');
 await act(async()=>pending.resolve(response({ok:true})));assert.equal(refreshed,0);assert.match(text(),/Your asset register is ready/);assert.doesNotMatch(text(),/Saved|Template archived/);
});
test('HR company news explains own acknowledgement and preserves Mark as read',async()=>{
 ops.announcements=[{id:'news',title:'Synthetic notice',body:'Synthetic message',category:'News',status:'published',created_at:'2026-01-01',author:'Synthetic author',read_count:0,read_at:null}];
 await mount('Company news');assert.match(text(),/only your own acknowledgement, including for HR/);assert.match(text(),/does not mark the announcement as read for anyone else/);
 await click(button('Mark as read'));assert.deepEqual(posts()[0].body,{action:'readAnnouncement',id:'news'});assert.equal(button('Read').disabled,true);
});

test('a pending retry cannot repopulate protected records after a denied mutation',async()=>{
 await mount();await click(button('Archive'));
 handler=call=>call.method==='GET'?response({error:'Synthetic temporary refresh failure'},503):null;await submit();
 const pending=deferred();handler=call=>call.method==='GET'?pending.promise:call.method==='POST'?response({error:'Synthetic denied mutation'},403):null;
 await click(button('Retry'));const retry=calls.at(-1);await click(button('Archive'));await submit();
 assert.ok(retry.signal.aborted);assert.match(text(),/access changed/);assert.doesNotMatch(text(),/Synthetic Onboarding|Existing checklist/);
 await act(async()=>pending.resolve(response(ops)));
 assert.match(text(),/access changed/);assert.doesNotMatch(text(),/Synthetic Onboarding|Existing checklist/);assert.equal(query('[aria-busy]').getAttribute('aria-busy'),'false');
});
