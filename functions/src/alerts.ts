// Pure helpers for building alerts, kept free of Firebase so they can be unit tested.

export type ListEvent =
  | { type: "added"; by: string; items: string[] }
  | { type: "at_store"; by: string; storeName?: string | null }
  | { type: "summary"; by: string; bought: string[]; missing: string[]; minutes: number };

export type Batch = { items: string[]; firstAt: number; lastAt: number };

/** Quiet time after the last addition before we send the grouped alert. */
export const QUIET_MS = 60_000;
/** Never hold a batch longer than this, even if the person keeps adding. */
export const MAX_WAIT_MS = 5 * 60_000;

export function shouldFlush(batch: Batch, now: number): boolean {
  return now - batch.lastAt >= QUIET_MS || now - batch.firstAt >= MAX_WAIT_MS;
}

export function listPreview(items: string[], max = 5): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} ועוד ${items.length - max}`;
}

export function formatAlert(e: ListEvent, name: string, listName: string): { title: string; body: string } {
  const who = name || "מישהו מהבית";
  switch (e.type) {
    case "added": {
      const n = e.items.length;
      return {
        title: n === 1 ? `${who} הוסיף/ה ל${listName}` : `${who} הוסיף/ה ${n} פריטים ל${listName}`,
        body: listPreview(e.items),
      };
    }
    case "at_store":
      return {
        title: `${who} ${e.storeName ? `ב${e.storeName}` : "בסופר"} עכשיו`,
        body: "חסר משהו? זה הזמן להוסיף לרשימה.",
      };
    case "summary": {
      const parts = [`נקנו ${e.bought.length}`];
      if (e.missing.length) parts.push(`נשארו ${e.missing.length}: ${listPreview(e.missing, 3)}`);
      parts.push(`${e.minutes} דק׳`);
      return { title: `${who} סיים/ה את הקנייה`, body: parts.join(" · ") };
    }
  }
}
