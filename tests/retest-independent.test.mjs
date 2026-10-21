// Independent retest regression checks. Synthetic fixtures and local React DOM only;
// these do not establish real-browser layout, production auth, or live-data behavior.
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
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLFormElement','FormData','File','Event','MouseEvent','KeyboardEvent']){
 restored.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
 Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true,writable:true});
}
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const hook=registerHooks({
 resolve(specifier,context,next){try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)){for(const ext of ['.tsx','.ts'])try{return next(specifier+ext,context)}catch{}}throw error}},
 load(url,context,next){if(url.startsWith('file:')&&fileURLToPath(url).startsWith(rootPath)&&!url.includes('/node_modules/')){
  if(url.endsWith('.css'))return {format:'module',source:'export {};',shortCircuit:true};
  if(/\.tsx?$/.test(url))return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
 }return next(url,context)}
});
const {createElement,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const {default:Workspace}=await import('../app/workspace.tsx');
const realFetch=globalThis.fetch;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const year=Number(today.slice(0,4));
const makePerson=(id,fields={})=>({id,name:`Independent ${id}`,email:`${id}@example.invalid`,title:'Synthetic role',department:'Operations',division:'Corporate',location:'United States',employment:'Full-Time',hire_date:'2024-01-01',active:1,directory_active:1,role:'employee',demo:0,...fields});
function fixtures(role='admin'){
 const me=makePerson('self',{role});
 return {me,people:[me,makePerson('disabled-current',{active:0,manager_id:'self',location:'',division:'',department:''}),makePerson('direct',{manager_id:'self',location:'Asia',division:'Field',department:'Engineering'}),makePerson('other-team',{manager_id:'elsewhere',location:'Asia',division:'Field',department:'Engineering'}),makePerson('demo',{demo:1,manager_id:'self',location:'Asia',division:'Field',department:'Engineering'}),makePerson('former',{active:0,directory_active:0,location:'Asia'})],requests:[{id:'request-self',employee_id:'self',name:me.name,type:'Vacation',start_date:today,end_date:today,days:1,status:'pending'}],teamAway:[{id:'away',employee_id:'disabled-current',name:'Independent disabled-current',start_date:today,end_date:today}],documents:[{id:'company',name:'Independent company file',owner_id:'self',owner_name:me.name,visibility:'company',folder:'Policies',size:100,category:'Policy',uploaded_at:today+'T12:00:00Z',read_count:2},{id:'personal',name:'Independent personal file',owner_id:'self',owner_name:me.name,visibility:'personal',folder:'Private',size:100,category:'General',uploaded_at:today+'T12:00:00Z'}],events:[],balances:[{type:'Vacation',total:15,used:1,pending:1}],tasks:[],activity:[],year,currentYear:year,employeeBudgets:[],acknowledgements:[],importSummary:{employees:4,pendingAccess:1,formerEmployees:1,excluded:0,holidays:0,importedAt:today+'T12:00:00Z'},headcountSnapshot:{sourceLabel:'TalentHR',sourceUrl:'https://example.invalid/source',verifiedAt:today,rows:[{month:today.slice(0,7),label:'Recorded month',value:42}]}};
}
let data,container,root,calls,intercept;
const reply=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(value)});
async function fakeFetch(url,init={}){
 url=String(url);calls.push({url,method:init.method||'GET'});
 const overridden=await intercept?.(url,init);if(overridden)return overridden;
 if(url.startsWith('/api/state')){const chosen=new URL(url,'https://synthetic.invalid').searchParams.get('year');return reply({...data,year:chosen?Number(chosen):data.year});}
 if(url==='/api/action')return reply({ok:true});
 if(url.startsWith('/api/headcount-roster?'))return reply({month:today.slice(0,7),label:'Recorded month',asOf:today,reportedCount:42,supportedCount:0,reconciliation:'unavailable',sourceLabel:'TalentHR',verifiedAt:today,semantics:'imported_source_history',note:'No dated source membership records are available.',rows:[]});
 if(url==='/api/auth/refresh')return reply({authenticated:false},401);
 throw new Error(`Unexpected synthetic request ${url}`);
}
beforeEach(()=>{data=fixtures();calls=[];intercept=null;dom.window.sessionStorage.clear();container=document.createElement('div');document.body.append(container);root=createRoot(container);globalThis.fetch=fakeFetch;});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();globalThis.fetch=realFetch;});
after(()=>{hook.deregister();dom.window.close();for(const [name,descriptor]of restored){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}delete globalThis.IS_REACT_ACT_ENVIRONMENT});
const all=(selector,scope=container)=>[...scope.querySelectorAll(selector)];
const one=(selector,scope=container)=>{const el=scope.querySelector(selector);assert.ok(el,`Missing ${selector}`);return el;};
const button=(label,scope=container)=>{const match=all('button',scope).filter(b=>(b.getAttribute('aria-label')||b.textContent.trim())===label);assert.equal(match.length,1,`Expected button ${label}`);return match[0];};
const text=(scope=container)=>scope.textContent.replace(/\s+/g,' ').trim();
async function mount(role='admin'){data.me.role=role;await act(async()=>root.render(createElement(Workspace)));}
async function click(el){assert.ok(!el.disabled);await act(async()=>el.click());}
async function change(el,value){await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(el,String(value));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
async function nav(label){await click(all('aside.sidebar nav button').find(b=>b.querySelector('span')?.textContent===label));}
const visibleNames=()=>all('tbody .person-row-button strong').map(e=>e.textContent).sort();
const expectedNames=ids=>ids.map(id=>`Independent ${id}`).sort();

for(const role of ['admin','hr_manager','manager'])for(const dimension of ['Locations','Divisions','Departments'])test(`${role}: ${dimension} drilldown exactly matches filtered report members and resets safely`,async()=>{
 await mount(role);await click(button(dimension,one('.td-reports')));
 await change(one('[aria-label="Report source"]'),'review');
 await change(one('[aria-label="Filter by locations"]'),'Asia');
 const category={Locations:'Asia',Divisions:'Field',Departments:'Engineering'}[dimension];
 const ids=role==='manager'?['direct','demo']:['direct','other-team','demo'];
 await click(button(`${category}: ${ids.length} profiles`));
 assert.equal(one('.topbar strong').textContent,'People');assert.deepEqual(visibleNames(),expectedNames(ids));
 assert.match(text(),/Report filter:/);assert.equal(one('[aria-label="Filter location"]').value,'Asia');assert.doesNotMatch(text(one('tbody')),/former|disabled-current/);
 await click(button('Clear report filter'));assert.ok(visibleNames().includes('Independent disabled-current'));
 await nav('Overview');await click(button(dimension,one('.td-reports')));await click(button('Unassigned: 1 profiles'));
 assert.deepEqual(visibleNames(),expectedNames(['disabled-current']));assert.match(text(one('tbody')),/Current employee.*Login disabled/);
});

test('historical chart opens an evidence-only panel without substituting current employees',async()=>{
 await mount();const bar=button('Recorded month: 42 employees');await click(bar);assert.match(text(one('.td-chart-selection')),/42 employees.*TalentHR snapshot/);assert.match(text(one('.topbar')),/Overview/);assert.match(text(one('[role="dialog"]')),/Employee list unavailable/);assert.equal(all('.td-roster-list .td-person-row').length,0);await click(button('Close'));
 await act(async()=>bar.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));assert.match(text(one('.topbar')),/Overview/);
});

