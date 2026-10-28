import { describe, expect, it } from "vitest";
import { formatAlert, listPreview, MAX_WAIT_MS, QUIET_MS, shouldFlush } from "./alerts";

describe("shouldFlush", () => {
  it("waits while additions keep coming", () => {
    expect(shouldFlush({ items: ["חלב"], firstAt: 0, lastAt: 1000 }, 1000 + QUIET_MS - 1)).toBe(false);
  });
  it("flushes after a quiet minute", () => {
    expect(shouldFlush({ items: ["חלב"], firstAt: 0, lastAt: 1000 }, 1000 + QUIET_MS)).toBe(true);
  });
  it("flushes a long-running batch even without a quiet gap", () => {
    expect(shouldFlush({ items: ["חלב"], firstAt: 0, lastAt: MAX_WAIT_MS - 10 }, MAX_WAIT_MS)).toBe(true);
  });
});

describe("formatAlert", () => {
  it("groups several additions into one alert", () => {
    const a = formatAlert({ type: "added", by: "u1", items: ["חלב", "ביצים", "לחם"] }, "דנה", "הבית");
    expect(a.title).toBe("דנה הוסיף/ה 3 פריטים להבית");
    expect(a.body).toBe("חלב, ביצים, לחם");
  });
  it("names the store on arrival when known", () => {
    expect(formatAlert({ type: "at_store", by: "u1", storeName: "שופרסל דיל" }, "דנה", "הבית").title).toBe("דנה בשופרסל דיל עכשיו");
  });
  it("summarises a trip with what is still missing", () => {
    const a = formatAlert({ type: "summary", by: "u1", bought: ["חלב", "לחם"], missing: ["שמיר"], minutes: 23 }, "", "הבית");
    expect(a.title).toBe("מישהו מהבית סיים/ה את הקנייה");
    expect(a.body).toBe("נקנו 2 · נשארו 1: שמיר · 23 דק׳");
  });
});

it("truncates long lists", () => {
  expect(listPreview(["א", "ב", "ג", "ד", "ה", "ו", "ז"])).toBe("א, ב, ג, ד, ה ועוד 2");
});
