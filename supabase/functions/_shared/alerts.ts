// Wording of the push alerts. Pure, so it runs both in the Edge Function (Deno) and in unit tests (Node).

export type ListEvent =
  | { type: "added"; by: string; items: string[] }
  | { type: "at_store"; by: string; storeName?: string | null }
  | { type: "summary"; by: string; bought: string[]; missing: string[]; minutes: number };

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

/** Turn an events row into the shape formatAlert expects. */
export function fromRow(row: { type: string; created_by: string; payload: Record<string, unknown> }): ListEvent | null {
  const p = row.payload ?? {};
  const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  switch (row.type) {
    case "added": return { type: "added", by: row.created_by, items: strings(p.items) };
    case "at_store": return { type: "at_store", by: row.created_by, storeName: (p.store_name as string) ?? null };
    case "summary": return { type: "summary", by: row.created_by, bought: strings(p.bought), missing: strings(p.missing), minutes: Number(p.minutes) || 1 };
  }
  return null;
}
