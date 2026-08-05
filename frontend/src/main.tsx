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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
