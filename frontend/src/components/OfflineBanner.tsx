import { useEffect, useState } from "react"
import { WifiOff } from "lucide-react"

// Shown while the device has no connection. The service worker still serves
// the app shell (and recently-viewed data for a few minutes), so without this
// a phone on a lift/basement signal just looks broken.
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener("offline", goOffline)
    window.addEventListener("online", goOnline)
    return () => {
      window.removeEventListener("offline", goOffline)
      window.removeEventListener("online", goOnline)
    }
  }, [])

  if (!offline) return null
  return (
    <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>You're offline — changes can't be saved until you reconnect.</span>
    </div>
  )
}
