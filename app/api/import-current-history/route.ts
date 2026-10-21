export const dynamic='force-dynamic';
// Authorized history transfer is complete and reconciled; no write handler remains connected.
export async function POST(){return Response.json({error:'The current-history import is closed.'},{status:410,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
