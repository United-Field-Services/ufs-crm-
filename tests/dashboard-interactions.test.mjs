import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';

// Real React state, rendered DOM and bubbling DOM events. This is not a browser
// layout or device test, and no chart hooks or application children are mocked.
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://ufs.example.test'});
for(const name of ['window','document','HTMLElement','SVGElement','Event','MouseEvent','KeyboardEvent'])globalThis[name]=name==='window'?dom.window:name==='document'?dom.window.document:dom.window[name];
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const rootPath=fileURLToPath(new URL('../',import.meta.url));
registerHooks({
 resolve(specifier,context,next){try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)){for(const ext of ['.tsx','.ts'])try{return next(specifier+ext,context)}catch{}}throw error}},
 load(url,context,next){
  if(url.startsWith('file:')&&fileURLToPath(url).startsWith(rootPath)&&!url.includes('/node_modules/')){
   if(url.endsWith('.css'))return {format:'module',source:'export {};',shortCircuit:true};
   if(/\.tsx?$/.test(url))return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
  }
  return next(url,context);
 }
});
const {TalentDashboard}=await import('../app/dashboard.tsx');
after(()=>dom.window.close());
const person=(id,overrides={})=>({id,name:id,title:'Team member',department:'Operations',division:'Corporate',location:'United States',active:1,demo:0,...overrides});
function makeData(role='admin'){
 return {headcountSnapshot:{sourceLabel:'TalentHR',sourceUrl:'https://unitedffs.talenthr.io/reports/headcount',verifiedAt:'2026-10-11',rows:[19,19,19,19,19,21,25,24,24,25,25,26,26].map((value,index)=>{const date=new Date(Date.UTC(2025,9+index,1));return {value,month:date.toISOString().slice(0,7),label:date.toLocaleDateString('en-US',{month:'short',year:'2-digit',timeZone:'UTC'})}})},me:{id:'owner',name:'Owner',role},people:[
  person('owner'),
  person('alice',{active:0,directory_active:1,manager_id:'owner',division:'Field',location:'United Kingdom'}),
  person('bob',{manager_id:'owner',department:'Sales',division:'Field'}),
  person('cathy',{manager_id:'someone-else',department:'Support',division:'Customer',location:'Canada'}),
  person('sample',{manager_id:'owner',demo:1,location:'United Kingdom'}),
  person('former',{active:0,directory_active:0,location:'Former-only location'})
 ],requests:[],teamAway:[],documents:[],events:[],balances:[],tasks:[],activity:[],year:2026,importSummary:{employees:4}};
}
async function mount(t,{data=makeData(),fullReport=false}={}){
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container),navigations=[];
 await act(()=>root.render(React.createElement(TalentDashboard,{data,fullReport,onNavigate:value=>navigations.push(value),onProfile:()=>{},onRequestLeave:()=>{}})));
 t.after(async()=>{await act(()=>root.unmount());container.remove()});
 return {container,navigations};
}
const one=(container,selector)=>{const result=container.querySelector(selector);assert.ok(result,`Missing DOM element: ${selector}`);return result};
const source=container=>one(container,'select[aria-label="Report source"]');
const chartButtons=container=>[...container.querySelectorAll('.td-chart-bar')];
const labels=container=>chartButtons(container).map(button=>button.getAttribute('aria-label'));
const status=container=>one(container,'.td-chart-selection[role="status"]');
const total=container=>one(container,'.td-report-total strong').textContent;
const tab=(container,label)=>one(container,`.td-reports button[role="tab"][id$="-${label}"]`);
async function click(element){await act(()=>element.click())}
async function change(element,value){await act(()=>{element.value=value;element.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})}
async function key(element,value){const event=new dom.window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true});await act(()=>element.dispatchEvent(event));return event}
async function pointer(element,type,pointerType='mouse'){
 const event=new dom.window.Event(type,{bubbles:true});Object.defineProperty(event,'pointerType',{value:pointerType});await act(()=>element.dispatchEvent(event));
}
async function filters(container){await click(one(container,'button[aria-label="Show report filters"]'));return one(container,'.td-filter-panel')}
const filter=(panel,field)=>one(panel,`select[aria-label="Filter by ${field}"]`);

