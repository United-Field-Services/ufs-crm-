// React DOM event QA against the unchanged application components. JSDOM is not
// a browser: these checks do not establish layout, real-account, or device QA.
// Every record and every fetch response is synthetic; no network calls are made.
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
const month=today.slice(0,7),year=Number(today.slice(0,4));
const first=month+'-01',lastMonth=new Date(first+'T12:00:00Z');lastMonth.setUTCDate(0);
const prevLast=lastMonth.toISOString().slice(0,10);
const makePerson=(id,name,fields={})=>({id,name,email:id+'@example.invalid',title:'Synthetic role',department:'Operations',division:'Corporate',location:'United States',employment:'Full-Time',hire_date:'2024-01-01',active:1,directory_active:1,role:'employee',demo:0,annual_allowance:15,sick_allowance:5,wfh_allowance:30,bereavement_allowance:3,...fields});
function fixtures(role='admin'){
 const me=makePerson('self','Synthetic Self',{role});
 const people=[me,makePerson('alpha','Synthetic Alpha',{department:'Engineering',division:'Field',location:'Asia',manager_id:'self'}),makePerson('beta','Synthetic Beta',{department:'People',division:'Corporate',location:'Europe'}),makePerson('pending','Synthetic Pending',{active:0,imported:1}),makePerson('former','Synthetic Former',{active:0,directory_active:0,imported:1}),makePerson('demo','Synthetic Demo',{demo:1})];
 const data={me,people,requests:[{id:'leave-self',employee_id:'self',name:me.name,type:'Vacation',start_date:today,end_date:today,days:1,note:'Synthetic leave note',status:'pending',required_manager_id:'beta',manager_name:'Synthetic Beta'}],teamAway:[{id:'away-alpha',employee_id:'alpha',name:'Synthetic Alpha',start_date:first,end_date:month+'-03'},{id:'away-beta',employee_id:'beta',name:'Synthetic Beta',start_date:first,end_date:month+'-03'}],documents:[{id:'file-self',owner_id:'self',owner_name:me.name,name:'Synthetic notes.txt',category:'General',folder:'Unsorted',visibility:'personal',size:128,uploaded_at:today+'T12:00:00Z'},{id:'file-company',owner_id:'beta',owner_name:'Synthetic Beta',name:'Synthetic handbook.pdf',category:'Policy',folder:'Policies',visibility:'company',size:2048,uploaded_at:today+'T12:00:00Z'}],events:[{id:'event-all',title:'Synthetic company day',date:first,kind:'Company event',location:'All locations'},{id:'event-eu',title:'Synthetic Europe holiday',date:first,kind:'Holiday',location:'Europe'}],balances:[{type:'Vacation',total:15,used:1,pending:1},{type:'Sick Leave',total:5,used:0,pending:0},{type:'WFH',total:30,used:0,pending:0},{type:'Bereavement',total:3,used:0,pending:0}],tasks:[{id:'task-self',title:'Synthetic checklist task',assignee_id:'self',assignee_name:me.name,due_date:today,status:'pending'}],activity:[],year,employeeBudgets:[],acknowledgements:[],importSummary:{completed:true,employees:4,pendingAccess:1,formerEmployees:1,excluded:0,holidays:1,importedAt:today+'T12:00:00Z'}};
 const ops={templates:[{id:'template-on',name:'Synthetic onboarding',kind:'Onboarding',steps:[{title:'Synthetic review step',assignee:'employee',offset:0,description:''}]},{id:'template-off',name:'Synthetic offboarding',kind:'Offboarding',steps:[{title:'Synthetic return step',assignee:'hr',offset:0,description:''}]}],workflows:[],assets:[{id:'asset-one',name:'Synthetic laptop',tag:'QA-001',category:'Laptop',serial:'SYNTHETIC-001',status:'available'}],announcements:[{id:'news-one',title:'Synthetic welcome',body:'Synthetic company update',category:'Company news',status:'published',pinned:0,created_at:today+'T12:00:00Z',author:'Synthetic HR',read_count:0}],timeEntries:[],acknowledgements:[]};
 return {data,ops,profiles:new Map(),calls:[],fail:null};
}
let state,container,root;
function profile(id){
 if(!state.profiles.has(id)){
  const p=state.data.people.find(p=>p.id===id),hr=['admin','hr_manager'].includes(state.data.me.role),own=id===state.data.me.id;
  state.profiles.set(id,{profile:{...p,employment_status:'Active'},access:{private:hr||own,employment:hr||own,compensation:hr||own,hr,editable:hr||own},emergencyContacts:[],identifiers:[],compensation:[],history:[],education:[],benefits:[]});
 }return state.profiles.get(id);
}
function reply(data,status=200){return Promise.resolve({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)})}
async function fakeFetch(url,init={}){
 const method=init.method||'GET',body=typeof init.body==='string'?JSON.parse(init.body):init.body;
 state.calls.push({url:String(url),method,body});
 if(state.defer&&state.defer.matches(url,method,body))await state.defer.promise;
 if(state.fail&&state.fail(url,method,body))return reply({error:'Synthetic save failed. Try again.'},400);
 if(String(url).startsWith('/api/state')){const chosen=new URL(String(url),'https://synthetic.invalid').searchParams.get('year');return reply(chosen?{...state.data,currentYear:state.data.year,year:Number(chosen),balances:state.balancesByYear?.[chosen]||state.data.balances}:state.data);}
 if(String(url).startsWith('/api/operations')&&method==='GET')return reply(state.ops);
 if(String(url).startsWith('/api/headcount-roster?'))return reply(state.roster||{error:'No synthetic period roster'},state.roster?200:404);
 if(String(url).startsWith('/api/profiles/')){
  const p=profile(decodeURIComponent(String(url).split('/').at(-1)));
  if(method==='POST'){
   if(body.action==='update_personal'||body.action==='update_employment')Object.assign(p.profile,body.values);
   const records={save_emergency_contact:['emergencyContacts','contact'],save_education:['education','education'],save_identifier:['identifiers','identifier'],save_benefit:['benefits','benefit']};
   if(records[body.action]){const [list,key]=records[body.action];p[list].push({...body[key],id:'created-'+list})}
   if(body.action==='add_compensation'||body.action==='add_bonus')p.compensation.push({...body.record,id:'comp-new',record_type:body.action==='add_bonus'?'Bonus':'Base pay',created_at:today+'T12:00:00Z'});
  }return reply(p);
 }
 if(url==='/api/action'&&method==='POST'){
  if(body.action==='toggleTask')Object.assign(state.data.tasks.find(t=>t.id===body.id),{status:body.status});
  if(body.action==='createTask')state.data.tasks.push({id:'task-new',title:body.title,assignee_id:body.assigneeId,assignee_name:state.data.people.find(p=>p.id===body.assigneeId)?.name,due_date:body.dueDate,status:'pending'});
  if(body.action==='requestLeave')state.data.requests.push({id:'leave-new',employee_id:'self',name:state.data.me.name,type:body.type,start_date:body.startDate,end_date:body.endDate,days:0.5,note:body.note,status:'pending'});
  if(body.action==='cancelLeave')Object.assign(state.data.requests.find(r=>r.id===body.id),{status:'cancelled'});
  if(body.action==='addEvent')state.data.events.push({...body,id:'event-new'});
  if(body.action==='createEmployee')state.data.people.push(makePerson('person-new',body.name,{...body,hire_date:body.hireDate,active:0}));
  return reply({ok:true});
 }
 if(url==='/api/operations'&&method==='POST'){
  if(body.action==='saveAsset')state.ops.assets.push({...body,id:'asset-new',status:'available'});
  if(body.action==='assignAsset')Object.assign(state.ops.assets.find(a=>a.id===body.id),{status:'assigned',employee_name:state.data.people.find(p=>p.id===body.employeeId)?.name,return_due:body.returnDue});
  if(body.action==='returnAsset')Object.assign(state.ops.assets.find(a=>a.id===body.id),{status:'available',employee_name:null});
  if(body.action==='setAssetStatus')Object.assign(state.ops.assets.find(a=>a.id===body.id),{status:body.status});
  if(body.action==='saveTemplate')state.ops.templates.push({...body,id:'template-new'});
  if(body.action==='applyTemplate'){const t=state.ops.templates.find(t=>t.id===body.templateId);state.ops.workflows.push({id:'workflow-new',name:t.name,kind:t.kind,employee_name:state.data.people.find(p=>p.id===body.employeeId)?.name,start_date:body.startDate,completed:0,total:t.steps.length})}
  if(body.action==='saveAnnouncement')state.ops.announcements.push({...body,id:'news-new',created_at:today+'T12:00:00Z',author:'Synthetic Self',read_count:0});
  if(body.action==='readAnnouncement')Object.assign(state.ops.announcements.find(a=>a.id===body.id),{read_at:today});
  if(body.action==='acknowledgeDocument')state.data.acknowledgements.push({document_id:body.id});
  if(body.action==='saveTime')state.ops.timeEntries.push({...body,id:'time-new',employee_id:'self',employee_name:state.data.me.name,required_manager_id:'beta',status:'draft'});
  if(body.action==='submitTime')Object.assign(state.ops.timeEntries.find(t=>t.id===body.id),{status:'submitted'});
  return reply({ok:true});
 }
 if(url==='/api/files'&&method==='POST'){(state.uploaded||=[]).push(body);return reply({ok:true})}
 if(String(url).startsWith('/api/files/')&&method==='PATCH'){Object.assign(state.data.documents.find(d=>d.id===url.split('/').at(-1)),body);return reply({ok:true})}
 throw new Error('Unexpected synthetic request '+method+' '+url);
}
beforeEach(()=>{dom.window.sessionStorage.clear();state=fixtures();container=document.createElement('div');document.body.append(container);root=createRoot(container);globalThis.fetch=fakeFetch;dom.window.confirm=()=>true});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();globalThis.fetch=realFetch});
after(()=>{hook.deregister();dom.window.close();for(const [name,descriptor]of restored){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}delete globalThis.IS_REACT_ACT_ENVIRONMENT});
async function mount(role='admin',prepare){state=fixtures(role);prepare?.(state);await act(async()=>root.render(createElement(Workspace)))}
const query=(selector,scope=container)=>{const el=scope.querySelector(selector);assert.ok(el,'Expected element '+selector);return el};
const all=(selector,scope=container)=>[...scope.querySelectorAll(selector)];
const textOf=(scope=container)=>scope.textContent.replace(/\s+/g,' ').trim();
function button(label,scope=container){const found=all('button',scope).filter(b=>(b.getAttribute('aria-label')||b.textContent.trim())===label);assert.equal(found.length,1,'Expected one button '+label+'; found '+found.length);return found[0]}
async function click(el){assert.ok(el&&!el.disabled,'Click target should be enabled');await act(async()=>el.click())}
async function change(el,value){await act(async()=>{if(el.type==='checkbox'){el.click();return}const proto=el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,String(value));el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));if(el.tagName!=='SELECT')el.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})}
async function fill(values,scope=container){for(const [name,value]of Object.entries(values))await change(query(`[name="${name}"]`,scope),value)}
async function submit(form,validate=true){if(validate)assert.equal(form.checkValidity(),true,'Synthetic form must satisfy native HTML constraints');await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))}
async function nav(label){const sidebar=query('aside.sidebar');const found=all('nav button',sidebar).find(b=>b.querySelector('span')?.textContent===label)||button(label,sidebar);await click(found)}
const lastPost=(path)=>state.calls.filter(c=>c.method==='POST'&&(!path||c.url===path)).at(-1);
const roles=['admin','hr_manager','manager','hiring_manager','employee'];

