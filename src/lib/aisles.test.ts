import { describe, expect, it } from "vitest";
import { aisleOf, OTHER } from "./aisles";

describe("aisleOf", () => {
  it.each([
    ["חלב 3%", "חלב וביצים"],
    ["עגבניות שרי", "פירות וירקות"],
    ["פיתות", "מאפייה"],
    ["חזה עוף", "בשר ודגים"],
    ["אבקת כביסה", "ניקיון ופארם"],
    ["משחת שיניים", "ניקיון ופארם"],
    ["שוקולד מריר", "מזווה"],
    ["שוקו", "חלב וביצים"],
  ])("%s → %s", (item, aisle) => expect(aisleOf(item)).toBe(aisle));
  it("falls back to other", () => expect(aisleOf("נרות שבת")).toBe(OTHER));
});