test('touch/click selects an exact historical value and keeps visible details after pointer leave',async t=>{
 const {container}=await mount(t);
 assert.equal(chartButtons(container).length,13);assert.match(status(container).textContent,/Oct 26.*26 employees/);
 const march=one(container,'button[aria-label="Mar 26: 21 employees"]');
 await pointer(march,'pointerover','touch');await click(march);await pointer(march,'pointerout','touch');
 assert.match(status(container).textContent,/Mar 26.*21 employees.*TalentHR snapshot/);
 assert.equal(march.getAttribute('aria-pressed'),'true');assert.equal(container.querySelectorAll('.td-chart-bar[aria-pressed="true"]').length,1);
 assert.equal(status(container).getAttribute('aria-live'),'polite');assert.equal(march.getAttribute('aria-controls'),status(container).id);
 assert.equal(container.querySelectorAll('.td-bar.selected').length,1);
});

test('mouse hover previews a different bar and returns to the clicked selection',async t=>{
 const {container}=await mount(t),march=one(container,'button[aria-label="Mar 26: 21 employees"]'),april=one(container,'button[aria-label="Apr 26: 25 employees"]');
 await click(march);await pointer(april,'pointerover');assert.match(status(container).textContent,/Apr 26.*25 employees/);
 assert.equal(march.getAttribute('aria-pressed'),'true');await pointer(april,'pointerout');assert.match(status(container).textContent,/Mar 26.*21 employees/);
});

test('chart buttons handle focus, arrow keys, Home, End, Enter and Space',async t=>{
 const {container}=await mount(t),buttons=chartButtons(container);
 await act(()=>buttons[0].focus());assert.match(status(container).textContent,/Oct 25.*19 employees/);
 assert.equal((await key(buttons[0],'ArrowRight')).defaultPrevented,true);assert.equal(document.activeElement,buttons[1]);assert.match(status(container).textContent,/Nov 25.*19 employees/);
 await key(buttons[1],'End');assert.equal(document.activeElement,buttons.at(-1));assert.match(status(container).textContent,/Oct 26.*26 employees/);
 await key(buttons.at(-1),'ArrowRight');assert.equal(document.activeElement,buttons.at(-1));
 await key(buttons.at(-1),'Home');assert.equal(document.activeElement,buttons[0]);
 await key(buttons[0],'ArrowDown');assert.equal(document.activeElement,buttons[1]);
 await key(buttons[1],'ArrowUp');assert.equal(document.activeElement,buttons[0]);
 await key(buttons[0],'Enter');assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
 await key(buttons[0],' ');assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
});

test('date presets operate only within the 13 verified recorded months',async t=>{
 const {container}=await mount(t),range=one(container,'select[aria-label="Snapshot date range"]');
 await change(range,'3');assert.deepEqual(labels(container),['Aug 26: 25 employees','Sep 26: 26 employees','Oct 26: 26 employees']);
 await change(range,'6');assert.equal(chartButtons(container).length,6);assert.equal(labels(container)[0],'May 26: 24 employees');
 await change(range,'year');assert.equal(chartButtons(container).length,10);assert.equal(labels(container)[0],'Jan 26: 19 employees');
 await change(range,'all');assert.equal(chartButtons(container).length,13);assert.equal(labels(container)[0],'Oct 25: 19 employees');
 assert.match(container.textContent,/Verified Oct 11, 2026. Not live-synced/);
});

test('custom start/end dates update bars and endpoint total, and cannot form a reversed range',async t=>{
 const {container}=await mount(t),start=one(container,'select[aria-label="Snapshot start month"]'),end=one(container,'select[aria-label="Snapshot end month"]');
 await change(start,'2026-03');await change(end,'2026-04');assert.deepEqual(labels(container),['Mar 26: 21 employees','Apr 26: 25 employees']);assert.equal(total(container),'25');
 assert.match(one(container,'.td-report-total').textContent,/employees · Apr 26/);assert.equal(one(container,'select[aria-label="Snapshot date range"]').value,'custom');
 await change(start,'2026-07');assert.equal(end.value,'2026-07');assert.deepEqual(labels(container),['Jul 26: 25 employees']);
 await change(end,'2025-12');assert.equal(start.value,'2025-12');assert.deepEqual(labels(container),['Dec 25: 19 employees']);assert.equal(total(container),'19');
});

