import type { Env } from "./types";
import { runScrape } from "./cron";
import { handleWebhook } from "./webhook/handler";

/**
 * ResearchMailOS Worker entry.
 *   scheduled → the weekly scrape (extract researchers → Notion).
 *   fetch     → the Notion checkbox webhook (draft email → Gmail draft).
 */
export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runScrape(env).catch((err) => console.error("[scheduled] scrape failed:", err)),
    );
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Notion automation webhook.
    if (request.method === "POST" && url.pathname === "/webhook/notion") {
      return handleWebhook(request, env);
    }

    // Manually kick off a scrape (protected by the same webhook secret).
    if (request.method === "POST" && url.pathname === "/scrape") {
      const secret = request.headers.get("X-RMOS-Secret") ?? url.searchParams.get("secret") ?? "";
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      ctx.waitUntil(runScrape(env).catch((err) => console.error("[scrape] failed:", err)));
      return new Response("scrape started\n", { status: 202 });
    }

    if (url.pathname === "/health") {
      return new Response("ok\n");
    }

    if (url.pathname === "/") {
      return new Response(
        "ResearchMailOS is running.\n\n" +
          "POST /webhook/notion  — Notion checkbox automation target\n" +
          "POST /scrape          — manually trigger a scrape (needs ?secret=)\n" +
          "GET  /health          — health check\n",
        { headers: { "Content-Type": "text/plain" } },
      );
    }

    return new Response("not found\n", { status: 404 });
  },
};
