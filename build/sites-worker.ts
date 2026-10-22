import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { stripPlatformIdentity } from "../lib/self-hosted";
import { flushOutbox, takeOutboxDirty } from "../lib/notifications";
import { runReminders } from "../lib/reminders";

export default {
  async fetch(incoming: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    // Outside OpenAI Sites nobody vouches for these headers, so a visitor could forge them.
    const request = env.UFS_SELF_HOSTED === "true" ? stripPlatformIdentity(incoming) : incoming;
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const handled = await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    // Emails queued during this request go out right after the response, without making the person wait.
    if (takeOutboxDirty()) ctx.waitUntil(flushOutbox());
    const response = new Response(handled.body, handled);
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/') || !/\.[a-z0-9]+$/i.test(pathname)) {
      response.headers.set('Cache-Control', 'no-store, private');
      response.headers.set('Pragma', 'no-cache');
      const vary = new Set((response.headers.get('Vary') || '').split(',').map(v => v.trim()).filter(Boolean));
      vary.add('Cookie');
      response.headers.set('Vary', [...vary].join(', '));
    }
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (!import.meta.env.DEV) response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com");
    return response;
  },
  // Cron: every minute send queued emails; every 30 minutes also create reminders (see lib/reminders.ts).
  async scheduled(event: ScheduledController, _env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      if (event.cron === "*/30 * * * *") await runReminders();
      await flushOutbox(50);
    })());
  },
};
