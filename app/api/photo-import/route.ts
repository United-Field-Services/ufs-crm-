export const dynamic='force-dynamic';
// The authorized one-time photo transfer is complete. No import/storage handler remains connected.
export async function POST(){return Response.json({error:'The one-time profile photo import is closed.'},{status:410,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
