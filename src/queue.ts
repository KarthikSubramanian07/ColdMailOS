import type { Env } from "./types";
import { loadSourceUrls } from "./config";
import { runScrape } from "./cron";

/**
 * Optional Cloudflare Queues driver. When a SCRAPE_QUEUE binding is present the
 * cron enqueues one message per URL instead of scraping inline; each message is
 * handled in its own Worker invocation, so every page gets a fresh 50-subrequest
 * budget and there is no timeout. A page too big to finish in one invocation is
 * re-enqueued (its chunk/dedupe state is cached, so it resumes cheaply).
 */
export interface ScrapeMessage {
  url: string;
  attempts?: number;
}

const MAX_RESUME_HOPS = 25; // safety cap so a stuck page can't loop forever

export async function enqueueAllUrls(env: Env): Promise<number> {
  if (!env.SCRAPE_QUEUE) return 0;
  const urls = await loadSourceUrls(env);
  await Promise.all(urls.map((url) => env.SCRAPE_QUEUE!.send({ url })));
  return urls.length;
}

export async function handleScrapeBatch(
  batch: MessageBatch<ScrapeMessage>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const report = await runScrape(env, msg.body.url);
      // Page didn't finish within this invocation's budget: resume in a new one.
      const attempts = (msg.body.attempts ?? 0) + 1;
      if (
        report.stoppedEarly &&
        report.urlsProcessed === 0 &&
        attempts < MAX_RESUME_HOPS &&
        env.SCRAPE_QUEUE
      ) {
        await env.SCRAPE_QUEUE.send({ url: msg.body.url, attempts });
      }
      msg.ack();
    } catch (err) {
      console.error("[queue] scrape failed:", err);
      msg.retry(); // transient error: let Queues retry with backoff
    }
  }
}
