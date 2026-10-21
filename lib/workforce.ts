export type PersonRecord={id:string;name:string;title?:string;department?:string;location?:string;employment?:string;active?:number|boolean;demo?:number|boolean;manager_id?:string|null;[key:string]:unknown};
export type ReportDimension='Headcount'|'Departments'|'Locations'|'Employment';
export type ReportRow={label:string;value:number;demo:number;real:number};
export function directoryActive(p:PersonRecord){return Boolean(p.directory_active??p.active)}
export function currentPeople(people:PersonRecord[],scope='review'){return people.filter(p=>directoryActive(p)&&(scope!=='real'||!p.demo));}
export function workforceRows(people:PersonRecord[],dimension:ReportDimension,scope='review'):ReportRow[]{
 const active=currentPeople(people,scope);
 if(dimension==='Headcount')return [{label:'Non-demo profiles',value:active.filter(p=>!p.demo).length,demo:0,real:active.filter(p=>!p.demo).length},...(scope==='review'?[{label:'Demo profiles',value:active.filter(p=>p.demo).length,demo:active.filter(p=>p.demo).length,real:0}]:[])];
 const field={Departments:'department',Locations:'location',Employment:'employment'}[dimension];
 const grouped=new Map<string,ReportRow>();for(const p of active){const label=String(p[field]||'Unassigned');const row=grouped.get(label)||{label,value:0,demo:0,real:0};row.value++;if(p.demo)row.demo++;else row.real++;grouped.set(label,row);}
 return [...grouped.values()].sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label));
}
export function organizationGroups(people:PersonRecord[],mode='Departments'){
 const active=currentPeople(people);const groups=new Map<string,{id:string;label:string;subtitle:string;people:PersonRecord[]}>();
 for(const p of active){const reporting=mode==='Source reporting';const manager=active.find(m=>m.id===(reporting?p.source_manager_employee_id:p.manager_id)&&m.id!==p.id);const id=mode==='Departments'?String(p.department||'Unassigned'):manager?.id||(reporting&&p.source_manager_name?'source:'+String(p.source_manager_name):'unassigned');const label=mode==='Departments'?id:manager?.name||(reporting?String(p.source_manager_name||'No source manager recorded'):'No active approver assigned');const subtitle=mode==='Departments'?'Department':reporting?'Imported reporting metadata':manager?.title||'Approval route';const group=groups.get(id)||{id,label,subtitle,people:[]};group.people.push(p);groups.set(id,group);}
 return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
export function summaryCsv(rows:ReportRow[],dimension:ReportDimension,scope:string,date:string){const quote=(s:string|number)=>'"'+(typeof s==='string'&&/^[=+@\-\t\r]/.test(s)?"'"+s:String(s)).replaceAll('"','""')+'"';return [['UFS People workforce summary'],['As of',date],['Scope',scope==='real'?'Active non-demo profiles in UFS People':'Active UFS People review profiles, including demo records'],['Source','Current UFS People directory, including imported snapshots where available; no live synchronization'],[dimension,'Total','Non-demo','Demo'],...rows.map(r=>[r.label,r.value,r.real,r.demo])].map(row=>row.map(quote).join(',')).join('\r\n');}
