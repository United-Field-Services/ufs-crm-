export const dynamic='force-dynamic';
// The authorized one-time directory transfer is complete. No database handler remains connected.
export async function POST(){return Response.json({error:'The one-time directory import is closed.'},{status:410,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
