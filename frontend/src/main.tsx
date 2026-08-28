import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./lib/csrf"
import "./index.css"
import App from "./App"

// Apply saved theme before first render — default is light
;(function () {
  const saved = localStorage.getItem("theme")
  if (saved === "dark") document.documentElement.classList.add("dark")
})()

// A rebuild's new service worker (registerType: 'autoUpdate' + sw.ts's own
// skipWaiting/clientsClaim) takes control of an already-open tab silently —
// "taking control" isn't the same as the tab's already-loaded JS refreshing
// itself. Without this, a deploy only visibly lands the next time something
// else happens to force a real navigation (e.g. logging out), which read as
// "changes only show up after logging back in." Reloading once when control
// actually changes is the standard fix; the guard flag stops a reload loop
// if the browser ever fires the event more than once for the same page load.
if ("serviceWorker" in navigator) {
  let reloaded = false
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })

  // The browser only re-checks sw.js for changes on a real navigation —
  // a PWA left open (or resumed from the phone's app switcher instead of
  // relaunched) can sit on a stale bundle indefinitely otherwise, which is
  // exactly what made new pages 404/fail until a manual logout+login forced
  // a navigation. Polling registration.update() re-triggers that check on
  // a timer instead of waiting for one.
  navigator.serviceWorker.ready.then((reg) => {
    setInterval(() => reg.update(), 60_000)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update()
    })
  })
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
