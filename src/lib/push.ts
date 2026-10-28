import { sb } from "./supabase";

export type PushState = "unsupported" | "needs-install" | "default" | "granted" | "denied";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export async function pushState(): Promise<PushState> {
  // iOS only allows web push from an app added to the home screen.
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) return "unsupported";
  return Notification.permission as PushState;
}

function urlBase64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Ask for permission and register this device for the list's alerts (standard Web Push, no third-party service). */
export async function enablePush(): Promise<PushState> {
  const state = await pushState();
  if (state === "unsupported" || state === "needs-install") return state;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm as PushState;
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) });
  const json = sub.toJSON();
  const { error } = await sb.from("push_subscriptions").upsert({
    endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, user_agent: navigator.userAgent.slice(0, 200),
  });
  if (error) throw new Error(error.message);
  return "granted";
}

/** Keep the server's copy current if the browser rotated the subscription while the app was closed. */
export async function refreshPushSubscription() {
  if ((await pushState()) === "granted") await enablePush().catch(() => {});
}
