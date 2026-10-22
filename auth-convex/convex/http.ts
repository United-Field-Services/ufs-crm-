import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

// Serves /.well-known/openid-configuration and /.well-known/jwks.json, which the
// UFS People server uses to verify sign-in tokens.
auth.addHttpRoutes(http);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Same-length comparison that does not stop at the first difference.
function sameSecret(given: string, expected: string) {
  if (given.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < given.length; i++) difference |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

// Notification email for UFS People. Only the UFS People server knows NOTIFY_SECRET (set on this deployment and
// on the Cloudflare Worker). The message goes only to an address that belongs to an invited person, so even a
// leaked secret cannot be used to email strangers.
http.route({
  path: "/notify",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.NOTIFY_SECRET;
    const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!expected || !sameSecret(given, expected)) return json({ error: "Not allowed" }, 401);
    let body: { to?: unknown; subject?: unknown; text?: unknown; html?: unknown };
    try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
    const { to, subject, text, html } = body;
    if (typeof to !== "string" || !EMAIL.test(to) || to.length > 254) return json({ error: "Invalid address" }, 400);
    if (typeof subject !== "string" || !subject.trim() || subject.length > 200) return json({ error: "Invalid subject" }, 400);
    if (typeof text !== "string" || !text || text.length > 20000) return json({ error: "Invalid text" }, 400);
    if (html !== undefined && (typeof html !== "string" || html.length > 60000)) return json({ error: "Invalid html" }, 400);
    const known = await ctx.runQuery(internal.invites.isKnown, { email: to });
    if (!known) return json({ error: "Unknown recipient" }, 404);
    try {
      await ctx.runAction(internal.mailSmtp.send, { to, subject: subject.replace(/[\r\n]+/g, " "), text, ...(typeof html === "string" ? { html } : {}) });
    } catch {
      return json({ error: "Could not send" }, 502);
    }
    return json({ ok: true }, 200);
  }),
});

export default http;
