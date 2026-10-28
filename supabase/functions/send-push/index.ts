// Sends a Web Push alert for one new event to every other member of the list.
// Called by the dispatch_push trigger (pg_net), authenticated with the shared x-push-secret header.
import { createClient } from "npm:@supabase/supabase-js@2.81.1";
import webpush from "npm:web-push@3.6.7";
import { formatAlert, fromRow } from "../_shared/alerts.ts";

const env = (k: string) => Deno.env.get(k) ?? "";

webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:admin@example.com", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { db: { schema: "yachad" }, auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (!env("PUSH_WEBHOOK_SECRET") || req.headers.get("x-push-secret") !== env("PUSH_WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const { event_id } = await req.json().catch(() => ({}));
  if (!event_id) return new Response("missing event_id", { status: 400 });

  const { data: row } = await db.from("events").select("id, list_id, type, created_by, payload").eq("id", event_id).single();
  const event = row && fromRow(row);
  if (!row || !event) return new Response("no such event", { status: 404 });

  const [{ data: list }, { data: members }] = await Promise.all([
    db.from("lists").select("name").eq("id", row.list_id).single(),
    db.from("list_members").select("user_id, profiles(name)").eq("list_id", row.list_id),
  ]);
  const others = (members ?? []).map((m) => m.user_id).filter((id) => id !== row.created_by);
  if (!list || !others.length) return Response.json({ sent: 0 });

  const author = (members ?? []).find((m) => m.user_id === row.created_by) as { profiles?: { name?: string } } | undefined;
  const { title, body } = formatAlert(event, author?.profiles?.name ?? "", list.name);
  const { data: subs } = await db.from("push_subscriptions").select("endpoint, p256dh, auth").in("user_id", others);

  const message = JSON.stringify({
    title, body,
    url: `/?list=${row.list_id}`,
    // Arrival and summary replace the previous alert of the same kind instead of stacking.
    tag: row.type === "added" ? undefined : `${row.list_id}-${row.type}`,
  });

  let sent = 0;
  const gone: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message, { TTL: 6 * 3600, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint); // the device unsubscribed or the app was removed
      else console.error("push failed", code, (e as Error).message);
    }
  }));
  if (gone.length) await db.from("push_subscriptions").delete().in("endpoint", gone);
  return Response.json({ sent, removed: gone.length });
});
