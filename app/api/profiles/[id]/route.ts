import {currentEmployee,failure,response} from '../../../../lib/server';
import {jsonBody,sameOrigin} from '../../../../lib/policy';
import {readProfile,updateProfile} from '../../../../lib/profiles';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_req:Request,context:Context){try{const actor=await currentEmployee(),{id}=await context.params;return response(await readProfile(actor,id))}catch(error){return failure(error)}}
export async function POST(req:Request,context:Context){try{sameOrigin(req);const actor=await currentEmployee(),{id}=await context.params,body=await jsonBody(req);return response(await updateProfile(actor,id,body))}catch(error){return failure(error)}}
