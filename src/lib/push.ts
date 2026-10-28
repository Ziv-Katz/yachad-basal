import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { app, db } from "./firebase";

export type PushState = "unsupported" | "needs-install" | "default" | "granted" | "denied";

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export async function pushState(): Promise<PushState> {
  // iOS only allows web push from an app added to the home screen.
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!("Notification" in window) || !(await isSupported())) return "unsupported";
  return Notification.permission as PushState;
}

/** Ask for permission and register this device to receive the list's alerts. */
export async function enablePush(uid: string): Promise<PushState> {
  const state = await pushState();
  if (state === "unsupported" || state === "needs-install") return state;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm as PushState;
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  await setDoc(doc(db, "users", uid, "tokens", token), { createdAt: serverTimestamp(), ua: navigator.userAgent.slice(0, 200) });
  return "granted";
}

/** While the app is open, alerts arrive here instead of as a system notification. */
export async function onForegroundAlert(cb: (title: string, body: string) => void): Promise<() => void> {
  if (!(await isSupported())) return () => {};
  return onMessage(getMessaging(app), (m) => cb(m.data?.title ?? m.notification?.title ?? "", m.data?.body ?? m.notification?.body ?? ""));
}
