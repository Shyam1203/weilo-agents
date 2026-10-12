// The app's service worker: it shows a notification the daemon pushed (daemon/push.mjs: { title, body, agent, kind }) and
// opens that agent's chat when you tap it. Nothing is cached: the app needs the daemon anyway.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {}
  // One notification per agent: a newer one replaces the last.
  event.waitUntil(
    self.registration.showNotification(data.title || "Weilo Agents", {
      body: data.body || "",
      tag: data.agent || "weilo",
      renotify: true,
      icon: "/apple-touch-icon.png",
      data: { agent: data.agent },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const agent = event.notification.data?.agent ?? "";
  event.waitUntil(
    (async () => {
      const [open] = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (open) {
        open.postMessage({ type: "open-agent", agent });
        return open.focus();
      }
      return self.clients.openWindow(agent ? `/?agent=${encodeURIComponent(agent)}` : "/");
    })(),
  );
});
