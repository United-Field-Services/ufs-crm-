// Server-only report data. Imported only by an authenticated API route, never client components.
import {requireHR,scopeOf,type Employee} from './policy';
const rows=[['Oct 25',19],['Nov 25',19],['Dec 25',19],['Jan 26',19],['Feb 26',19],['Mar 26',21],['Apr 26',25],['May 26',24],['Jun 26',24],['Jul 26',25],['Aug 26',25],['Sep 26',26],['Oct 26',26]].map(([label,value],index)=>({label:String(label),value:Number(value),month:new Date(Date.UTC(2025,9+index,1)).toISOString().slice(0,7)}));

export function getHeadcountSnapshot(actor:Employee,testHeadcount=0){requireHR(actor);if(scopeOf(actor)!=='live')return {sourceLabel:'Synthetic test data',sourceUrl:null,verifiedAt:new Date().toISOString().slice(0,10),rows:[{label:'Test employees',value:testHeadcount,month:new Date().toISOString().slice(0,7)}]};return {sourceLabel:'TalentHR',sourceUrl:'https://unitedffs.talenthr.io/reports/headcount',verifiedAt:'2026-10-11',rows};}
