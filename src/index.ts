import type { Env } from "./types";
import { runScrape } from "./cron";
import { handleWebhook } from "./webhook/handler";

/** Constant-time string comparison to avoid leaking the secret via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * ColdMailOS Worker entry.
 *   scheduled → the weekly scrape (extract contacts → Notion).
 *   fetch     → the Notion checkbox webhook (draft email → Gmail draft; or remove).
 */
export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Scheduled handlers get the full time budget, so awaiting inside waitUntil is fine.
    ctx.waitUntil(runScrape(env).catch((err) => console.error("[scheduled] scrape failed:", err)));
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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

    if (url.pathname === "/health") return new Response("ok\n");

    if (url.pathname === "/") {
      return new Response(
        "ColdMailOS is running.\n\n" +
          "POST /webhook/notion  — Notion automation target (draft / remove)\n" +
          "POST /scrape          — manually trigger a scrape (needs ?secret=)\n" +
          "GET  /health          — health check\n",
        { headers: { "Content-Type": "text/plain" } },
      );
    }

    return new Response("not found\n", { status: 404 });
  },
};
