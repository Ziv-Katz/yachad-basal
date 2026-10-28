import { describe, expect, it } from "vitest";
import { formatAlert, fromRow, listPreview } from "./alerts.ts";

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

it("reads an events row", () => {
  expect(fromRow({ type: "added", created_by: "u1", payload: { items: ["חלב"], urgent: true } })).toEqual({ type: "added", by: "u1", items: ["חלב"] });
  expect(fromRow({ type: "at_store", created_by: "u1", payload: {} })).toEqual({ type: "at_store", by: "u1", storeName: null });
  expect(fromRow({ type: "other", created_by: "u1", payload: {} })).toBeNull();
});
