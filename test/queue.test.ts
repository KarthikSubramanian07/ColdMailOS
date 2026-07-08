import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the scrape so we can test the queue driver in isolation.
// vi.hoisted lets the mock factory reference the fn despite hoisting.
const { runScrape } = vi.hoisted(() => ({ runScrape: vi.fn() }));
vi.mock("../src/cron", () => ({ runScrape }));

import { enqueueAllUrls, handleScrapeBatch } from "../src/queue";

beforeEach(() => runScrape.mockReset());

function envWith(urls: string[], send = vi.fn()) {
  return {
    KV: { get: async () => JSON.stringify(urls) },
    SCRAPE_QUEUE: { send },
  } as any;
}

const msg = (url: string, attempts?: number) => ({
  body: { url, attempts },
  ack: vi.fn(),
  retry: vi.fn(),
});

describe("enqueueAllUrls", () => {
  it("sends one message per configured URL", async () => {
    const send = vi.fn();
    const n = await enqueueAllUrls(envWith(["https://a.com", "https://b.com"], send));
    expect(n).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({ url: "https://a.com" });
  });
});

describe("handleScrapeBatch", () => {
  it("acks and re-enqueues a page that didn't finish", async () => {
    runScrape.mockResolvedValue({ stoppedEarly: true, urlsProcessed: 0 });
    const send = vi.fn();
    const m = msg("https://big.com");
    await handleScrapeBatch({ messages: [m] } as any, envWith([], send));
    expect(m.ack).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ url: "https://big.com", attempts: 1 });
  });

  it("acks without re-enqueue when the page finished", async () => {
    runScrape.mockResolvedValue({ stoppedEarly: false, urlsProcessed: 1 });
    const send = vi.fn();
    const m = msg("https://done.com");
    await handleScrapeBatch({ messages: [m] } as any, envWith([], send));
    expect(m.ack).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("stops re-enqueueing after the hop cap", async () => {
    runScrape.mockResolvedValue({ stoppedEarly: true, urlsProcessed: 0 });
    const send = vi.fn();
    const m = msg("https://loop.com", 25);
    await handleScrapeBatch({ messages: [m] } as any, envWith([], send));
    expect(send).not.toHaveBeenCalled();
  });
});
