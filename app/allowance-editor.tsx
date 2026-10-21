'use client';
import {useState, type FormEvent} from 'react';
import {CircleAlert,Info,SlidersHorizontal} from 'lucide-react';
import './allowance-editor.css';
type Person={id?:string;name?:string;annual_allowance?:number;sick_allowance?:number;wfh_allowance?:number;bereavement_allowance?:number};
type Budget={employee_id?:string;year?:number;type?:string;total?:number};
const fields=[['Vacation','vacation','annual_allowance'],['Sick Leave','sick','sick_allowance'],['WFH','wfh','wfh_allowance'],['Bereavement','bereavement','bereavement_allowance']] as const;
function allowanceError(value:string){
 if(!value.trim()||!Number.isFinite(Number(value)))return 'Enter an allowance in days.';
 const days=Number(value);
 if(days<0||days>365)return 'Enter 0 to 365 days. Negative allowances are not allowed.';
 if(days%0.125!==0)return 'Use increments of 0.125 day, such as 0, 0.125, 0.25 or 1.';
 return '';
}
export function AllowanceEditor({person,budgets,year,busy,onSave,onCancel}:{person:Person;budgets:Budget[];year:number;busy:boolean;onSave:(values:Record<string,unknown>)=>void;onCancel:()=>void}){
 const [selectedYear,setSelectedYear]=useState(String(year));
 const [errors,setErrors]=useState<Record<string,string>>({});
 const validYear=/^\d{4}$/.test(selectedYear)&&Number(selectedYear)>=2020&&Number(selectedYear)<=2100;
 const saved=budgets.filter(b=>b.employee_id===person.id&&Number(b.year)===Number(selectedYear));
 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(busy||!validYear)return;
  const form=event.currentTarget,data=new FormData(form),nextErrors:Record<string,string>={};
  for(const [,name]of fields){const error=allowanceError(String(data.get(name)??''));if(error)nextErrors[name]=error;}
  setErrors(nextErrors);
  const firstInvalid=Object.keys(nextErrors)[0];
  if(firstInvalid){(form.elements.namedItem(firstInvalid) as HTMLInputElement|null)?.focus();return;}
  onSave({action:'updateBudgets',employeeId:person.id,...Object.fromEntries(data)});
 }
 // Remount only the allowance inputs when the year changes. Unsaved values from
 // another year cannot accompany the new year, including after an invalid input.
 return <><span className="icon-tile sage"><SlidersHorizontal/></span><h2 id="modal-title">A policy that fits.</h2><p>Set annual budgets for {person.name}. Changes are recorded in the audit trail.</p>
  <form className="allowance-form" onSubmit={submit} noValidate>
   <label htmlFor="allowance-year">Year<input id="allowance-year" name="year" type="number" min="2020" max="2100" value={selectedYear} onChange={event=>{setSelectedYear(event.target.value);setErrors({});}} disabled={busy} required aria-describedby="allowance-year-status"/></label>
   <p className="allowance-year-status" id="allowance-year-status" role="status">{!validYear?'Choose a year from 2020 to 2100 to load its allowances.':<>{saved.length===fields.length?`Saved allowances for ${selectedYear}.`:saved.length?`Saved allowances for ${selectedYear}; unconfigured types use this employee’s default annual allowances.`:`No saved allowances for ${selectedYear}. Starting from this employee’s default annual allowances. Nothing changes until you save.`}<span>Changing the year discards unsaved edits.</span></>}</p>
   {validYear&&<>
    <p className="allowance-hint" id="allowance-increment-hint">Enter 0–365 days in increments of 0.125 (one eighth of a day).</p>
    {Object.values(errors).some(Boolean)&&<div className="allowance-validation" role="alert"><CircleAlert size={16}/><span>Check the highlighted allowances before saving.</span></div>}
    <div className="form-row allowance-fields" key={selectedYear}>{fields.map(([type,name,col])=><label key={name} htmlFor={`allowance-${name}`}>{type} · days<input id={`allowance-${name}`} name={name} type="number" min="0" max="365" step="0.125" defaultValue={saved.find(b=>b.type===type)?.total??person[col]} disabled={busy} required aria-invalid={Boolean(errors[name])} aria-describedby={`allowance-increment-hint${errors[name]?` allowance-${name}-error`:''}`} onChange={event=>{if(errors[name]){const message=allowanceError(event.currentTarget.value);setErrors(previous=>({...previous,[name]:message}));}}}/>{errors[name]&&<span id={`allowance-${name}-error`} className="allowance-field-error">{errors[name]}</span>}</label>)}</div>
   </>}
   <div className="form-info"><Info size={15}/><span>Approved requests remain unchanged. Lowering a budget below days already used shows a negative remaining balance and blocks further approvals.</span></div>
   <div className="form-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="primary" disabled={busy||!validYear}>Save allowances</button></div>
  </form></>;
}