for(const role of roles)test(`${role}: sidebar navigates every available workspace module using real DOM clicks`,async()=>{
 await mount(role);const names=all('nav button',query('aside.sidebar')).map(b=>b.querySelector('span').textContent);
 assert.equal(names.includes('Reports'),['admin','hr_manager','manager'].includes(role));
 for(const label of names){await nav(label);const expected=label==='My checklists'?'Workflows':label==='My equipment'?'Assets':label;assert.equal(query('.topbar strong').textContent,expected);assert.doesNotMatch(textOf(),/Opening your workspace|Loading workspace records/);assert.equal(all('nav button[aria-current="page"]').length,1)}
 await nav('Settings');assert.match(textOf(query('main')),/Secure by design/);
});

test('directory search, combined filters, view switch and global search change displayed records',async()=>{
 await mount();await nav('People');assert.equal(all('tbody tr').length,4);
 await change(query('[aria-label="Filter department"]'),'Engineering');await change(query('[aria-label="Filter location"]'),'Asia');await change(query('[aria-label="Filter division"]'),'Field');assert.equal(all('tbody tr').length,1);assert.match(textOf(query('tbody')),/Synthetic Alpha/);
 await change(query('[aria-label="Search directory"]'),'no match');assert.match(textOf(),/No matching people/);
 await change(query('[aria-label="Search directory"]'),'alpha');await click(button('Directory',query('.toolbar')));assert.equal(all('.person-card').length,1);
 await nav('Overview');await change(query('[aria-label="Search employees"]'),'beta');await submit(query('.global-search'));assert.equal(query('[aria-label="Filter department"]').value,'All');assert.equal(query('[aria-label="Search directory"]').value,'beta');assert.match(textOf(query('.people-grid')),/Synthetic Beta/);assert.equal(all('.global-search').length,0);await nav('Overview');assert.equal(query('[aria-label="Search employees"]').value,'');
});
test('directory current, former, inactive and demo selectors separate synthetic records',async()=>{
 await mount();await nav('People');assert.doesNotMatch(textOf(query('tbody')),/Synthetic Former|Synthetic Demo/);assert.match(textOf(query('tbody')),/Synthetic Pending/);
 await change(query('[aria-label="Filter employment group"]'),'Former');assert.equal(all('tbody tr').length,1);assert.match(textOf(query('tbody')),/Synthetic Former/);assert.equal(button('Org chart',query('.toolbar')).disabled,true);
 await change(query('[aria-label="Filter employment group"]'),'Current');await change(query('[aria-label="Filter login access"]'),'Disabled');assert.equal(all('tbody tr').length,1);assert.match(textOf(query('tbody')),/Current employee.*Login disabled/);await change(query('[aria-label="Filter login access"]'),'All');
 await change(query('[aria-label="Filter department"]'),'All');await click(button('Include demo profiles'));assert.match(textOf(query('tbody')),/Synthetic Demo/);
});
for(const role of roles)test(`${role}: colleague profile sections reflect server-provided permissions`,async()=>{
 await mount(role);await nav('People');await click(query('.person-row-button',all('tbody tr').find(tr=>tr.textContent.includes('Synthetic Alpha'))));
 const tabs=all('[role="tab"]',query('.profile-tabs')).map(e=>e.textContent);const hr=['admin','hr_manager'].includes(role);
 assert.deepEqual(tabs,hr?['Overview','Personal','Contact','Emergency','Job','Education','Compensation','Benefits','Identifiers','History']:['Overview','Job']);
 for(const label of tabs){await click(button(label,query('.profile-tabs')));assert.equal(query('[role="tabpanel"]').getAttribute('aria-labelledby'),'profile-tab-'+label)}
 await click(button('Close'));assert.equal(all('[role="dialog"]').length,0);
});
test('self profile can save personal edits, block dirty tab changes, reset and close dirty modal safely',async()=>{
 await mount('employee');await nav('People');await click(query('.person-row-button',all('tbody tr').find(tr=>tr.textContent.includes('Synthetic Self'))));await click(button('Personal',query('.profile-tabs')));
 await fill({preferred_name:'Synthetic Nickname'});assert.equal(query('.profile-root').dataset.profileDirty,'true');await click(button('Contact',query('.profile-tabs')));assert.match(textOf(query('[role="alert"]')),/Keep your changes/);await click(button('Keep editing'));
 dom.window.confirm=()=>false;await click(button('Close'));assert.ok(query('[role="dialog"]'));
 await submit(query('[role="tabpanel"] form'));assert.equal(lastPost().body.values.preferred_name,'Synthetic Nickname');assert.match(textOf(query('[role="status"]')),/Personal information saved/);assert.equal(query('.profile-root').dataset.profileDirty,'false');
 await fill({preferred_name:'Unsaved'});await click(button('Reset'));assert.equal(query('[name="preferred_name"]').value,'Synthetic Nickname');await click(button('Contact',query('.profile-tabs')));assert.equal(query('[role="tabpanel"]').id,'profile-panel-Contact');
});
test('profile save failure preserves typed values and allows an explicit retry',async()=>{
 await mount('employee');await nav('My profile');await click(button('Personal',query('.profile-tabs')));await fill({preferred_name:'Keep this draft'});state.fail=(url,method)=>String(url).startsWith('/api/profiles/')&&method==='POST';await submit(query('[role="tabpanel"] form'));assert.match(textOf(query('[role="alert"]')),/Synthetic save failed/);assert.equal(query('[name="preferred_name"]').value,'Keep this draft');assert.equal(query('.profile-root').dataset.profileDirty,'true');state.fail=null;await submit(query('[role="tabpanel"] form'));assert.match(textOf(query('[role="status"]')),/Personal information saved/);
});
for(const [tab,add,values,action,payload]of [
 ['Emergency','Add contact',{name:'Synthetic Contact',relationship:'Synthetic colleague',phone:'555-0100'},'save_emergency_contact','contact'],
 ['Education','Add education',{institution:'Synthetic Institute',degree:'Synthetic qualification'},'save_education','education'],
 ['Identifiers','Add metadata',{type:'Passport',country:'Synthetic country',last4:'A123'},'save_identifier','identifier'],
 ['Benefits','Add benefit record',{type:'Wellness',plan:'Synthetic wellness plan'},'save_benefit','benefit'],
])test(`HR profile ${tab} opens an editor and submits its synthetic record`,async()=>{
 await mount();await nav('My profile');await click(button(tab,query('.profile-tabs')));await click(button(add));await fill(values,query('.profile-record-editor'));await submit(query('.profile-record-editor form'));assert.equal(lastPost().body.action,action);for(const [key,value]of Object.entries(values))assert.equal(lastPost().body[payload][key],value);assert.equal(all('.profile-record-editor').length,0);assert.match(textOf(query('[role="status"]')),/saved/);
});
test('HR profile compensation records a synthetic bonus without payment behavior',async()=>{
 await mount();await nav('My profile');await click(button('Compensation',query('.profile-tabs')));await click(button('Bonus'));await fill({amount:'123.45',reason:'Synthetic QA bonus'});await submit(query('[role="tabpanel"] form'));assert.equal(lastPost().body.action,'add_bonus');assert.equal(lastPost().body.record.amount,123.45);assert.match(textOf(query('[role="status"]')),/No payment has been initiated/);
});
for(const role of roles)test(`${role}: time-off request form sends half-day dates, attachment and note`,async()=>{
 await mount(role);await nav('Time off');await click(button('Request time off',query('.page-heading')));await fill({type:'Vacation',startDate:today,endDate:today,hours:'4',attachmentId:'file-self',note:'Synthetic request'});await submit(query('[role="dialog"] form'));assert.deepEqual(lastPost('/api/action').body,{action:'requestLeave',type:'Vacation',startDate:today,endDate:today,hours:'4',attachmentId:'file-self',note:'Synthetic request'});assert.equal(all('[role="dialog"]').length,0);assert.match(textOf(query('[role="status"]')),/submitted/);
});
test('leave form keeps entered values after an API error and closes using Escape',async()=>{
 await mount('employee');await nav('Time off');await click(button('Request time off',query('.page-heading')));await fill({note:'Keep synthetic note'});state.fail=(url)=>url==='/api/action';await submit(query('[role="dialog"] form'));assert.equal(query('[name="note"]').value,'Keep synthetic note');assert.match(textOf(query('[role="status"]')),/Synthetic save failed/);await act(async()=>dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(all('[role="dialog"]').length,0);
});
test('task completion, reopen, filters and task template submission update the UI',async()=>{
 await mount();await nav('Tasks');await click(button('Complete task'));assert.equal(lastPost('/api/action').body.status,'completed');await click(button('To do'));assert.match(textOf(),/Nothing on your list/);await click(button('Completed'));await click(button('Reopen task'));await click(button('All tasks'));assert.ok(button('Complete task'));
 await click(button('Onboarding: review the employee handbook'));assert.equal(query('[name="title"]').value,'Onboarding: review the employee handbook');await fill({title:'Synthetic new task',assigneeId:'alpha'});await submit(query('[role="dialog"] form'));assert.equal(lastPost('/api/action').body.assigneeId,'alpha');assert.match(textOf(query('.task-list')),/Synthetic new task/);
});
test('calendar changes month, returns to today, switches view and filters events and absences',async()=>{
 await mount();await nav('Calendar');const label=query('.calendar-heading h3').textContent;await click(button('Next month'));assert.notEqual(query('.calendar-heading h3').textContent,label);await click(button('Previous month'));assert.equal(query('.calendar-heading h3').textContent,label);await click(button('Next month'));await click(button('Today',query('.calendar-panel')));assert.equal(query('.calendar-heading h3').textContent,label);
 await click(button('List',query('.calendar-panel')));assert.match(textOf(query('.calendar-agenda')),/Synthetic Alpha · Away|Synthetic Beta · Away/);await change(query('[aria-label="Calendar location"]'),'Asia');assert.match(textOf(query('.calendar-agenda')),/Synthetic Alpha · Away/);assert.doesNotMatch(textOf(query('.calendar-agenda')),/Synthetic Beta|Synthetic Europe holiday/);assert.match(textOf(query('.calendar-agenda')),/Synthetic company day/);
});
test('HR employee and calendar-event creation forms submit through their actions',async()=>{
 await mount();await nav('People');await click(button('Add employee'));await fill({name:'Synthetic New Person',email:'new@example.invalid',title:'Synthetic Analyst'});await change(departmentSelect(),'__new__');await change(query('[aria-label="New department name"]'),'  Operations  ');await submit(query('[role="dialog"] form'));assert.equal(lastPost('/api/action').body.action,'createEmployee');assert.equal(lastPost('/api/action').body.department,'Operations');assert.match(textOf(query('tbody')),/Synthetic New Person/);
 await nav('Calendar');await click(button('Add event'));await fill({title:'Synthetic extra event',kind:'Holiday',location:'Asia'});await submit(query('[role="dialog"] form'));assert.equal(lastPost('/api/action').body.action,'addEvent');assert.equal(lastPost('/api/action').body.location,'Asia');
});
for(const role of roles)test(`${role}: file search, folders, upload controls and metadata stay interactive`,async()=>{
 await mount(role);await nav('Files');await change(query('[aria-label="Filter file folder"]'),'Policies');assert.equal(all('tbody tr').length,1);assert.match(textOf(query('tbody')),/Synthetic handbook/);await change(query('[aria-label="Find a file"]'),'missing');assert.match(textOf(),/No matching files/);await change(query('[aria-label="Find a file"]'),'');
 await click(button('Upload document',query('.page-heading')));const form=query('[role="dialog"] form'),file=query('input[type="file"]',form);assert.equal(file.accept,'.pdf,.docx,.png,.jpg,.jpeg,.txt');assert.equal(file.required,true);const hr=['admin','hr_manager'].includes(role);assert.equal(!!form.querySelector('[name="employeeId"]'),hr);assert.deepEqual(all('[name="visibility"] option',form).map(o=>o.value),hr?['personal','hr','company']:['personal']);await fill({folder:'Synthetic folder',category:'General'},form);
 // JSDOM has no OS file picker. Submit the actual form as a DOM event and
 // validate its FormData envelope and metadata; file bytes are backend-tested.
 await submit(form,false);const sent=lastPost('/api/files');assert.ok(sent.body instanceof dom.window.FormData);assert.equal(sent.body.get('folder'),'Synthetic folder');assert.ok(sent.body.get('file') instanceof dom.window.File);assert.equal(all('[role="dialog"]').length,0);
});
test('file manage saves metadata and company read acknowledgement changes its row',async()=>{
 await mount('employee');await nav('Files');const own=all('tbody tr').find(tr=>tr.textContent.includes('Synthetic notes'));await click(button('Manage',own));await fill({name:'Synthetic renamed.txt',folder:'Synthetic folder'});await submit(query('[role="dialog"] form'));assert.match(textOf(query('tbody')),/Synthetic renamed.txt/);const company=all('tbody tr').find(tr=>tr.textContent.includes('Synthetic handbook'));await click(button('Mark read',company));assert.equal(lastPost('/api/operations').body.action,'acknowledgeDocument');assert.match(textOf(query('tbody')),/Read acknowledged/);
});
test('asset register creates, assigns, returns and filters a synthetic asset',async()=>{
 await mount();await nav('Assets');await click(button('Add asset'));await fill({name:'Synthetic monitor',tag:'QA-MONITOR'});await submit(query('.ops-form'));assert.equal(lastPost('/api/operations').body.action,'saveAsset');const row=all('tbody tr').find(tr=>tr.textContent.includes('Synthetic monitor'));await click(button('Assign',row));await fill({employeeId:'alpha',returnDue:today});await submit(query('.ops-form'));assert.equal(lastPost('/api/operations').body.action,'assignAsset');await click(button('Assigned',query('.ops-page .toolbar')));assert.equal(all('tbody tr').length,1);await click(button('Record return'));assert.match(textOf(),/Your asset register is ready/);await click(button('Available',query('.ops-page .toolbar')));assert.equal(all('tbody tr').length,2);
});
test('workflow template edits controlled steps, changes type and starts assigned checklist',async()=>{
 await mount();await nav('Workflows');await click(button('Create template'));await fill({name:'Synthetic checklist'});await change(query('.ops-form select'),'Offboarding');assert.equal(all('.ops-step').length,5);await change(query('[aria-label="Step 1 title"]'),'Synthetic first step');await click(button('Add step'));assert.equal(all('.ops-step').length,6);await change(query('[aria-label="Step 6 title"]'),'Synthetic last step');await click(button('Remove step 2'));assert.equal(all('.ops-step').length,5);await submit(query('.ops-form'));const saved=lastPost('/api/operations').body;assert.equal(saved.action,'saveTemplate');assert.equal(saved.kind,'Offboarding');assert.equal(saved.steps[0].title,'Synthetic first step');assert.equal(saved.steps.length,5);
 await click(button('Offboarding',query('.ops-page .toolbar')));const card=all('.ops-template-list > div').find(el=>el.textContent.includes('Synthetic checklist'));await click(button('Start',card));assert.ok(!all('[name="employeeId"] option').some(o=>['pending','former'].includes(o.value)));await fill({employeeId:'alpha'});await submit(query('.ops-form'));assert.equal(lastPost('/api/operations').body.action,'applyTemplate');assert.match(textOf(query('tbody')),/Synthetic Alpha/);
});
test('news draft form and published read acknowledgement respond to clicks',async()=>{
 await mount();await nav('Company news');await click(button('New announcement'));await fill({title:'Synthetic draft',body:'Synthetic body'});await click(query('[name="pinned"]'));await submit(query('.ops-form'));assert.deepEqual(lastPost('/api/operations').body,{action:'saveAnnouncement',title:'Synthetic draft',body:'Synthetic body',category:'Company news',status:'draft',pinned:true});assert.match(textOf(),/Synthetic draft/);await click(button('Mark as read'));assert.equal(button('Read').disabled,true);
});
for(const role of roles)test(`${role}: manual time entry saves exact minutes, submits, and filters`,async()=>{
 await mount(role);await nav('Time tracking');await click(button('Log time'));await fill({hours:'7.25',project:'Synthetic QA',notes:'Synthetic summary'});await submit(query('.ops-form'));assert.equal(lastPost('/api/operations').body.minutes,435);assert.equal(lastPost('/api/operations').body.action,'saveTime');assert.match(textOf(query('tbody')),/7.25/);await click(button('Submit',query('tbody')));assert.equal(lastPost('/api/operations').body.action,'submitTime');await click(button('Draft',query('.ops-page .toolbar')));assert.equal(all('tbody tr').length,0);await click(button('Submitted',query('.ops-page .toolbar')));assert.equal(all('tbody tr').length,1);
});

// Regression expectations for independently reproduced and repaired UX defects.
test('calendar agenda includes an approved absence that began in the previous month',async()=>{
 await mount('admin',state=>{state.data.teamAway=[{id:'cross-month',employee_id:'alpha',name:'Synthetic Cross Month',start_date:prevLast,end_date:month+'-02'}]});await nav('Calendar');assert.match(textOf(query('.calendar-grid')),/Synthetic Cross Month/);await click(button('List',query('.calendar-panel')));assert.match(textOf(query('.calendar-agenda')),/Synthetic Cross Month/);
});
test('task assignee choices exclude inactive and former accounts',async()=>{
 await mount();await nav('Tasks');await click(button('Create task',query('.page-heading')));assert.ok(!all('[name="assigneeId"] option').some(o=>['pending','former'].includes(o.value)),'Task assignees must be active accounts');
});
test('leaving an unsaved My profile section honors the discard confirmation',async()=>{
 await mount('employee');await nav('My profile');await click(button('Personal',query('.profile-tabs')));await fill({preferred_name:'Unsaved synthetic preference'});let confirmations=0;dom.window.confirm=()=>{confirmations++;return false};await nav('People');assert.equal(confirmations,1,'In-app navigation must ask before discarding dirty profile values');assert.equal(query('.topbar strong').textContent,'My profile');assert.equal(query('[name="preferred_name"]').value,'Unsaved synthetic preference');
});
test('blocked global search preserves both the unsaved profile and search query',async()=>{
 await mount('employee');await nav('My profile');await click(button('Personal',query('.profile-tabs')));await fill({preferred_name:'Synthetic unsaved name'});dom.window.confirm=()=>false;await change(query('[aria-label="Search employees"]'),'alpha');await submit(query('.global-search'));assert.equal(query('.topbar strong').textContent,'My profile');assert.equal(query('[aria-label="Search employees"]').value,'alpha');assert.equal(query('[name="preferred_name"]').value,'Synthetic unsaved name');
 dom.window.confirm=()=>true;await submit(query('.global-search'));assert.equal(query('.topbar strong').textContent,'People');assert.equal(query('[aria-label="Search directory"]').value,'alpha');assert.equal(all('tbody tr').length,1);
});
test('a profile save in progress blocks in-app navigation until the response returns',async()=>{
 await mount('employee');await nav('My profile');await click(button('Personal',query('.profile-tabs')));await fill({preferred_name:'Synthetic pending save'});let release;state.defer={matches:(url,method)=>String(url).startsWith('/api/profiles/')&&method==='POST',promise:new Promise(resolve=>{release=resolve})};let prompts=0;dom.window.confirm=()=>{prompts++;return true};
 try{await submit(query('[role="tabpanel"] form'));assert.equal(query('.profile-root').dataset.profileBusy,'true');await nav('People');assert.equal(query('.topbar strong').textContent,'My profile');assert.equal(prompts,0)}finally{await act(async()=>release())}
 assert.equal(query('.profile-root').dataset.profileBusy,'false');await nav('People');assert.equal(query('.topbar strong').textContent,'People');
});
for(const role of ['manager','hiring_manager','employee'])test(`${role}: HR-only creation controls stay absent across personnel and operations`,async()=>{
 await mount(role);for(const [page,forbidden]of [['People','Add employee'],['Calendar','Add event'],['Tasks','Create task'],['My checklists','Create template'],['My equipment','Add asset'],['Company news','New announcement']]){await nav(page);assert.ok(!all('button').some(b=>b.textContent.trim()===forbidden),forbidden+' must be absent for '+role)}
});
test('organization modes switch and an organization person opens their profile',async()=>{
 await mount();await nav('Org chart');await click(button('Approval routes',query('main')));assert.match(textOf(query('.org-root')),/Assigned time-off approval routes/);await click(button('Source reporting',query('main')));assert.match(textOf(query('.org-root')),/Imported source reporting lines/);await click(button('Departments',query('main')));const alpha=all('.org-person').find(b=>b.textContent.includes('Synthetic Alpha'));await click(alpha);assert.equal(query('[role="dialog"] .profile-identity h2').textContent,'Synthetic Alpha');
});
test('mobile menu toggles through controls and closes after selecting a page',async()=>{
 await mount('employee');await click(button('Open menu'));assert.equal(button('Open menu').getAttribute('aria-expanded'),'true');assert.ok(query('.sidebar.show'));assert.equal(document.body.style.overflow,'hidden');await nav('People');assert.equal(button('Open menu').getAttribute('aria-expanded'),'false');assert.equal(all('.sidebar.show').length,0);assert.notEqual(document.body.style.overflow,'hidden');
});
test('operations validation error retains the draft, and successful retry saves it',async()=>{
 await mount();await nav('Assets');await click(button('Add asset'));await fill({name:'Synthetic retry laptop',tag:'QA-RETRY'});state.fail=(url,method)=>url==='/api/operations'&&method==='POST';await submit(query('.ops-form'));assert.match(textOf(query('[role="alert"]')),/Synthetic save failed/);assert.equal(query('[name="name"]').value,'Synthetic retry laptop');assert.equal(query('.ops-actions .primary').disabled,false);state.fail=null;await submit(query('.ops-form'));assert.match(textOf(query('tbody')),/Synthetic retry laptop/);assert.equal(all('.ops-form').length,0);
});
for(const [page,prepare,rowSelector,field,firstName,secondName]of [
 ['Assets',s=>s.ops.assets.push({id:'asset-two',name:'Synthetic second laptop',tag:'QA-002',category:'Laptop',status:'available'}),'tbody tr','name','Synthetic laptop','Synthetic second laptop'],
 ['Company news',s=>s.ops.announcements.push({id:'news-two',title:'Synthetic second news',body:'Second body',category:'Company news',status:'draft',created_at:today+'T12:00:00Z',author:'Synthetic HR',read_count:0}),'.ops-announcement','title','Synthetic welcome','Synthetic second news'],
 ['Workflows',()=>{},'.ops-template-list > div','name','Synthetic onboarding','Synthetic offboarding'],
 ['Time tracking',s=>{s.ops.timeEntries=[{id:'time-one',employee_id:'self',employee_name:'Synthetic Self',date:today,minutes:60,project:'Synthetic first project',notes:'',status:'draft'},{id:'time-two',employee_id:'self',employee_name:'Synthetic Self',date:today,minutes:120,project:'Synthetic second project',notes:'',status:'draft'}]},'tbody tr','project','Synthetic first project','Synthetic second project'],
])test(`${page}: switching edit targets never carries typed values into another record`,async()=>{
 await mount('admin',prepare);await nav(page);await click(button('Edit',all(rowSelector).find(row=>row.textContent.includes(firstName))));await fill({[field]:'Synthetic modified first record'},query('.ops-form'));await click(button('Edit',all(rowSelector).find(row=>row.textContent.includes(secondName))));assert.equal(query(`[name="${field}"]`,query('.ops-form')).value,secondName,'The second record must load its own values, never unsaved values from the first record');
});
test('a committed task with failed refresh closes its editor and warns against duplicate retries',async()=>{
 await mount();await nav('Tasks');await click(button('Create task',query('.page-heading')));await fill({title:'Synthetic committed task'});state.fail=(url,method)=>String(url).startsWith('/api/state')&&method==='GET';await submit(query('[role="dialog"] form'));assert.equal(state.data.tasks.filter(t=>t.title==='Synthetic committed task').length,1,'Synthetic backend committed the task');assert.equal(all('[role="dialog"]').length,0,'A successful POST must close the creation editor even when refreshing fails');assert.match(textOf(query('[role="status"]')),/created|saved/i);assert.match(textOf(query('[role="status"]')),/refresh|reload/i);
});
test('a committed workflow template with failed refresh closes its editor and reports saved state',async()=>{
 await mount();await nav('Workflows');await click(button('Create template'));await fill({name:'Synthetic committed template'});state.fail=(url,method)=>String(url).startsWith('/api/operations')&&method==='GET';await submit(query('.ops-form'));assert.equal(state.ops.templates.filter(t=>t.name==='Synthetic committed template').length,1,'Synthetic backend committed the template');assert.equal(all('.ops-form').length,0,'A successful POST must close the creation editor even when refreshing fails');assert.match(textOf(query('[role="status"]')),/saved/i);assert.match(textOf(query('[role="status"]')),/refresh|reload/i);
});
test('a committed document upload with failed refresh cannot be mistaken for a failed upload',async()=>{
 await mount('employee');await nav('Files');await click(button('Upload document',query('.page-heading')));state.fail=(url,method)=>String(url).startsWith('/api/state')&&method==='GET';await submit(query('[role="dialog"] form'),false);assert.equal(state.uploaded.length,1,'Synthetic upload endpoint accepted the multipart envelope');assert.equal(all('[role="dialog"]').length,0,'An accepted upload must close its editor even when refreshing fails');assert.match(textOf(query('[role="status"]')),/uploaded|saved/i);assert.match(textOf(query('[role="status"]')),/refresh|reload/i);
});
test('contact and employment forms submit checkbox and effective-dated field values',async()=>{
 await mount();await nav('My profile');await click(button('Contact',query('.profile-tabs')));await fill({work_phone:'555-0111',work_phone_public:true,city:'Synthetic City'});await submit(query('[role="tabpanel"] form'));assert.equal(lastPost().body.values.work_phone_public,true);assert.equal(lastPost().body.values.city,'Synthetic City');
 await click(button('Job',query('.profile-tabs')));await fill({title:'Synthetic changed title',reason:'Synthetic promotion',effective_date:today});await submit(query('[role="tabpanel"] form'));assert.equal(lastPost().body.action,'update_employment');assert.equal(lastPost().body.values.title,'Synthetic changed title');assert.equal(lastPost().body.effective_date,today);assert.equal(lastPost().body.reason,'Synthetic promotion');
});
test('admin access and HR budget controls open and submit their actual dialogs',async()=>{
 await mount();await nav('People');await click(query('.person-row-button',all('tbody tr').find(row=>row.textContent.includes('Synthetic Alpha'))));await click(button('Manage access'));await fill({role:'manager',active:'1'});await submit(query('[role="dialog"] form'));assert.equal(lastPost('/api/action').body.action,'updateAccess');assert.equal(lastPost('/api/action').body.employeeId,'alpha');assert.equal(lastPost('/api/action').body.role,'manager');
 await click(query('.person-row-button',all('tbody tr').find(row=>row.textContent.includes('Synthetic Alpha'))));await click(button('Time-off budgets'));await fill({vacation:'21.5'});await submit(query('[role="dialog"] form'));assert.equal(lastPost('/api/action').body.action,'updateBudgets');assert.equal(lastPost('/api/action').body.vacation,'21.5');
});

for(const role of roles)test(`${role}: company-owner controls are absent unless HR`,async()=>{
 await mount(role,s=>{s.data.documents[1].owner_id='self'});await nav('Files');const company=all('tbody tr').find(tr=>tr.textContent.includes('Synthetic handbook')),personal=all('tbody tr').find(tr=>tr.textContent.includes('Synthetic notes'));
 assert.equal(all('button',company).some(b=>b.textContent==='Manage'),['admin','hr_manager'].includes(role));assert.ok(button('Manage',personal));assert.ok(company.querySelector('a[aria-label^="Download"]'));assert.equal(all('button',company).some(b=>b.textContent==='Mark read'),!['admin','hr_manager'].includes(role));
});
async function openBudget(){await nav('People');await click(query('.person-row-button',all('tbody tr').find(row=>row.textContent.includes('Synthetic Alpha'))));await click(button('Time-off budgets'));}
for(const role of ['admin','hr_manager'])test(`${role}: switching allowance years loads every saved value and cannot carry old edits`,async()=>{
 await mount(role,s=>{for(const [y,values]of [[year,[18,6,31,4]],[year+1,[24,9,35,8]]])for(const [i,type]of ['Vacation','Sick Leave','WFH','Bereavement'].entries())s.data.employeeBudgets.push({employee_id:'alpha',year:y,type,total:values[i]});});await openBudget();
 assert.equal(query('[name="vacation"]').value,'18');await fill({vacation:'100'});await change(query('[name="year"]'),year+1);assert.deepEqual(['vacation','sick','wfh','bereavement'].map(n=>query(`[name="${n}"]`).value),['24','9','35','8']);assert.match(textOf(query('[role="dialog"]')),new RegExp(`Saved allowances for ${year+1}`));await fill({vacation:'25'});await submit(query('[role="dialog"] form'));assert.deepEqual(lastPost('/api/action').body,{action:'updateBudgets',employeeId:'alpha',year:String(year+1),vacation:'25',sick:'9',wfh:'35',bereavement:'8'});
});
test('new and invalid allowance years cannot reuse a prior year draft',async()=>{
 await mount();await openBudget();await fill({vacation:'101'});await change(query('[name="year"]'),'');assert.equal(button('Save allowances').disabled,true);assert.equal(all('[name="vacation"]').length,0);const count=state.calls.filter(c=>c.method==='POST').length;await submit(query('[role="dialog"] form'),false);assert.equal(state.calls.filter(c=>c.method==='POST').length,count);await change(query('[name="year"]'),year+2);assert.deepEqual(['vacation','sick','wfh','bereavement'].map(n=>query(`[name="${n}"]`).value),['15','5','30','3']);assert.match(textOf(query('[role="dialog"]')),/No saved allowances.*Nothing changes until you save/);await fill({vacation:'33'});await change(query('[name="year"]'),year);assert.equal(query('[name="vacation"]').value,'15');
});
test('failed allowance save keeps the selected-year draft and blocks edits during a pending save',async()=>{
 await mount();await openBudget();await change(query('[name="year"]'),year+1);await fill({vacation:'27'});state.fail=url=>url==='/api/action';await submit(query('[role="dialog"] form'));assert.equal(query('[name="year"]').value,String(year+1));assert.equal(query('[name="vacation"]').value,'27');state.fail=null;let release;state.defer={matches:(url,method)=>url==='/api/action'&&method==='POST',promise:new Promise(resolve=>{release=resolve})};try{await submit(query('[role="dialog"] form'));assert.equal(query('[name="year"]').disabled,true);assert.equal(query('[name="vacation"]').disabled,true);assert.equal(button('Save allowances').disabled,true)}finally{await act(async()=>release())}assert.equal(all('[role="dialog"]').length,0);
});
for(const role of roles)test(`${role}: choosing a balance year labels its totals and refreshes that same year after a mutation`,async()=>{
 await mount(role,s=>{s.balancesByYear={[year+1]:s.data.balances.map(b=>({...b,total:b.type==='Vacation'?42:b.total,used:2,pending:3}))};});await nav('Time off');await change(query('[aria-label="Balance year"]'),year+1);assert.equal(query('[aria-label="Balance year"]').value,String(year+1));assert.match(textOf(query('.leave-balances')),/40 \/ 42 days/);assert.match(textOf(query('.policy-note')),new RegExp(String(year+1)));await click(button('Request time off',query('.page-heading')));await fill({note:'Synthetic next-year view'});await submit(query('[role="dialog"] form'));assert.equal(state.calls.filter(c=>c.url.startsWith('/api/state')).at(-1).url,`/api/state?year=${year+1}`);await nav('Overview');assert.equal(query('[aria-label="My time-off year"]').value,String(year+1));
});
test('balance-year load failure keeps the chosen year and hides unverified totals',async()=>{
 await mount('employee');await nav('Time off');state.fail=url=>String(url).includes('?year=');await change(query('[aria-label="Balance year"]'),year+1);assert.equal(query('[aria-label="Balance year"]').value,String(year+1));assert.equal(all('.leave-balances').length,0);assert.match(textOf(query('[role="alert"]')),/Could not load/);state.fail=null;await click(button('Retry balances'));assert.equal(query('[aria-label="Balance year"]').value,String(year+1));assert.equal(all('.leave-balances').length,1);assert.equal(query('[aria-label="Balance year"]').disabled,false);
});
test('pending balance-year load hides outdated cards and prevents another selection',async()=>{
 await mount('employee');await nav('Time off');let release;state.defer={matches:url=>String(url).includes('?year='),promise:new Promise(resolve=>{release=resolve})};try{await change(query('[aria-label="Balance year"]'),year+1);assert.equal(all('.leave-balances').length,0);assert.equal(query('[aria-label="Balance year"]').disabled,true);assert.match(textOf(),/Loading balances/);}finally{await act(async()=>release())}assert.equal(query('[aria-label="Balance year"]').value,String(year+1));assert.equal(all('.leave-balances').length,1);
});
for(const olderFailure of ['http','network'])test(`stale ${olderFailure} balance-year failure cannot undo a newer successful mutation refresh`,async()=>{
 await mount('employee');await nav('Time off');let release,held=false;const gate=new Promise(resolve=>{release=resolve});
 globalThis.fetch=async(url,init)=>{if(String(url)===`/api/state?year=${year+1}`&&!held){held=true;await gate;if(olderFailure==='network')throw new Error('Delayed network failure');return reply({error:'Delayed first read failure'},500)}return fakeFetch(url,init)};
 try{await change(query('[aria-label="Balance year"]'),year+1);assert.equal(query('[aria-label="Balance year"]').disabled,true);await click(button('Cancel',query('tbody')));assert.equal(query('[aria-label="Balance year"]').value,String(year+1));assert.equal(query('[aria-label="Balance year"]').disabled,false)}finally{await act(async()=>release())}
 assert.equal(query('[aria-label="Balance year"]').value,String(year+1));assert.doesNotMatch(textOf(),/Delayed.*failure/);await nav('Tasks');await click(button('Complete task'));assert.equal(state.calls.filter(c=>c.url.startsWith('/api/state')).at(-1).url,`/api/state?year=${year+1}`);
});
test('newer failed mutation refresh retains the chosen year without displaying the older successful read',async()=>{
 await mount('employee');await nav('Time off');let release,reads=0;const gate=new Promise(resolve=>{release=resolve});
 globalThis.fetch=async(url,init)=>{if(String(url)===`/api/state?year=${year+1}`){reads++;if(reads===1){await gate;return reply({...state.data,year:year+1})}return reply({error:'Newer state read failed'},500)}return fakeFetch(url,init)};
 try{await change(query('[aria-label="Balance year"]'),year+1);await click(button('Cancel',query('tbody')));assert.equal(query('[aria-label="Balance year"]').value,String(year+1));assert.equal(query('[aria-label="Balance year"]').disabled,false)}finally{await act(async()=>release())}
 assert.equal(query('[aria-label="Balance year"]').value,String(year+1));await nav('Tasks');await click(button('Complete task'));assert.equal(reads,3);assert.equal(all('.leave-balances').length,0);
});

for(const role of roles)test(`${role}: home company files card opens only company resources and reports the same count`,async()=>{
 await mount(role);assert.match(textOf(query('.td-files-link')),/1 accessible file$/);await click(query('.td-files-link'));assert.equal(query('.topbar strong').textContent,'Files');assert.equal(all('tbody tr').length,1);assert.match(textOf(query('tbody')),/Synthetic handbook/);assert.doesNotMatch(textOf(query('tbody')),/Synthetic notes/);await nav('Overview');await click(query('.td-files-link'));assert.equal(all('tbody tr').length,1);
});
for(const role of ['admin','hr_manager'])test(`${role}: file read acknowledgement counts replace personal mark-read controls`,async()=>{
 await mount(role,s=>{s.data.documents[1].read_count=3});await nav('Files');const company=all('tbody tr').find(tr=>tr.textContent.includes('Synthetic handbook'));assert.match(textOf(company),/3 read acknowledgements/);assert.equal(all('button',company).some(b=>b.textContent==='Mark read'),false);assert.ok(button('Manage',company));assert.doesNotMatch(textOf(all('tbody tr')[0]),/read acknowledgement/);
});
for(const role of ['manager','hiring_manager','employee'])test(`${role}: file count is not rendered even if supplied to the component`,async()=>{
 await mount(role,s=>{s.data.documents[1].read_count=999});await nav('Files');const company=all('tbody tr').find(tr=>tr.textContent.includes('Synthetic handbook'));assert.doesNotMatch(textOf(company),/999|read acknowledgements/);await click(button('Mark read',company));assert.match(textOf(query('tbody')),/Read acknowledged/);
});
for(const label of ['Time off','My time off'])test(`home ${label} opens the working time-off screen`,async()=>{
 await mount('employee');const scope=label==='Time off'?query('.td-time-off'):query('.td-my-time');await click(button(label,scope));assert.equal(query('.topbar strong').textContent,'Time off');assert.ok(query('[aria-label="Balance year"]'));await nav('Overview');await click(button('Open time-off calendar'));assert.equal(query('.topbar strong').textContent,'Calendar');
});
for(const dimension of ['Locations','Divisions','Departments'])test(`current ${dimension} chart opens the exact filtered People list`,async()=>{
 await mount();await click(button(dimension,query('.td-reports')));const name={Locations:'Asia',Divisions:'Field',Departments:'Engineering'}[dimension];await click(query(`.td-chart-bar[aria-label="${name}: 1 profiles"]`));assert.equal(query('.topbar strong').textContent,'People');assert.equal(all('tbody tr').length,1);assert.match(textOf(query('tbody')),/Synthetic Alpha/);assert.match(textOf(),new RegExp('Report filter: '+dimension+': '+name));assert.equal(query('[aria-label="Filter '+({Locations:'location',Divisions:'division',Departments:'department'}[dimension])+'"]').value,name);await click(button('Clear report filter'));assert.ok(all('tbody tr').length>1);
});
test('manager current headcount drilldown preserves assigned-team reporting scope',async()=>{
 await mount('manager');await click(query('.td-chart-bar[aria-label="Non-demo profiles: 2 profiles"]'));assert.equal(query('.topbar strong').textContent,'People');assert.equal(all('tbody tr').length,2);assert.match(textOf(query('tbody')),/Synthetic Self/);assert.match(textOf(query('tbody')),/Synthetic Alpha/);assert.doesNotMatch(textOf(query('tbody')),/Synthetic Beta/);
});
test('demo headcount drilldown includes demo rows without substituting real employees',async()=>{
 await mount();await change(query('[aria-label="Report source"]'),'review');await click(query('.td-chart-bar[aria-label="Demo profiles: 1 profiles"]'));assert.equal(all('tbody tr').length,1);assert.match(textOf(query('tbody')),/Synthetic Demo/);
});
for(const status of [401,403])test(`HTTP ${status} clears protected workspace data and preserves only the selected year for sign-in`,async()=>{
 await mount('hr_manager');await nav('Time off');let refreshes=0;
 globalThis.fetch=async(url,init)=>{if(url==='/api/auth/refresh'){refreshes++;return reply({authenticated:false},401)}if(String(url).startsWith('/api/state?year='))return reply({error:'Provider details must not be rendered'},status);return fakeFetch(url,init)};
 await change(query('[aria-label="Balance year"]'),year+1);assert.equal(all('main').length,0);assert.equal(all('[role="dialog"]').length,0);assert.doesNotMatch(textOf(),/Synthetic|Provider details|HR VIEW/);assert.match(textOf(),status===401?/session has ended/:/access changed/);assert.equal(dom.window.sessionStorage.getItem('ufs-resume-balance-year'),String(year+1));assert.equal(refreshes,status===401?1:0);assert.ok(query('a[href^="/signin-with-chatgpt"]'));
});
test('a resumed sign-in loads the requested year with the new account permissions',async()=>{
 dom.window.sessionStorage.setItem('ufs-resume-balance-year',String(year+1));await mount('employee');assert.equal(query('.topbar strong').textContent,'Time off');assert.equal(query('[aria-label="Balance year"]').value,String(year+1));assert.doesNotMatch(textOf(),/HR VIEW|MANAGER VIEW/);assert.equal(dom.window.sessionStorage.getItem('ufs-resume-balance-year'),null);assert.equal(state.calls[0].url,`/api/state?year=${year+1}`);
});
test('an expired access token that refreshes successfully retains the year without showing a sign-in error',async()=>{
 await mount('employee');await nav('Time off');let reads=0,refreshes=0;globalThis.fetch=async(url,init)=>{if(url==='/api/auth/refresh'){refreshes++;return reply({authenticated:true})}if(url===`/api/state?year=${year+1}`&&reads++===0)return reply({error:'Sign in again'},401);return fakeFetch(url,init)};await change(query('[aria-label="Balance year"]'),year+1);assert.equal(query('[aria-label="Balance year"]').value,String(year+1));assert.equal(refreshes,1);assert.equal(reads,2);assert.equal(all('.leave-balances').length,1);assert.doesNotMatch(textOf(),/Could not load|session has ended/);
});
test('a stale forbidden response cannot clear a newer authorized state',async()=>{
 await mount('employee');await nav('Time off');let release,held=false;const gate=new Promise(resolve=>{release=resolve});globalThis.fetch=async(url,init)=>{if(url===`/api/state?year=${year+1}`&&!held){held=true;await gate;return reply({error:'Access changed'},403)}return fakeFetch(url,init)};
 try{await change(query('[aria-label="Balance year"]'),year+1);await click(button('Cancel',query('tbody')))}finally{await act(async()=>release())}assert.equal(query('[aria-label="Balance year"]').value,String(year+1));assert.ok(query('main'));assert.doesNotMatch(textOf(),/access changed/);
});

function addHistoricalFixture(s){
 s.data.headcountSnapshot={sourceLabel:'TalentHR',sourceUrl:'https://unitedffs.talenthr.io/reports/headcount',verifiedAt:'2026-10-11',rows:[{month:'2026-03',label:'Mar 26',value:21},{month:'2026-04',label:'Apr 26',value:25}]};
 s.roster={month:'2026-03',label:'Mar 26',asOf:'2026-03-31',reportedCount:21,supportedCount:1,reconciliation:'partial',sourceLabel:'TalentHR',verifiedAt:'2026-10-11',semantics:'imported_source_history',note:'Only dated source evidence is listed. This is not a verified exact source roster.',rows:[{id:'former',name:'Synthetic Former',title:'Historical analyst',department:'Prior department',location:'Prior location',jobEvidence:'historical',jobAsOf:'2025-03-01'}]};
}
test('historical bar opens partial period evidence, searches it, opens former profile, and returns to the same period',async()=>{
 await mount('admin',addHistoricalFixture);await click(query('.td-chart-bar[aria-label="Mar 26: 21 employees"]'));
 assert.equal(query('.topbar strong').textContent,'Overview');assert.match(textOf(query('[role="dialog"]')),/Mar 26 employees.*21.*source bar.*1.*supported employee records.*Partial employee list/);assert.match(textOf(query('.td-roster-source')),/Mar 31, 2026/);assert.doesNotMatch(textOf(query('.td-roster-list')),/Synthetic Alpha|Synthetic Self/);assert.match(textOf(query('.td-roster-list')),/Historical analyst/);
 await change(query('[aria-label="Search employees in selected period"]'),'missing');assert.equal(all('.td-roster-list .td-person-row').length,0);assert.match(textOf(query('[role="dialog"]')),/No employee matches/);await change(query('[aria-label="Search employees in selected period"]'),'former');await click(button('Open Synthetic Former profile'));assert.ok(state.calls.some(c=>c.url==='/api/profiles/former'));await click(button('Back to employee list'));assert.equal(query('#modal-title').textContent,'Mar 26 employees');assert.equal(all('.td-roster-list .td-person-row').length,1);assert.equal(state.calls.filter(c=>c.method!=='GET').length,0);
});
test('period roster errors expose retry without substituting current employees',async()=>{
 await mount('hr_manager',addHistoricalFixture);state.fail=url=>String(url).startsWith('/api/headcount-roster');await click(query('.td-chart-bar[aria-label="Mar 26: 21 employees"]'));assert.match(textOf(query('[role="alert"]')),/Synthetic save failed/);assert.equal(all('.td-roster-list .td-person-row').length,0);state.fail=null;await click(button('Retry employee list'));assert.equal(all('.td-roster-list .td-person-row').length,1);
});
for(const status of [401,403])test(`roster HTTP ${status} removes all protected workspace and modal records`,async()=>{
 await mount('admin',addHistoricalFixture);globalThis.fetch=(url,init)=>String(url).startsWith('/api/headcount-roster')?reply({error:'Access changed'},status):url==='/api/auth/refresh'?reply({error:'Sign in'},401):fakeFetch(url,init);await click(query('.td-chart-bar[aria-label="Mar 26: 21 employees"]'));assert.equal(all('main,[role="dialog"]').length,0);assert.doesNotMatch(textOf(),/Synthetic Former|Synthetic Self/);assert.match(textOf(),/access changed/);
});
test('closing a loading historical panel discards its late response',async()=>{
 await mount('admin',addHistoricalFixture);let release;state.defer={matches:url=>String(url).startsWith('/api/headcount-roster'),promise:new Promise(resolve=>{release=resolve})};await click(query('.td-chart-bar[aria-label="Mar 26: 21 employees"]'));assert.match(textOf(query('[role="dialog"]')),/Loading the period/);await click(button('Close'));await act(async()=>release());assert.equal(all('[role="dialog"]').length,0);assert.equal(query('.topbar strong').textContent,'Overview');
});
for(const role of roles)test(`${role}: dashboard leave type expands own year history and preselects a safe unsent request`,async()=>{
 await mount(role,s=>{s.data.requests.push({id:'own-sick',employee_id:'self',type:'Sick Leave',start_date:today,end_date:today,year,days:1,status:'approved'},{id:'peer-sick',employee_id:'alpha',type:'Sick Leave',start_date:today,end_date:today,year,days:333,status:'approved'},{id:'old-sick',employee_id:'self',type:'Sick Leave',start_date:`${year-1}-01-01`,end_date:`${year-1}-01-01`,year:year-1,days:444,status:'approved'})});
 await click(button('View Sick Leave balances and requests'));assert.equal(query('.topbar strong').textContent,'Overview');assert.equal(button('View Sick Leave balances and requests').getAttribute('aria-pressed'),'true');assert.match(textOf(query('.td-my-detail')),/Sick Leave.*annual allowance.*My requests/);assert.equal(all('.td-my-requests>button').length,1);assert.doesNotMatch(textOf(query('.td-my-detail')),/333|444/);await change(query('[aria-label="My request status"]'),'pending');assert.match(textOf(query('.td-my-detail')),/No pending sick leave requests/);await click(button('Request sick leave'));assert.equal(query('[name="type"]').value,'Sick Leave');assert.equal(query('[name="startDate"]').value,today);assert.equal(state.calls.filter(c=>c.method!=='GET').length,0);
});
test('dashboard year controls load the requested year, hide stale balances, and retain selection after retry',async()=>{
 await mount('employee',s=>{s.balancesByYear={[year+1]:[{type:'Vacation',total:24,used:2,pending:3}]}});let release;state.defer={matches:url=>String(url).includes('?year='),promise:new Promise(resolve=>{release=resolve})};await click(button('Next time-off year'));assert.equal(query('[aria-label="My time-off year"]').value,String(year+1));assert.equal(all('.td-my-time .td-balance-link').length,0);assert.match(textOf(query('.td-my-time')),/Loading/);assert.equal(button('Previous time-off year').disabled,true);await act(async()=>release());assert.match(textOf(query('.td-my-time')),/19 days available/);assert.equal(query('[aria-label="My time-off year"]').value,String(year+1));state.defer=null;state.fail=url=>String(url).includes('?year=');await click(button('Next time-off year'));assert.equal(all('.td-my-time .td-balance-link').length,0);assert.match(textOf(query('.td-my-time')),/Could not load/);state.fail=null;await click(button('Retry balances'));assert.equal(query('[aria-label="My time-off year"]').value,String(year+2));assert.equal(all('.td-my-time .td-balance-link').length,4);
});

test('historical profile administration uses current authorized fields rather than slim historical fields',async()=>{
 await mount('admin',s=>{addHistoricalFixture(s);s.data.people.find(p=>p.id==='beta').role='manager';const former=s.data.people.find(p=>p.id==='former');Object.assign(former,{role:'manager',active:0,manager_id:'beta',annual_allowance:19});s.roster.rows[0].employment='Historical contractor';});await click(query('.td-chart-bar[aria-label="Mar 26: 21 employees"]'));await click(button('Open Synthetic Former profile'));await click(button('Manage access'));assert.equal(query('[name="role"]').value,'manager');assert.equal(query('[name="active"]').value,'0');assert.equal(query('[name="managerId"]').value,'beta');assert.equal(state.calls.filter(c=>c.method!=='GET').length,0);
});
test('roster access denial invalidates an older in-flight successful state response',async()=>{
 await mount('admin',addHistoricalFixture);let release;const pending=new Promise(resolve=>{release=resolve});globalThis.fetch=async(url,init)=>{if(String(url).startsWith('/api/state?')){await pending;return reply({...state.data,year:year+1})}if(String(url).startsWith('/api/headcount-roster'))return reply({error:'Revoked'},403);return fakeFetch(url,init)};await click(button('Next time-off year'));await click(query('.td-chart-bar[aria-label="Mar 26: 21 employees"]'));assert.equal(all('main,[role="dialog"]').length,0);await act(async()=>release());assert.equal(all('main,[role="dialog"]').length,0);assert.match(textOf(),/access changed/);
});
test('closing an employee profile opened from a bar restores focus to the original chart control',async()=>{
 await mount('admin',addHistoricalFixture);const bar=query('.td-chart-bar[aria-label="Mar 26: 21 employees"]');await act(async()=>bar.focus());await click(bar);await click(button('Open Synthetic Former profile'));await click(button('Close'));assert.equal(document.activeElement,bar);
});
for(const changeKind of ['role','identity','scope'])test(`successful state refresh with changed ${changeKind} clears a loaded historical report`,async()=>{
 await mount('admin',addHistoricalFixture);let release;const pending=new Promise(resolve=>{release=resolve});globalThis.fetch=async(url,init)=>{if(String(url).startsWith('/api/state?')){await pending;return reply({...state.data,year:year+1,...(changeKind==='scope'?{testMode:true}:{}),me:{...state.data.me,...(changeKind==='role'?{role:'employee'}:changeKind==='identity'?{id:'other-user'}:{data_scope:'qa-bots-v1'})}})}return fakeFetch(url,init)};await click(button('Next time-off year'));await click(query('.td-chart-bar[aria-label="Mar 26: 21 employees"]'));assert.match(textOf(query('[role="dialog"]')),/Historical analyst/);await act(async()=>release());assert.equal(all('[role="dialog"]').length,0);assert.doesNotMatch(textOf(),/Historical analyst|Prior department/);
});

for(const role of roles)test(`${role}: time-off page tiles select only own leave type and balance year without mutations`,async()=>{
 await mount(role,s=>{s.data.requests.push({id:'own-sick',employee_id:'self',name:s.data.me.name,type:'Sick Leave',start_date:today,end_date:today,year,days:1,status:'approved'},{id:'peer-sick',employee_id:'alpha',name:'Synthetic Alpha',type:'Sick Leave',start_date:today,end_date:today,year,days:3,status:'approved'},{id:'old-sick',employee_id:'self',name:s.data.me.name,type:'Sick Leave',start_date:`${year-1}-02-02`,end_date:`${year-1}-02-02`,year:year-1,days:4,status:'approved'})});await nav('Time off');await click(button(`View my Sick Leave requests for ${year}`));assert.equal(all('.leave-balances [aria-pressed="true"]').length,1);assert.match(textOf(query('.time-off-selection')),new RegExp(`Your Sick Leave requests · ${year}`));assert.equal(all('tbody tr').length,1);assert.match(textOf(query('tbody')),/1 day/);assert.doesNotMatch(textOf(query('tbody')),/Synthetic Alpha|4 days/);await click(button('Show all requests'));assert.equal(all('tbody tr').length,4);assert.equal(state.calls.filter(c=>c.method!=='GET').length,0);
});
test('selected personal leave type follows a reloaded year and new form keeps the selected type',async()=>{
 await mount('employee',s=>{s.data.requests.push({id:'next-wfh',employee_id:'self',name:s.data.me.name,type:'WFH',start_date:`${year+1}-04-04`,end_date:`${year+1}-04-04`,year:year+1,days:1,status:'pending'})});await nav('Time off');await click(button(`View my WFH requests for ${year}`));assert.equal(all('tbody tr').length,0);await change(query('[aria-label="Balance year"]'),year+1);assert.equal(all('tbody tr').length,1);assert.match(textOf(query('.time-off-selection')),new RegExp(String(year+1)));await click(button('Request time off',query('.page-heading')));assert.equal(query('[name="type"]').value,'WFH');assert.equal(state.calls.filter(c=>c.method!=='GET').length,0);
});
test('My profile to Workflows leaves one current sidebar item and does not prompt without edits',async()=>{
 let prompts=0;dom.window.confirm=()=>{prompts++;return false};await mount();await nav('My profile');await nav('Workflows');assert.equal(query('.topbar strong').textContent,'Workflows');assert.equal(all('aside.sidebar nav button.active').length,1);assert.equal(all('aside.sidebar nav button[aria-current="page"]').length,1);assert.match(textOf(query('aside.sidebar nav button.active')),/Workflows/);assert.equal(prompts,0);
});

const departmentSelect = () => all('[role="dialog"] select').find(select => [...select.options].some(option => option.value === '__new__'));

test('People page has one search box; the header search returns on other pages', async () => {
  await mount(); await nav('People');
  assert.equal(all('.global-search').length, 0); assert.ok(query('[aria-label="Search directory"]'));
  await nav('Overview'); assert.equal(all('.global-search').length, 1);
});

test('new employee department is picked from existing departments, with an explicit way to add one', async () => {
  await mount(); await nav('People'); await click(button('Add employee'));
  const select = departmentSelect(), existing = [...select.options].map(option => option.value).filter(value => value !== '__new__' && value !== '');
  assert.ok(existing.length > 0); assert.equal(all('[aria-label="New department name"]').length, 0);
  assert.equal(select.value, ''); assert.equal(select.required, true); assert.equal(query('[role="dialog"] input[name="department"]').value, '');
  await change(select, existing.at(-1)); assert.equal(query('[role="dialog"] input[name="department"]').value, existing.at(-1));
  await fill({ name: 'Picked Department', email: 'picked@example.invalid', title: 'Analyst' });
  await submit(query('[role="dialog"] form'));
  assert.equal(lastPost('/api/action').body.department, existing.at(-1));
});

test('new department name is required once "New department" is chosen', async () => {
  await mount(); await nav('People'); await click(button('Add employee'));
  await change(departmentSelect(), '__new__');
  assert.equal(query('[aria-label="New department name"]').required, true);
  assert.equal(query('[role="dialog"] input[name="department"]').value, '');
});

test('only a super admin sees the approver choice, defaulting to themselves', async () => {
  await mount('admin'); await nav('People'); await click(button('Add employee'));
  const approver = query('[role="dialog"] select[name="managerId"]');
  assert.ok(approver); assert.equal(approver.value, 'self');
  assert.equal([...approver.options].some(option => option.value === ''), false); assert.ok([...approver.options].some(option => option.value === 'self'));
});

test('HR sees who the approver will be instead of a choice', async () => {
  await mount('hr_manager'); await nav('People'); await click(button('Add employee'));
  assert.equal(all('[role="dialog"] select[name="managerId"]').length, 0); assert.match(textOf(query('[role="dialog"]')), /You will be this employee's time-off approver/);
});

test('balance year offers a window around the current year, never 81 years', async () => {
  await mount('employee'); await nav('Time off');
  const years = [...query('[aria-label="Balance year"]').options].map(option => Number(option.value)), current = state.data.currentYear ?? state.data.year;
  assert.equal(years.length, 11); assert.deepEqual(years, Array.from({ length: 11 }, (_, i) => current - 5 + i));
  assert.equal(query('[aria-label="Balance year"]').value, String(state.data.year));
});

test('empty workflows offer one-click onboarding and offboarding checklists that open prefilled', async () => {
  for (const kind of ['Onboarding', 'Offboarding']) {
    await mount('admin', s => { s.ops.templates = []; });
    await nav('Workflows');
    assert.match(textOf(), /No active templates/);
    await click(button(`Start from the ${kind.toLowerCase()} checklist`));
    assert.match(textOf(query('.ops-form')), /Create checklist template/);
    assert.equal(query('.ops-form select').value, kind);
  }
});


const failState = (respond) => { globalThis.fetch = async (url, init) => String(url).startsWith('/api/state') ? respond() : fakeFetch(url, init); };

test('a network failure on first load says so plainly and offers Try again instead of sign-in', async () => {
  failState(() => { throw new TypeError('Failed to fetch'); });
  await mount();
  assert.match(textOf(), /couldn’t reach UFS People/);
  assert.doesNotMatch(textOf(), /Failed to fetch|Sign in with ChatGPT/);
  assert.equal(all('a.button').length, 0);
  globalThis.fetch = fakeFetch;
  await click(button('Try again'));
  assert.ok(query('aside.sidebar'));
  assert.doesNotMatch(textOf(), /couldn’t reach UFS People/);
});

test('a server error on first load shows its message with Try again and can recover', async () => {
  failState(() => reply({ error: 'The database is not configured.' }, 503));
  await mount();
  assert.match(textOf(), /The database is not configured\./);
  assert.ok(button('Try again')); assert.equal(all('a.button').length, 0);
  failState(() => reply({ error: 'Something went wrong. Please try again.' }, 500));
  await click(button('Try again'));
  assert.match(textOf(), /Something went wrong\. Please try again\./);
  globalThis.fetch = fakeFetch;
  await click(button('Try again'));
  assert.ok(query('aside.sidebar'));
});

test('an ended session still shows the sign-in prompt, not Try again', async () => {
  failState(() => reply({ error: 'Sign in again.' }, 401));
  await mount();
  assert.match(textOf(), /Your session has ended/);
  assert.equal(all('a.button').length, 1); assert.equal(all('button').filter(b => b.textContent.trim() === 'Try again').length, 0);
});
