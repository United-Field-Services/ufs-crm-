import {getHeadcountRoster} from '../../../lib/headcount-roster';
import {AppError,requireHR,scopeOf} from '../../../lib/policy';
import {currentEmployee,failure,response} from '../../../lib/server';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 const actor=await currentEmployee();requireHR(actor);
 const query=new URL(req.url).searchParams;
 if(query.getAll('month').length!==1||[...query.keys()].some(key=>key!=='month'))throw new AppError('Provide only one headcount snapshot month.');
 const roster=await getHeadcountRoster(actor,query.get('month')||'');
 const fresh=await currentEmployee();requireHR(fresh);
 if(fresh.id!==actor.id||fresh.user_id!==actor.user_id||fresh.role!==actor.role||scopeOf(fresh)!==scopeOf(actor))throw new AppError('Your access changed. Refresh the workspace.',403);
 return response(roster);
}catch(error){return failure(error)}}
