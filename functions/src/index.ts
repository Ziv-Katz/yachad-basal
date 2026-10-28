import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { formatAlert, ListEvent, shouldFlush } from "./alerts";

// Must match the Firestore database location chosen in the Firebase console.
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

initializeApp();
const db = getFirestore();

const APP_URL = process.env.APP_URL || `https://${process.env.GCLOUD_PROJECT}.web.app`;

type List = {
  name: string;
  members: string[];
  memberNames?: Record<string, string>;
  trip?: { active: boolean; shopperId: string; startedAt: number; storeName?: string | null };
};

const batchRef = (listId: string, by: string) => db.doc(`pendingBatches/${listId}__${by}`);

/**
 * New item: hold it in a per-person batch so the family gets one alert for a burst of additions.
 * If someone else is in the store right now, skip the wait and alert immediately.
 */
export const onItemCreated = onDocumentCreated("lists/{listId}/items/{itemId}", async (event) => {
  const item = event.data?.data();
  if (!item || typeof item.name !== "string" || typeof item.by !== "string") return;
  const { listId } = event.params;
  const label = item.qty ? `${item.name} (${item.qty})` : item.name;
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const listSnap = await tx.get(db.doc(`lists/${listId}`));
    const list = listSnap.data() as List | undefined;
    if (!list) return;
    const ref = batchRef(listId, item.by);
    const pending = await tx.get(ref);
    const items: string[] = [...((pending.data()?.items as string[]) ?? []), label];

    const someoneShopping = list.trip?.active && list.trip.shopperId !== item.by;
    if (someoneShopping) {
      if (pending.exists) tx.delete(ref);
      tx.create(db.collection(`lists/${listId}/events`).doc(), {
        type: "added", by: item.by, items, at: Timestamp.now(), urgent: true,
      });
      return;
    }
    tx.set(ref, {
      listId, by: item.by, items,
      firstAt: pending.data()?.firstAt ?? now,
      lastAt: now,
    });
  });
});

/** Every minute, turn batches that have gone quiet into a single "added" event. */
export const flushBatches = onSchedule("every 1 minutes", async () => {
  const snap = await db.collection("pendingBatches").get();
  const now = Date.now();
  for (const doc of snap.docs) {
    const b = doc.data();
    if (!shouldFlush({ items: b.items, firstAt: b.firstAt, lastAt: b.lastAt }, now)) continue;
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const d = fresh.data();
      if (!d || !shouldFlush({ items: d.items, firstAt: d.firstAt, lastAt: d.lastAt }, Date.now())) return;
      tx.delete(doc.ref);
      tx.create(db.collection(`lists/${d.listId}/events`).doc(), {
        type: "added", by: d.by, items: d.items, at: Timestamp.now(),
      });
    });
  }
});

/** Every event in a list (grouped additions, arrival at the store, trip summary) becomes a push to everyone else. */
export const onEventCreated = onDocumentCreated("lists/{listId}/events/{eventId}", async (event) => {
  const e = event.data?.data() as (ListEvent & { at?: unknown }) | undefined;
  if (!e || !e.type || !e.by) return;
  const { listId } = event.params;
  const list = (await db.doc(`lists/${listId}`).get()).data() as List | undefined;
  if (!list) return;

  const recipients = list.members.filter((m) => m !== e.by);
  if (!recipients.length) return;
  const { title, body } = formatAlert(e, list.memberNames?.[e.by] ?? "", list.name);

  const tokenDocs = (await Promise.all(recipients.map((uid) => db.collection(`users/${uid}/tokens`).get())))
    .flatMap((s) => s.docs);
  if (!tokenDocs.length) return;

  const res = await getMessaging().sendEachForMulticast({
    tokens: tokenDocs.map((d) => d.id),
    data: { listId, type: e.type, title, body },
    webpush: {
      notification: {
        title, body, dir: "rtl", lang: "he", icon: "/icon.svg", badge: "/icon.svg",
        // Arrival and summary replace the previous one of the same kind instead of stacking.
        tag: e.type === "added" ? undefined : `${listId}-${e.type}`,
        renotify: e.type !== "added",
      },
      fcmOptions: { link: `${APP_URL}/?list=${listId}` },
    },
  });

  const stale = res.responses
    .map((r, i) => (!r.success && ["messaging/registration-token-not-registered", "messaging/invalid-argument"]
      .includes(r.error?.code ?? "") ? tokenDocs[i].ref : null))
    .filter((r): r is FirebaseFirestore.DocumentReference => r !== null);
  await Promise.all(stale.map((r) => r.delete()));
  logger.info("push sent", { listId, type: e.type, ok: res.successCount, failed: res.failureCount, removed: stale.length });
});

/** Join a list with its invite code. Only the server may add members. */
export const joinList = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "צריך להתחבר קודם");
  const code = String(req.data?.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new HttpsError("invalid-argument", "קוד ההזמנה צריך להיות 6 תווים");

  const found = await db.collection("lists").where("inviteCode", "==", code).limit(1).get();
  if (found.empty) throw new HttpsError("not-found", "לא מצאתי רשימה עם הקוד הזה");
  const ref = found.docs[0].ref;
  const name = String(req.data?.name || req.auth?.token.name || "").slice(0, 40);
  await ref.update({ members: FieldValue.arrayUnion(uid), [`memberNames.${uid}`]: name });
  return { listId: ref.id };
});
