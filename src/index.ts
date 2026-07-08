import type { Env } from "./types";
import { runScrape } from "./cron";
import { handleWebhook } from "./webhook/handler";
import { timingSafeEqual } from "./security";
import { suppress, verifyUnsubscribe } from "./suppress";
import { runFollowUps } from "./followups";
import { recordEvent, pixelResponse } from "./tracking";

/**
 * ColdMailOS Worker entry.
 *   scheduled -> the weekly scrape (extract contacts -> Notion).
 *   fetch     -> the Notion checkbox webhook (draft email -> Gmail draft; or remove).
 */
export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Scheduled handlers get the full time budget, so awaiting inside waitUntil is fine.
    ctx.waitUntil(runScrape(env).catch((err) => console.error("[scheduled] scrape failed:", err)));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Click tracking: record then 302 to the target. Only for a known track id
    // (random UUID), so this can't be abused as a generic open redirect.
    if (url.pathname.startsWith("/c/")) {
      const trackId = url.pathname.slice(3);
      const target = url.searchParams.get("u");
      const pageId = trackId ? await env.KV.get(`track:${trackId}`) : null;
      if (pageId && target) {
        ctx.waitUntil(recordEvent(env, trackId, "clicked", Date.now()));
        return Response.redirect(target, 302);
      }
      return new Response("bad link\n", { status: 400 });
    }

    // Open pixel: return the 1x1 immediately, record in the background.
    if (url.pathname.startsWith("/o/")) {
      const trackId = url.pathname.slice(3);
      if (trackId) ctx.waitUntil(recordEvent(env, trackId, "opened", Date.now()));
      return pixelResponse();
    }

    // Notion automation webhook (draft / remove).
    if (request.method === "POST" && url.pathname === "/webhook/notion") {
      return handleWebhook(request, env);
    }

    // Manually trigger a scrape. We AWAIT it (not waitUntil) so it runs within
    // the request lifetime instead of being cancelled ~30s after the response.
    if (request.method === "POST" && url.pathname === "/scrape") {
      const secret = request.headers.get("X-RMOS-Secret") ?? url.searchParams.get("secret") ?? "";
      if (!timingSafeEqual(secret, env.WEBHOOK_SECRET)) {
        return new Response("unauthorized\n", { status: 401 });
      }
      try {
        const report = await runScrape(env);
        return new Response(JSON.stringify(report, null, 2) + "\n", {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(`scrape failed: ${err instanceof Error ? err.message : err}\n`, {
          status: 500,
        });
      }
    }

    // One-click unsubscribe (RFC 8058 POST, or a GET from clicking the link).
    // The token is an HMAC of the address, so only links we generated work.
    if (url.pathname === "/unsubscribe") {
      const email = url.searchParams.get("e") ?? "";
      const token = url.searchParams.get("t") ?? "";
      if (email && token && (await verifyUnsubscribe(env.WEBHOOK_SECRET, email, token))) {
        await suppress(env, email);
        return new Response("You're unsubscribed. You won't be contacted again.\n", {
          headers: { "Content-Type": "text/plain" },
        });
      }
      return new Response("invalid unsubscribe link\n", { status: 400 });
    }

    // Draft due follow-ups for rows in the Emailed state (draft-only). Secret-gated.
    if (request.method === "POST" && url.pathname === "/followups") {
      const secret = request.headers.get("X-RMOS-Secret") ?? url.searchParams.get("secret") ?? "";
      if (!timingSafeEqual(secret, env.WEBHOOK_SECRET)) {
        return new Response("unauthorized\n", { status: 401 });
      }
      try {
        const report = await runFollowUps(env, url.origin, Date.now());
        return new Response(JSON.stringify(report, null, 2) + "\n", {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(`followups failed: ${err instanceof Error ? err.message : err}\n`, {
          status: 500,
        });
      }
    }

    if (url.pathname === "/health") return new Response("ok\n");

    if (url.pathname === "/") {
      return new Response(
        "ColdMailOS is running.\n\n" +
          "POST /webhook/notion  - Notion automation target (draft / remove)\n" +
          "POST /scrape          - manually trigger a scrape (needs ?secret=)\n" +
          "POST /followups       - draft due follow-ups (needs ?secret=)\n" +
          "GET  /unsubscribe     - one-click opt-out (signed token)\n" +
          "GET  /health          - health check\n",
        { headers: { "Content-Type": "text/plain" } },
      );
    }

    return new Response("not found\n", { status: 404 });
  },
};
