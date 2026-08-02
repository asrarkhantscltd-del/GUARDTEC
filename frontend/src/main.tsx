import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App"

// Apply saved theme before first render to avoid flash
;(function () {
  const saved = localStorage.getItem("theme")
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  if (saved === "dark" || (!saved && prefersDark)) {
    document.documentElement.classList.add("dark")
  }
})()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
