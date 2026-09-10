self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(self.registration.showNotification(data.title || "Nightingale", {
    body: data.body || "A secure update is available.",
    icon: "/favicon.ico",
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const target = new URL(path, self.location.origin);
    if (target.origin !== self.location.origin) return;
    await clients.openWindow(target.toString());
  })());
});
