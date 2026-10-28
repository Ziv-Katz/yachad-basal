import { useCallback, useEffect, useRef, useState } from "react";
import { aisleOf } from "./aisles";
import type { Store } from "./geo";
import { sb } from "./supabase";

export type Trip = { active: boolean; shopperId: string; startedAt: number; endedAt?: number; storeName?: string | null };
export type List = {
  id: string; name: string; ownerId: string; inviteCode: string; stores: Store[]; trip: Trip | null;
  members: string[]; memberNames: Record<string, string>;
};
export type Item = {
  id: string; name: string; qty: string; aisle: string; by: string; at: number;
  done: boolean; doneBy: string | null; doneAt: number | null;
};
export type ListEvent = {
  id: string; type: "added" | "at_store" | "summary"; by: string; at: number;
  items?: string[]; bought?: string[]; missing?: string[]; minutes?: number; storeName?: string | null;
};

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ms = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0);

const toTrip = (t: Row | null): Trip | null => t && {
  active: !!t.active, shopperId: t.shopper_id, startedAt: Number(t.started_at) || 0,
  endedAt: t.ended_at ? Number(t.ended_at) : undefined, storeName: t.store_name ?? null,
};
const fromTrip = (t: Trip) => ({ active: t.active, shopper_id: t.shopperId, started_at: t.startedAt, ended_at: t.endedAt ?? null, store_name: t.storeName ?? null });

const toList = (r: Row): List => {
  const members: Row[] = r.list_members ?? [];
  return {
    id: r.id, name: r.name, ownerId: r.owner_id, inviteCode: r.invite_code, stores: r.stores ?? [], trip: toTrip(r.trip),
    members: members.map((m) => m.user_id),
    memberNames: Object.fromEntries(members.map((m) => [m.user_id, m.profiles?.name ?? ""])),
  };
};
const toItem = (r: Row): Item => ({
  id: r.id, name: r.name, qty: r.qty ?? "", aisle: r.aisle || aisleOf(r.name), by: r.created_by, at: ms(r.created_at),
  done: r.done, doneBy: r.done_by, doneAt: r.done_at ? ms(r.done_at) : null,
});
const toEvent = (r: Row): ListEvent => ({
  id: r.id, type: r.type, by: r.created_by, at: ms(r.created_at),
  items: r.payload?.items, bought: r.payload?.bought, missing: r.payload?.missing, minutes: r.payload?.minutes, storeName: r.payload?.store_name ?? null,
});

/**
 * Load rows and keep them fresh: refetch on any realtime change to the watched tables,
 * and whenever the app comes back to the foreground (covers a dropped realtime connection).
 */
function useLive<T>(key: string, load: () => Promise<T>, watch: { table: string; filter?: string }[]) {
  const [data, setData] = useState<T | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(() => { loadRef.current().then(setData).catch(() => {}); }, []);

  useEffect(() => {
    refresh();
    let ch = sb.channel(`live-${key}-${Math.random().toString(36).slice(2)}`);
    for (const w of watch) ch = ch.on("postgres_changes", { event: "*", schema: "yachad", table: w.table, ...(w.filter ? { filter: w.filter } : {}) }, refresh);
    // Make sure the socket carries the signed-in token before joining, or row-level security hides every change.
    sb.realtime.setAuth().finally(() => ch.subscribe());
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => { sb.removeChannel(ch); document.removeEventListener("visibilitychange", onVisible); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return [data, refresh] as const;
}

const must = <T,>(r: { data: T | null; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data as T; };

export function useLists(uid: string) {
  return useLive(`lists-${uid}`, async () =>
    must(await sb.from("lists").select("*, list_members(user_id, profiles(name))").order("created_at")).map(toList),
    [{ table: "lists" }, { table: "list_members" }],
  );
}

export function useItems(listId: string) {
  // Deletes are not filterable in realtime, so listen to all item changes and refetch this list.
  const [items] = useLive(`items-${listId}`, async () =>
    must(await sb.from("items").select("*").eq("list_id", listId)).map(toItem),
    [{ table: "items" }],
  );
  return items;
}

export function useEvents(listId: string) {
  const [events] = useLive(`events-${listId}`, async () =>
    must(await sb.from("events").select("*").eq("list_id", listId).order("created_at", { ascending: false }).limit(40)).map(toEvent),
    [{ table: "events", filter: `list_id=eq.${listId}` }],
  );
  return events ?? [];
}

export async function ensureProfile(name: string) { must(await sb.rpc("ensure_profile", { p_name: name })); }

export async function createList(uid: string, name: string) {
  return (must(await sb.from("lists").insert({ name, owner_id: uid }).select("id").single()) as { id: string }).id;
}

export async function joinList(code: string) {
  const r = await sb.rpc("join_list", { code });
  if (r.error) throw new Error(r.error.message.includes("not found") ? "not-found" : r.error.message);
  return r.data as string;
}

export async function leaveList(list: List, uid: string) {
  must(await sb.from("list_members").delete().eq("list_id", list.id).eq("user_id", uid));
}

export async function addItem(listId: string, uid: string, name: string, qty: string) {
  must(await sb.from("items").insert({ list_id: listId, name, qty, aisle: aisleOf(name), created_by: uid }));
}

export async function toggleItem(_listId: string, item: Item, uid: string) {
  must(await sb.from("items").update(item.done
    ? { done: false, done_by: null, done_at: null }
    : { done: true, done_by: uid, done_at: new Date().toISOString() }).eq("id", item.id));
}

export async function removeItem(_listId: string, id: string) { must(await sb.from("items").delete().eq("id", id)); }

export async function clearDone(listId: string) { must(await sb.from("items").delete().eq("list_id", listId).eq("done", true)); }

export async function startTrip(listId: string, uid: string, storeName: string | null = null) {
  must(await sb.from("lists").update({ trip: fromTrip({ active: true, shopperId: uid, startedAt: Date.now(), storeName }) }).eq("id", listId));
  must(await sb.from("events").insert({ list_id: listId, type: "at_store", created_by: uid, payload: { store_name: storeName } }));
}

export async function endTrip(list: List, items: Item[], uid: string) {
  const trip = list.trip;
  if (!trip) return { bought: 0, missing: 0 };
  const bought = items.filter((i) => i.done && i.doneBy === uid && (i.doneAt ?? 0) >= trip.startedAt).map((i) => i.name);
  const missing = items.filter((i) => !i.done).map((i) => i.name);
  const minutes = Math.max(1, Math.round((Date.now() - trip.startedAt) / 60000));
  must(await sb.from("events").insert({ list_id: list.id, type: "summary", created_by: uid, payload: { bought, missing, minutes } }));
  must(await sb.from("lists").update({ trip: fromTrip({ ...trip, active: false, endedAt: Date.now() }) }).eq("id", list.id));
  return { bought: bought.length, missing: missing.length };
}

export async function saveStores(listId: string, stores: Store[]) { must(await sb.from("lists").update({ stores }).eq("id", listId)); }