test('all report category tabs change actual grouped current-profile counts',async t=>{
 const {container}=await mount(t);
 await click(tab(container,'Locations'));assert.equal(source(container).value,'real');assert.deepEqual(labels(container),['United States: 2 profiles','Canada: 1 profiles','United Kingdom: 1 profiles']);
 assert.equal(total(container),'4');assert.equal(container.querySelector('select[aria-label="Snapshot date range"]'),null);
 await click(tab(container,'Divisions'));assert.deepEqual(labels(container),['Field: 2 profiles','Corporate: 1 profiles','Customer: 1 profiles']);
 await click(tab(container,'Departments'));assert.deepEqual(labels(container),['Operations: 2 profiles','Sales: 1 profiles','Support: 1 profiles']);
 await click(tab(container,'Headcount'));assert.deepEqual(labels(container),['Non-demo profiles: 4 profiles']);assert.match(status(container).textContent,/Current filtered UFS People records/);
});

test('report tabs use keyboard navigation and linked selected tab/panel semantics',async t=>{
 const {container}=await mount(t),headcount=tab(container,'Headcount');await act(()=>headcount.focus());
 await key(headcount,'ArrowRight');const locations=tab(container,'Locations');assert.equal(document.activeElement,locations);assert.equal(locations.getAttribute('aria-selected'),'true');assert.equal(locations.tabIndex,0);assert.equal(headcount.tabIndex,-1);
 assert.equal(one(container,'[role="tabpanel"]').getAttribute('aria-labelledby'),locations.id);
 await key(locations,'End');assert.equal(document.activeElement,tab(container,'Departments'));
 await key(tab(container,'Departments'),'ArrowRight');assert.equal(document.activeElement,headcount);
 await key(headcount,'ArrowLeft');assert.equal(document.activeElement,tab(container,'Departments'));
 await key(tab(container,'Departments'),'Home');assert.equal(document.activeElement,headcount);
});

test('organization filters explicitly leave historical snapshot and can clear all current filters',async t=>{
 const {container}=await mount(t),panel=await filters(container);
 assert.match(panel.textContent,/Choosing a filter switches to current UFS profiles. Historical breakdowns are not available/);
 await change(filter(panel,'locations'),'United Kingdom');assert.equal(source(container).value,'real');assert.equal(total(container),'1');assert.deepEqual(labels(container),['Non-demo profiles: 1 profiles']);
 assert.equal(container.querySelector('select[aria-label="Snapshot date range"]'),null);assert.doesNotMatch(status(container).textContent,/TalentHR snapshot/);
 await click(tab(container,'Departments'));assert.deepEqual(labels(container),['Operations: 1 profiles']);
 await change(filter(panel,'divisions'),'Field');await change(filter(panel,'departments'),'Operations');assert.equal(total(container),'1');
 assert.equal(one(container,'.td-filter-toggle>span').textContent,'3');
 await click(one(panel,'button'));assert.equal(total(container),'4');for(const select of panel.querySelectorAll('select'))assert.equal(select.value,'');
 await click(one(container,'button[aria-label="Hide report filters"]'));assert.equal(container.querySelector('.td-filter-panel'),null);
});

test('source switch includes demos only on request and restores unfiltered dated aggregate snapshot',async t=>{
 const {container}=await mount(t);
 await change(source(container),'review');assert.equal(total(container),'5');assert.deepEqual(labels(container),['Non-demo profiles: 4 profiles','Demo profiles: 1 profiles']);
 await change(source(container),'real');assert.equal(total(container),'4');assert.deepEqual(labels(container),['Non-demo profiles: 4 profiles']);
 const panel=await filters(container);await change(filter(panel,'locations'),'Canada');assert.equal(total(container),'1');
 await change(source(container),'snapshot');assert.equal(total(container),'26');assert.equal(chartButtons(container).length,13);assert.equal(filter(panel,'locations').value,'');assert.equal(tab(container,'Headcount').getAttribute('aria-selected'),'true');
});

test('empty filtered category view clears old chart details instead of displaying stale values',async t=>{
 const {container}=await mount(t);await click(tab(container,'Departments'));const panel=await filters(container);
 await change(filter(panel,'locations'),'United Kingdom');await change(filter(panel,'departments'),'Sales');
 assert.equal(total(container),'0');assert.equal(chartButtons(container).length,0);assert.equal(container.querySelector('.td-chart-selection'),null);assert.match(container.textContent,/No profiles match these filters/);
});

