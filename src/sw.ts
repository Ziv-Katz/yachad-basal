/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Alerts sent by the send-push Edge Function: { title, body, url, tag? }
self.addEventListener("push", (e) => {
  const d = (() => { try { return e.data?.json() ?? {}; } catch { return { body: e.data?.text() }; } })();
  e.waitUntil(self.registration.showNotification(d.title || "יחד בסל", {
    body: d.body || "", dir: "rtl", lang: "he", icon: "/icon-192.png", badge: "/badge-96.png",
    tag: d.tag, data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) { await open.focus(); return open.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
