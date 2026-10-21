// Synthetic React DOM interactions only; no live accounts, network or writes.
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
const {EmployeeProfile}=await import('../app/employee-profile.tsx');
const {AllowanceEditor}=await import('../app/allowance-editor.tsx');
const realFetch=globalThis.fetch;
let container,root,data,calls,saves;
const person={id:'synthetic-employee',name:'Synthetic Employee',role:'employee',active:1,directory_active:1,title:'Synthetic role',department:'Synthetic team',location:'Synthetic office',employment:'Full-Time',hire_date:'2026-01-01',annual_allowance:15,sick_allowance:5,wfh_allowance:30,bereavement_allowance:3};
beforeEach(()=>{
 container=document.createElement('div');document.body.append(container);root=createRoot(container);calls=[];saves=[];
 data={profile:{...person,preferred_name:'Original',bio:'Original notes',work_phone_public:true,gender:'Non-binary',hours_per_day:8,employment_status:'Active'},access:{private:true,employment:true,compensation:true,hr:true,editable:true},emergencyContacts:[],identifiers:[],education:[],benefits:[],compensation:[],history:[]};
 globalThis.fetch=async(url,init={})=>{calls.push({url:String(url),method:init.method||'GET',body:init.body&&JSON.parse(init.body)});return {ok:true,json:async()=>structuredClone(data)}};
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();globalThis.fetch=realFetch});
after(()=>{hook.deregister();dom.window.close();for(const [name,descriptor]of restored){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}delete globalThis.IS_REACT_ACT_ENVIRONMENT});
const query=(selector)=>{const element=container.querySelector(selector);assert.ok(element,'Missing '+selector);return element};
const button=(label)=>{const element=[...container.querySelectorAll('button')].find(element=>(element.getAttribute('aria-label')||element.textContent.trim())===label);assert.ok(element,'Missing button '+label);return element};
const click=async(element)=>{await act(async()=>element.click())};
async function change(element,value){await act(async()=>{if(element.type==='checkbox'){element.click();return}const proto=element.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:element.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,String(value));element.dispatchEvent(new dom.window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));if(element.tagName!=='SELECT')element.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})}
const field=(name)=>query(`[name="${name}"]`);
const dirty=()=>query('.profile-root').getAttribute('data-profile-dirty');
const submit=async()=>{await act(async()=>query('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))};
async function mountProfile(){await act(async()=>root.render(createElement(EmployeeProfile,{employeeId:person.id,me:{id:'synthetic-admin',role:'admin'},people:[person],onSaved:async()=>{},onManageAccess:()=>{},onManageBudget:()=>{}})))}
async function mountAllowance(budgets=[],busy=false){await act(async()=>root.render(createElement(AllowanceEditor,{person,budgets,year:2026,busy,onSave:values=>saves.push(values),onCancel:()=>{}})))}
const records=[
 ['Emergency','Add contact','emergencyContacts',{id:'contact-one',name:'Synthetic contact',relationship:'Sibling',phone:'+15555550100',priority:1,is_primary:true},'name','Synthetic contact'],
 ['Education','Add education','education',{id:'education-one',institution:'Synthetic school',status:'Completed'},'institution','Synthetic school'],
 ['Benefits','Add benefit record','benefits',{id:'benefit-one',plan:'Synthetic plan',type:'Wellness',status:'Eligible',effective_date:'2026-01-01'},'plan','Synthetic plan'],
 ['Identifiers','Add metadata','identifiers',{id:'identifier-one',type:'Passport',country:'Synthetic country',status:'Pending',last4:'A123'},'country','Passport'],
];
for(const [tab,add,list,record,name,title]of records){
 test(`${tab}: opening a new record without editing navigates without a discard prompt`,async()=>{await mountProfile();await click(button(tab));await click(button(add));assert.equal(dirty(),'false');await click(button('Overview'));assert.ok(container.querySelector('#profile-panel-Overview'));assert.doesNotMatch(container.textContent,/Keep your changes\?/)});
 test(`${tab}: opening an existing record without editing navigates without a discard prompt`,async()=>{data[list]=[record];await mountProfile();await click(button(tab));await click(button('Edit '+title));assert.equal(dirty(),'false');await click(button('Overview'));assert.ok(container.querySelector('#profile-panel-Overview'));assert.doesNotMatch(container.textContent,/Keep your changes\?/)});
 test(`${tab}: existing record opens clean and becomes clean after reverting an edit`,async()=>{data[list]=[record];await mountProfile();await click(button(tab));await click(button('Edit '+title));assert.equal(dirty(),'false');const initial=field(name).value;await change(field(name),'Changed synthetic value');assert.equal(dirty(),'true');await change(field(name),initial);assert.equal(dirty(),'false');await click(button('Overview'));assert.ok(container.querySelector('#profile-panel-Overview'));assert.doesNotMatch(container.textContent,/Keep your changes\?/)});
}
for(const [tab,name,value]of [['Personal','preferred_name','Changed'],['Personal','bio','Changed notes'],['Personal','gender','Female'],['Contact','work_phone_public',false],['Job','hours_per_day','7.5'],['Job','hire_date','2026-02-01']])test(`${name}: reverting the actual form value clears dirty navigation state`,async()=>{
 await mountProfile();await click(button(tab));const input=field(name),original=input.type==='checkbox'?input.checked:input.value;await change(input,value);assert.equal(dirty(),'true');await change(input,original);assert.equal(dirty(),'false');await click(button('Overview'));assert.ok(container.querySelector('#profile-panel-Overview'));
});
for(const kind of ['Pay change','Bonus'])test(`${kind}: opening and cancelling an untouched form is clean`,async()=>{await mountProfile();await click(button('Compensation'));await click(button(kind));assert.equal(dirty(),'false');await click(button('Cancel compensation change'));assert.equal(container.querySelector('form'),null);assert.doesNotMatch(container.textContent,/Discard this unsaved/);});
test('reverting while a tab discard warning is open clears the obsolete warning',async()=>{await mountProfile();await click(button('Personal'));await change(field('preferred_name'),'Changed');await click(button('Overview'));assert.match(container.textContent,/Keep your changes\?/);await change(field('preferred_name'),'Original');assert.equal(dirty(),'false');assert.doesNotMatch(container.textContent,/Keep your changes\?/);await click(button('Overview'));assert.ok(container.querySelector('#profile-panel-Overview'))});
test('reverting while a record cancel warning is open clears the obsolete warning',async()=>{await mountProfile();await click(button('Education'));await click(button('Add education'));await change(field('institution'),'Changed');await click(button('Cancel editing'));assert.match(container.textContent,/Discard this record/);await change(field('institution'),'');assert.equal(dirty(),'false');assert.doesNotMatch(container.textContent,/Discard this record/);await click(button('Cancel editing'));assert.equal(container.querySelector('form'),null)});
test('reverting a compensation change clears cancel warnings, including on reopen',async()=>{await mountProfile();await click(button('Compensation'));await click(button('Pay change'));await change(field('amount'),'123');await click(button('Cancel compensation change'));assert.match(container.textContent,/Discard this unsaved/);await change(field('amount'),'');assert.equal(dirty(),'false');assert.doesNotMatch(container.textContent,/Discard this unsaved/);await click(button('Cancel compensation change'));await click(button('Bonus'));assert.equal(dirty(),'false');assert.doesNotMatch(container.textContent,/Discard this unsaved/)});
test('real edits still block tabs and register an unload warning until reset',async()=>{await mountProfile();await click(button('Personal'));await change(field('preferred_name'),'Changed');await click(button('Overview'));assert.match(container.textContent,/Keep your changes\?/);assert.ok(container.querySelector('#profile-panel-Personal'));const event=new dom.window.Event('beforeunload',{cancelable:true});dom.window.dispatchEvent(event);assert.equal(event.defaultPrevented,true);await click(button('Keep editing'));await click(button('Reset'));assert.equal(dirty(),'false');const clean=new dom.window.Event('beforeunload',{cancelable:true});dom.window.dispatchEvent(clean);assert.equal(clean.defaultPrevented,false)});
for(const invalid of ['ABCDE','SYNTHETICFULL12345','12-34'])test(`identifier rejects an entire invalid insertion (${invalid.length} characters) with explicit error and no transmission`,async()=>{
 await mountProfile();await click(button('Identifiers'));await click(button('Add metadata'));await change(field('type'),'Passport');await change(field('country'),'Synthetic country');await change(field('last4'),invalid);
 assert.equal(field('last4').value,'');assert.equal(field('last4').hasAttribute('maxlength'),false);assert.equal(field('last4').getAttribute('aria-invalid'),'true');assert.match(query('.profile-field-error').textContent,/rejected.*never shortened or saved/);assert.ok(!container.innerHTML.includes(invalid));assert.equal(new FormData(query('form')).get('last4'),'');await submit();assert.equal(calls.filter(call=>call.method==='POST').length,0);
 await change(field('last4'),'A123');assert.equal(field('last4').getAttribute('aria-invalid'),'false');await submit();assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(calls.at(-1).body.identifier.last4,'A123');
});
test('identifier fifth character is rejected visibly and cannot silently submit the prior suffix',async()=>{await mountProfile();await click(button('Identifiers'));await click(button('Add metadata'));await change(field('type'),'Passport');await change(field('country'),'Synthetic country');await change(field('last4'),'A123');await change(field('last4'),'A1234');assert.equal(field('last4').value,'A123');await submit();assert.equal(calls.filter(call=>call.method==='POST').length,0);assert.match(container.textContent,/That input was rejected/)});
test('identifier correction to the same accepted suffix clears a rejected insertion',async()=>{await mountProfile();await click(button('Identifiers'));await click(button('Add metadata'));await change(field('type'),'Passport');await change(field('country'),'Synthetic country');await change(field('last4'),'A123');await change(field('last4'),'A1234');assert.equal(field('last4').value,'A123');await change(field('last4'),'A123');assert.equal(field('last4').getAttribute('aria-invalid'),'false');await submit();assert.equal(calls.at(-1).body.identifier.last4,'A123')});
test('identifier submit guard rejects a programmatically injected long value without an input event',async()=>{await mountProfile();await click(button('Identifiers'));await click(button('Add metadata'));await change(field('type'),'Passport');await change(field('country'),'Synthetic country');field('last4').value='SYNTHETICFULL12345';await submit();assert.equal(calls.filter(call=>call.method==='POST').length,0);assert.match(query('.profile-field-error').textContent,/exactly four/)});
test('identifier partial suffix shows accessible application validation on submission',async()=>{await mountProfile();await click(button('Identifiers'));await click(button('Add metadata'));await change(field('type'),'Passport');await change(field('country'),'Synthetic country');await change(field('last4'),'A12');await submit();assert.match(query('.profile-field-error').textContent,/exactly four/);assert.equal(calls.filter(call=>call.method==='POST').length,0)});
for(const name of ['vacation','sick','wfh','bereavement'])for(const [value,message]of [['-1',/Negative allowances/],['0.1',/increments of 0.125/],['365.125',/0 to 365/],['',/Enter an allowance/]])test(`${name} ${JSON.stringify(value)} has explicit allowance validation and never calls save`,async()=>{await mountAllowance();await change(field(name),value);await submit();assert.equal(saves.length,0);assert.equal(field(name).getAttribute('aria-invalid'),'true');assert.match(query(`#allowance-${name}-error`).textContent,message);assert.equal(document.activeElement,field(name));assert.equal(query('form').noValidate,true)});
test('valid zero, eighth-day, fractional and maximum allowances save exactly as entered',async()=>{await mountAllowance();for(const [name,value]of [['vacation','0'],['sick','0.125'],['wfh','1.5'],['bereavement','365']])await change(field(name),value);await submit();assert.deepEqual(saves,[{action:'updateBudgets',employeeId:person.id,year:'2026',vacation:'0',sick:'0.125',wfh:'1.5',bereavement:'365'}])});
test('allowance errors clear after valid corrections and year changes reload saved 2027 values',async()=>{
 const budgets=[['Vacation',24],['Sick Leave',8],['WFH',35],['Bereavement',6]].map(([type,total])=>({employee_id:person.id,year:2027,type,total}));await mountAllowance(budgets);await change(field('vacation'),'0.1');await submit();assert.equal(saves.length,0);await change(field('vacation'),'0.125');assert.equal(field('vacation').getAttribute('aria-invalid'),'false');assert.equal(container.querySelector('.allowance-validation'),null);
 await change(field('sick'),'-1');await submit();await change(field('year'),'2027');assert.equal(container.querySelector('.allowance-validation'),null);assert.deepEqual(['vacation','sick','wfh','bereavement'].map(name=>field(name).value),['24','8','35','6']);assert.match(query('.allowance-year-status').textContent,/Saved allowances for 2027/);await submit();assert.equal(saves.at(-1).year,'2027');assert.equal(saves.at(-1).vacation,'24');
 await change(field('year'),'');assert.equal(container.querySelector('[name="vacation"]'),null);await change(field('year'),'2026');assert.equal(field('vacation').value,'15');
});
test('allowance status and error styles are scoped with explicit compact typography',()=>{const css=readFileSync(new URL('../app/allowance-editor.css',import.meta.url),'utf8');assert.match(css,/\.allowance-form \.allowance-year-status\s*\{[^}]*font-size: 12px/);assert.match(css,/\.allowance-form \.allowance-field-error\s*\{[^}]*font-size: 11px/)});
