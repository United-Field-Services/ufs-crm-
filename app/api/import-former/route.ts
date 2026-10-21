export const dynamic='force-dynamic';
// Authorized transfer is complete and reconciled. No database handler remains connected.
export async function POST(){return Response.json({error:'The former-staff import is closed.'},{status:410,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