for(const role of ['admin','hr_manager','manager','hiring_manager','employee'])test(`${role}: Company files count/navigation excludes personal files and balances expand a leave-type detail`,async()=>{
 await mount(role);assert.match(text(one('.td-files-link')),/1 accessible file$/);await click(one('.td-files-link'));assert.equal(one('.segment button.active').textContent,'Company files');assert.equal(all('tbody tr').length,1);assert.match(text(one('tbody')),/Independent company file/);assert.doesNotMatch(text(one('tbody')),/Independent personal file/);
 assert.equal(text(one('tbody')).includes('2 read acknowledgements'),['admin','hr_manager'].includes(role));
 await nav('Overview');await click(button('View Vacation balances and requests'));assert.equal(one('.topbar strong').textContent,'Overview');assert.match(text(one('.td-my-detail')),/Vacation.*My requests/);await click(button('View all time-off requests'));assert.equal(one('.topbar strong').textContent,'Time off');
});

for(const status of [401,403])test(`${status}: genuine access loss clears protected DOM and keeps requested year for sign-in resume`,async()=>{
 await mount('employee');await nav('Time off');
 intercept=url=>url===`/api/state?year=${year+1}`?{ok:false,status,json:async()=>{throw new Error('Non-JSON authorization response')}}:null;
 await change(one('[aria-label="Balance year"]'),year+1);
 assert.equal(container.querySelector('aside.sidebar'),null);assert.doesNotMatch(text(),/Independent self|Independent direct|Vacation/);assert.match(text(),status===401?/session has ended/:/workspace access changed/);
 assert.equal(dom.window.sessionStorage.getItem('ufs-resume-balance-year'),String(year+1));assert.equal(calls.filter(c=>c.url==='/api/auth/refresh').length,status===401?1:0);
 intercept=null;await act(async()=>{root.unmount();root=createRoot(container);root.render(createElement(Workspace));});
 assert.equal(one('.topbar strong').textContent,'Time off');assert.equal(one('[aria-label="Balance year"]').value,String(year+1));assert.equal(dom.window.sessionStorage.getItem('ufs-resume-balance-year'),null);
});

