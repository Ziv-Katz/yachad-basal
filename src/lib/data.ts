import { useEffect, useState } from "react";
import {
  addDoc, arrayRemove, collection, deleteDoc, deleteField, doc, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { aisleOf } from "./aisles";
import { db, functions } from "./firebase";
import type { Store } from "./geo";

export type Trip = { active: boolean; shopperId: string; startedAt: number; endedAt?: number; storeName?: string | null };
export type List = {
  id: string; name: string; ownerId: string; members: string[]; memberNames: Record<string, string>;
  inviteCode: string; stores?: Store[]; trip?: Trip;
};
export type Item = {
  id: string; name: string; qty: string; aisle: string; by: string; at: number;
  done: boolean; doneBy?: string | null; doneAt?: number | null;
};
export type ListEvent = {
  id: string; type: "added" | "at_store" | "summary"; by: string; at: number;
  items?: string[]; bought?: string[]; missing?: string[]; minutes?: number; storeName?: string | null;
};

const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : typeof v === "number" ? v : Date.now());

export function useLists(uid: string) {
  const [lists, setLists] = useState<List[] | null>(null);
  useEffect(() => onSnapshot(
    query(collection(db, "lists"), where("members", "array-contains", uid)),
    (s) => setLists(s.docs.map((d) => ({ id: d.id, memberNames: {}, ...d.data() }) as List)),
  ), [uid]);
  return lists;
}

export function useItems(listId: string) {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => onSnapshot(collection(db, "lists", listId, "items"), (s) =>
    setItems(s.docs.map((d) => {
      const x = d.data();
      return { id: d.id, qty: "", aisle: aisleOf(String(x.name)), ...x, at: ms(x.at), doneAt: x.doneAt ? ms(x.doneAt) : null } as Item;
    }))), [listId]);
  return items;
}

export function useEvents(listId: string) {
  const [events, setEvents] = useState<ListEvent[]>([]);
  useEffect(() => onSnapshot(
    query(collection(db, "lists", listId, "events"), orderBy("at", "desc"), limit(40)),
    (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...d.data(), at: ms(d.data().at) }) as ListEvent)),
  ), [listId]);
  return events;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");

export async function createList(uid: string, name: string, myName: string) {
  const ref = await addDoc(collection(db, "lists"), {
    name, ownerId: uid, members: [uid], memberNames: { [uid]: myName }, inviteCode: newCode(), stores: [],
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function joinList(code: string, name: string) {
  const res = await httpsCallable<{ code: string; name: string }, { listId: string }>(functions, "joinList")({ code, name });
  return res.data.listId;
}

export async function leaveList(list: List, uid: string) {
  await updateDoc(doc(db, "lists", list.id), { members: arrayRemove(uid), [`memberNames.${uid}`]: deleteField() });
}

export const addItem = (listId: string, uid: string, name: string, qty: string) =>
  addDoc(collection(db, "lists", listId, "items"), { name, qty, aisle: aisleOf(name), by: uid, at: serverTimestamp(), done: false });

export const toggleItem = (listId: string, item: Item, uid: string) =>
  updateDoc(doc(db, "lists", listId, "items", item.id), item.done
    ? { done: false, doneBy: null, doneAt: null }
    : { done: true, doneBy: uid, doneAt: serverTimestamp() });

export const removeItem = (listId: string, id: string) => deleteDoc(doc(db, "lists", listId, "items", id));

export async function clearDone(listId: string, items: Item[]) {
  const b = writeBatch(db);
  items.filter((i) => i.done).forEach((i) => b.delete(doc(db, "lists", listId, "items", i.id)));
  await b.commit();
}

export async function startTrip(listId: string, uid: string, storeName: string | null = null) {
  const now = Date.now();
  await updateDoc(doc(db, "lists", listId), { trip: { active: true, shopperId: uid, startedAt: now, storeName } });
  await addDoc(collection(db, "lists", listId, "events"), { type: "at_store", by: uid, at: serverTimestamp(), storeName });
}

export async function endTrip(list: List, items: Item[], uid: string) {
  const trip = list.trip;
  if (!trip) return { bought: 0, missing: 0 };
  const bought = items.filter((i) => i.done && i.doneBy === uid && (i.doneAt ?? 0) >= trip.startedAt).map((i) => i.name);
  const missing = items.filter((i) => !i.done).map((i) => i.name);
  const minutes = Math.max(1, Math.round((Date.now() - trip.startedAt) / 60000));
  await addDoc(collection(db, "lists", list.id, "events"), { type: "summary", by: uid, at: serverTimestamp(), bought, missing, minutes });
  await updateDoc(doc(db, "lists", list.id), { trip: { ...trip, active: false, endedAt: Date.now() } });
  return { bought: bought.length, missing: missing.length };
}

export const saveStores = (listId: string, stores: Store[]) => updateDoc(doc(db, "lists", listId), { stores });

export const saveProfile = (uid: string, name: string) => setDoc(doc(db, "users", uid), { name }, { merge: true });
