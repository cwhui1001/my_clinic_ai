"use client";

import { useEffect, useState } from "react";

export function PushNotificationControl({ patientSessionId, publicKey }: { patientSessionId: string; publicKey: string | null }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const available = Boolean(publicKey && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
    if (!available) {
      queueMicrotask(() => setSupported(false));
      return;
    }
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        setSupported(true);
        setSubscribed(Boolean(subscription));
      })
      .catch(() => setSupported(false));
  }, [publicKey]);

  async function subscribe() {
    if (!publicKey) return;
    setPending(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("permission_denied");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8Array(publicKey) });
      const response = await fetch("/api/patient/push-subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientSessionId, subscription: subscription.toJSON() }) });
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error("save_failed");
      }
      setSubscribed(true);
      setMessage("Device alerts are enabled. Delivery is attempted when the clinic records a response; it is not guaranteed by the browser.");
    } catch {
      setMessage("Device alerts were not enabled. Return to this secure conversation to check for responses.");
    } finally {
      setPending(false);
    }
  }

  async function unsubscribe() {
    setPending(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/patient/push-subscriptions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientSessionId, endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setMessage("Device alerts are off. Return to this secure conversation to check for responses.");
    } finally {
      setPending(false);
    }
  }

  if (supported === false) return <p className="mt-4 text-xs text-slate-500">Device alerts are unavailable in this browser or deployment. Return to this secure conversation to check for clinic responses.</p>;
  if (supported === null) return null;
  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">Optional device alerts</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">Alerts contain no clinical details and open this conversation only after authentication.</p>
      <button className="mt-3 rounded-lg border border-teal-700 px-3 py-2 text-xs font-bold text-teal-800" type="button" disabled={pending} onClick={subscribed ? unsubscribe : subscribe}>{pending ? "Please wait..." : subscribed ? "Turn off device alerts" : "Enable device alerts"}</button>
      {message ? <p className="mt-2 text-xs leading-5 text-slate-600" role="status">{message}</p> : null}
    </div>
  );
}

function toUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