test('expired authentication refreshed once preserves the selected year and workspace',async()=>{
 await mount('employee');await nav('Time off');let failures=0;
 intercept=url=>url==='/api/auth/refresh'?reply({authenticated:true}):url===`/api/state?year=${year+1}`&&failures++===0?reply({error:'Expired'},401):null;
 await change(one('[aria-label="Balance year"]'),year+1);assert.equal(one('[aria-label="Balance year"]').value,String(year+1));assert.ok(one('.leave-balances'));assert.equal(calls.filter(c=>c.url==='/api/auth/refresh').length,1);assert.equal(calls.filter(c=>c.url===`/api/state?year=${year+1}`).length,2);assert.doesNotMatch(text(),/session has ended/);
});

for(const ordering of ['older-denial','older-success'])test(`${ordering}: out-of-order state responses cannot overwrite the newer authorization result`,async()=>{
 await mount('employee');await nav('Time off');let release,reads=0;const gate=new Promise(resolve=>{release=resolve});
 intercept=async url=>{if(url!==`/api/state?year=${year+1}`)return null;if(++reads===1){await gate;return ordering==='older-denial'?reply({error:'Old denial'},403):reply({...data,year:year+1});}return ordering==='older-denial'?reply({...data,year:year+1}):reply({error:'New denial'},403);};
 try{await change(one('[aria-label="Balance year"]'),year+1);await click(button('Cancel',one('tbody')));}finally{await act(async()=>release());}
 if(ordering==='older-denial'){assert.equal(one('[aria-label="Balance year"]').value,String(year+1));assert.ok(one('.leave-balances'));assert.doesNotMatch(text(),/workspace access changed/);}else{assert.equal(container.querySelector('aside.sidebar'),null);assert.match(text(),/workspace access changed/);assert.doesNotMatch(text(),/Independent self|Vacation/);}
});

test('Calendar preserves prior location options and unrelated sparse-record behavior',async()=>{
 await mount();await nav('Calendar');await click(button('List',one('.calendar-panel')));assert.match(text(one('.calendar-agenda')),/Independent disabled-current/);
 assert.equal(all('[aria-label="Calendar location"] option').some(option=>option.value==='Unassigned'),false);
 await change(one('[aria-label="Calendar location"]'),'Asia');assert.doesNotMatch(text(one('.calendar-agenda')),/Independent disabled-current/);
 await change(one('[aria-label="Calendar location"]'),'');assert.match(text(one('.calendar-agenda')),/Independent disabled-current/);
});

for(const role of ['admin','hr_manager','manager'])test(`${role}: Headcount drilldown includes disabled current employees and supports a zero demo group`,async()=>{
 await mount(role);await change(one('[aria-label="Report source"]'),'real');
 const expected=role==='manager'?['self','direct','disabled-current']:['self','direct','disabled-current','other-team'];
 await click(button(`Non-demo profiles: ${expected.length} profiles`));assert.deepEqual(visibleNames(),expectedNames(expected));
 await nav('Overview');await change(one('[aria-label="Report source"]'),'review');await change(one('[aria-label="Filter by locations"]'),'United States');
 await click(button('Demo profiles: 0 profiles'));assert.equal(all('tbody tr').length,0);assert.match(text(),/No matching people/);assert.match(text(),/Headcount: Demo profiles/);
});
