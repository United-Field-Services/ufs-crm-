// Sends one notification email through your SMTP mailbox. Deploy with:
//   supabase functions deploy send-mail --no-verify-jwt
//   supabase secrets set SMTP_USER=noreply@your-domain SMTP_PASS="app password"      (optional: SMTP_HOST, SMTP_PORT, SMTP_FROM)
// Only the UFS People server may call it: the request must carry the project's service key, and the message may only go to an
// address that belongs to an active employee, so a leaked key cannot be used to email strangers.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function sameSecret(given: string, expected: string) {
  if (given.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < given.length; i++) difference |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

async function isEmployee(address: string, url: string, key: string) {
  const response = await fetch(`${url}/rest/v1/rpc/ufs_batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ statements: [{ sql: "SELECT 1 AS ok FROM employees WHERE lower(email) = $1 AND active = 1 AND demo = 0 LIMIT 1", params: [address.toLowerCase()] }] }),
  });
  if (!response.ok) return false;
  const [answer] = (await response.json()) as { rows: unknown[] }[];
  return answer.rows.length > 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!key || !sameSecret(given, key)) return json({ error: "Not allowed" }, 401);

  let body: { to?: unknown; subject?: unknown; text?: unknown; html?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const { to, subject, text, html } = body;
  if (typeof to !== "string" || !EMAIL.test(to) || to.length > 254) return json({ error: "Invalid address" }, 400);
  if (typeof subject !== "string" || !subject.trim() || subject.length > 200) return json({ error: "Invalid subject" }, 400);
  if (typeof text !== "string" || !text || text.length > 20000) return json({ error: "Invalid text" }, 400);
  if (html !== undefined && (typeof html !== "string" || html.length > 60000)) return json({ error: "Invalid html" }, 400);
  if (!(await isEmployee(to, url, key))) return json({ error: "Unknown recipient" }, 404);

  const user = Deno.env.get("SMTP_USER") ?? "";
  const pass = (Deno.env.get("SMTP_PASS") ?? "").replace(/\s+/g, "");
  if (!user || !pass) return json({ error: "Mail is not configured" }, 503);
  const port = Number(Deno.env.get("SMTP_PORT") || 465);
  const client = new SMTPClient({
    connection: { hostname: Deno.env.get("SMTP_HOST") || "smtp.gmail.com", port, tls: port === 465, auth: { username: user, password: pass } },
  });
  try {
    await client.send({
      from: Deno.env.get("SMTP_FROM") || `UFS People <${user}>`,
      to,
      subject: subject.replace(/[\r\n]+/g, " "),
      content: text,
      ...(typeof html === "string" ? { html } : {}),
    });
    return json({ ok: true }, 200);
  } catch {
    // Only the fact of failure is reported: never the address or the provider's message.
    console.error("Notification email was not sent");
    return json({ error: "Could not send" }, 502);
  } finally {
    try { await client.close(); } catch { /* already closed */ }
  }
});