test('manager interactions retain direct-team scope and never expose historical HR source',async t=>{
 const {container}=await mount(t,{data:makeData('manager')});assert.equal(total(container),'3');assert.deepEqual(labels(container),['Non-demo profiles: 3 profiles']);assert.equal(source(container).querySelector('option[value="snapshot"]'),null);
 await click(tab(container,'Departments'));assert.deepEqual(labels(container),['Operations: 2 profiles','Sales: 1 profiles']);assert.doesNotMatch(labels(container).join(','),/Support/);
 await change(source(container),'review');assert.equal(total(container),'4');await click(tab(container,'Headcount'));assert.deepEqual(labels(container),['Non-demo profiles: 3 profiles','Demo profiles: 1 profiles']);assert.match(container.textContent,/Your direct team/);
});

test('HR manager has chart interactions while employee/hiring-manager have no report controls',async t=>{
 const hr=await mount(t,{data:makeData('hr_manager')});await click(one(hr.container,'button[aria-label="May 26: 24 employees"]'));assert.match(status(hr.container).textContent,/May 26.*24 employees/);
 for(const role of ['employee','hiring_manager']){const {container}=await mount(t,{data:makeData(role)});assert.equal(chartButtons(container).length,0);assert.equal(container.querySelector('select[aria-label="Report source"]'),null);assert.equal(container.querySelector('[role="tabpanel"]'),null)}
});

test('full-report navigation fires, and CSV/table export follows the selected historical range',async t=>{
 const overview=await mount(t);await click(one(overview.container,'.td-report-tools .td-outline'));assert.deepEqual(overview.navigations,['Reports']);
 const {container,navigations}=await mount(t,{fullReport:true});await change(one(container,'select[aria-label="Snapshot start month"]'),'2026-03');await change(one(container,'select[aria-label="Snapshot end month"]'),'2026-04');
 assert.deepEqual([...container.querySelectorAll('tbody tr')].map(row=>row.textContent),['Mar 2621','Apr 2625']);
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,originalClick=dom.window.HTMLAnchorElement.prototype.click;let downloaded,filename;
 URL.createObjectURL=blob=>{downloaded=blob;return 'blob:test-report'};URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=function(){filename=this.download};
 try{await click(one(container,'.td-full-report-toolbar button'));const csv=await downloaded.text();assert.equal(filename,'ufs-talenthr-snapshot-headcount.csv');assert.match(csv,/"Range","2026-03 to 2026-04"/);assert.match(csv,/"Mar 26","21"/);assert.match(csv,/"Apr 26","25"/);assert.doesNotMatch(csv,/"May 26"|"Oct 25"/);assert.match(csv,/not live-synced/)}finally{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;dom.window.HTMLAnchorElement.prototype.click=originalClick}
 await click(one(container,'.td-report-tools .td-outline'));assert.deepEqual(navigations,['Overview']);
});

test('zero-valued bars still support selection and long category names remain available in details',async t=>{
 const empty=makeData('manager');empty.people=[];const zero=await mount(t,{data:empty});
 await click(one(zero.container,'button[aria-label="Non-demo profiles: 0 profiles"]'));assert.match(status(zero.container).textContent,/0 profiles/);
 const long=makeData();long.people=[person('owner',{location:'A very long location name that should never disappear from the selected details'})];
 const {container}=await mount(t,{data:long});await click(tab(container,'Locations'));await click(chartButtons(container)[0]);
 assert.match(status(container).textContent,/A very long location name that should never disappear from the selected details/);
});

test('historical axis labels use two horizontal lines with reserved bottom spacing',async t=>{
 const {container}=await mount(t);const labels=[...container.querySelectorAll('svg .td-axis')].filter(node=>node.querySelector('tspan'));
 assert.equal(labels.length,13);assert.deepEqual([...labels[0].querySelectorAll('tspan')].map(node=>node.textContent),['Oct','2025']);assert.equal(labels.some(node=>node.hasAttribute('transform')),false);
 const view=one(container,'.td-chart svg').getAttribute('viewBox').split(' ').map(Number);assert.ok(labels.every(node=>Number(node.getAttribute('y'))+32<view[3]));
});
