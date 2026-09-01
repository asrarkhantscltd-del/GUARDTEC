// Web Push subscribe/unsubscribe — managers/directors only for now (see
// server.js's pushToManagers). Kept as one small module so DashboardLayout
// doesn't need to know the PushManager/base64 plumbing details.
import { api } from "./api"

// PushManager wants the VAPID key as a Uint8Array, but the server hands it
// back as the URL-safe base64 string web-push generates — this is the
// standard conversion (same one every Web Push tutorial uses).
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64Safe)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("Push notifications aren't supported on this browser.")

  const permission = await Notification.requestPermission()
  if (permission !== "granted") throw new Error("Notification permission was not granted.")

  const { key } = await api.get<{ ok: boolean; key: string | null }>("/api/push/vapid-public-key")
  if (!key) throw new Error("Push notifications aren't configured on the server yet.")

  const reg = await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  })

  await api.post("/api/push/subscribe", { subscription: subscription.toJSON() })
}

export async function disablePush(): Promise<void> {
  const sub = await getExistingSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await api.post("/api/push/unsubscribe", { endpoint })
}
