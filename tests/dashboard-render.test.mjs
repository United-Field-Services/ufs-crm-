import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Compile the real component, without replacing its hooks, state or children.
const appRoot=fileURLToPath(new URL('../app/',import.meta.url));
registerHooks({
 resolve(specifier,context,next){try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)){for(const ext of ['.tsx','.ts'])try{return next(specifier+ext,context)}catch{}};throw error}},
 load(url,context,next){
  if(url.startsWith('file:')&&(fileURLToPath(url).startsWith(appRoot)||url.endsWith('/lib/workforce.ts'))){
   if(url.endsWith('.css'))return {format:'module',source:'export {};',shortCircuit:true};
   if(url.endsWith('.tsx')||url.endsWith('/lib/workforce.ts'))return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
  }
  return next(url,context);
 }
});
const {TalentDashboard}=await import('../app/dashboard.tsx');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const makeData=(role='admin')=>({
 headcountSnapshot:{sourceLabel:'TalentHR',sourceUrl:'https://unitedffs.talenthr.io/reports/headcount',verifiedAt:'2026-10-11',rows:[19,19,19,19,19,21,25,24,24,25,25,26,26].map((value,index)=>{const date=new Date(Date.UTC(2025,9+index,1));return {value,month:date.toISOString().slice(0,7),label:date.toLocaleDateString('en-US',{month:'short',year:'2-digit',timeZone:'UTC'})}})},me:{id:'owner',name:'Owner',role},
 people:[{id:'owner',name:'Owner',department:'Operations',division:'Corporate',location:'United States',title:'Owner',active:1,demo:0},{id:'sample',name:'Sample Employee',department:'Operations',division:'Field',location:'Asia',title:'Coordinator',active:1,demo:1}],
 requests:[],teamAway:[],documents:[],events:[],balances:[{type:'Vacation',total:15,used:2,pending:1}],tasks:[],activity:[],year:2026
});
const render=(data=makeData(),extra={})=>renderToStaticMarkup(React.createElement(TalentDashboard,{data,onNavigate:()=>{},onProfile:()=>{},onRequestLeave:()=>{},...extra}));

test('admin and HR default to explicitly dated, verified TalentHR headcount snapshot',()=>{
 for(const role of ['admin','hr_manager']){
  const html=render(makeData(role));
  assert.match(html,/TalentHR snapshot/);
  assert.match(html,/Verified Oct 11, 2026/);
  assert.match(html,/Not live-synced/);
  assert.match(html,/Employee profiles have not been imported/);
  assert.match(html,/https:\/\/unitedffs\.talenthr\.io\/reports\/headcount/);
  assert.match(html,/<strong>26<\/strong><span>employees · Oct 11<\/span>/);
  const expected=[['Oct 25',19],['Nov 25',19],['Dec 25',19],['Jan 26',19],['Feb 26',19],['Mar 26',21],['Apr 26',25],['May 26',24],['Jun 26',24],['Jul 26',25],['Aug 26',25],['Sep 26',26],['Oct 26',26]];
  for(const [month,count]of expected)assert.ok(html.includes(`<title>${month}: ${count}</title>`),`${role}: ${month} must have verified count ${count}`);
 }
});

test('employee and hiring-manager dashboards show self-service instead of HR reporting',()=>{
 for(const role of ['employee','hiring_manager']){const html=render(makeData(role));
 assert.doesNotMatch(html,/TalentHR snapshot|Oct 25: 19|employees · Oct 11|value="snapshot"|dashboard-reports-title|Full report/);
 assert.match(html,/dashboard-balances-title/);assert.match(html,/Request vacation/);assert.match(html,/class="td-demo">Demo/);
 const forced=render(makeData(role),{fullReport:true});assert.match(forced,/Reports are available to managers and HR/);assert.doesNotMatch(forced,/Export CSV/);}
});
test('manager dashboard aggregates direct reports only and never shows the historical HR snapshot',()=>{
 const data=makeData('manager');data.people.push({id:'direct',name:'Direct Employee',manager_id:'owner',active:1,demo:0});
 const html=render(data);assert.match(html,/<title>Non-demo profiles: 2<\/title>/);assert.match(html,/<title>Demo profiles: 0<\/title>/);assert.match(html,/Your direct team/);assert.doesNotMatch(html,/TalentHR snapshot/);
});

test('dashboard has screenshot report tabs, real organization filters, and Today/Tomorrow controls',()=>{
 const html=render();
 for(const label of ['Headcount','Locations','Divisions','Departments','Today','Tomorrow'])assert.match(html,new RegExp(`role="tab"[^>]*>${label}<`));
 for(const field of ['locations','divisions','departments'])assert.ok(html.includes(`aria-label="Filter by ${field}"`));
 assert.match(html,/aria-label="Search filtered people"/);
 assert.match(html,/aria-label="Show report filters"/);
 assert.match(html,/Current UFS records/);
 assert.ok(html.indexOf('dashboard-reports-title')<html.indexOf('dashboard-away-title'));
 assert.doesNotMatch(html,/Upcoming birthdays/);
});

test('full report renders all 13 verified aggregate rows, CSV action and return navigation only',()=>{
 const html=render(makeData(),{fullReport:true});
 assert.match(html,/Back to overview/);
 assert.match(html,/Export CSV/);
 assert.equal((html.match(/<tr>/g)||[]).length,14);
 assert.match(html,/<td>Oct 25<\/td><td>19<\/td>/);
 assert.match(html,/<td>Oct 26<\/td><td>26<\/td>/);
 assert.doesNotMatch(html,/dashboard-away-title|dashboard-people-title|dashboard-balances-title/);
});

test('current team absences are deduplicated without disclosing private reasons, and company holidays render',()=>{
 const data=makeData();
 data.teamAway=[{id:'a1',employee_id:'sample',name:'Sample Employee',start_date:today,end_date:today,demo:1,type:'Sensitive private reason',note:'Confidential detail'},{id:'a2',employee_id:'sample',name:'Sample Employee',start_date:today,end_date:today,demo:1}];
 data.events=[{id:'holiday',kind:'Holiday',title:'Company holiday',date:today,location:'All locations'}];
 const html=render(data),awaySection=html.slice(html.indexOf('aria-labelledby="dashboard-away-title"'),html.indexOf('aria-labelledby="dashboard-people-title"'));
 assert.equal((awaySection.match(/Sample Employee/g)||[]).length,1);
 assert.match(awaySection,/Company holiday/);
 assert.match(awaySection,/Current UFS records/);
 assert.doesNotMatch(html,/Sensitive private reason|Confidential detail/);
 assert.match(html,/12<small> days available/);
});
