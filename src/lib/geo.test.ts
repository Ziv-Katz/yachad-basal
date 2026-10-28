import { describe, expect, it } from "vitest";
import { distanceM, nearestStore } from "./geo";

const store = { name: "שופרסל דיל", lat: 32.0853, lng: 34.7818 };

describe("geo", () => {
  it("measures short distances", () => {
    const d = distanceM(store, { lat: 32.0862, lng: 34.7818 }); // ~100m north
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(110);
  });
  it("detects arrival within the radius only", () => {
    expect(nearestStore({ lat: 32.0855, lng: 34.7819 }, [store])?.name).toBe("שופרסל דיל");
    expect(nearestStore({ lat: 32.095, lng: 34.7818 }, [store])).toBeNull();
  });
});
