import { describe, it, expect } from "vitest";
import { isFollowUpDue } from "../src/followups";

const DAY = 86_400_000;
const now = 1_000 * DAY; // arbitrary "now" in ms

describe("isFollowUpDue", () => {
  it("is false without a baseline date", () => {
    expect(isFollowUpDue(null, 0, now, 4, 2)).toBe(false);
  });
  it("is false before the cadence elapses", () => {
    const threeDaysAgo = new Date(now - 3 * DAY).toISOString();
    expect(isFollowUpDue(threeDaysAgo, 0, now, 4, 2)).toBe(false);
  });
  it("is true once the cadence has elapsed (first follow-up)", () => {
    const fiveDaysAgo = new Date(now - 5 * DAY).toISOString();
    expect(isFollowUpDue(fiveDaysAgo, 0, now, 4, 2)).toBe(true);
  });
  it("spaces later follow-ups further out (2x cadence for #2)", () => {
    const fiveDaysAgo = new Date(now - 5 * DAY).toISOString();
    expect(isFollowUpDue(fiveDaysAgo, 1, now, 4, 2)).toBe(false); // needs >= 8 days
    const nineDaysAgo = new Date(now - 9 * DAY).toISOString();
    expect(isFollowUpDue(nineDaysAgo, 1, now, 4, 2)).toBe(true);
  });
  it("stops after the max is reached", () => {
    const yearAgo = new Date(now - 365 * DAY).toISOString();
    expect(isFollowUpDue(yearAgo, 2, now, 4, 2)).toBe(false);
  });
});
