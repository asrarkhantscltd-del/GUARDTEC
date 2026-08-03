import { createContext, useContext, useState } from "react"

type ThemeCtx = { isDark: boolean; toggleTheme: () => void }

const ThemeContext = createContext<ThemeCtx>({ isDark: false, toggleTheme: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  )

  function toggleTheme() {
    const html = document.documentElement
    if (html.classList.contains("dark")) {
      html.classList.remove("dark")
      html.classList.add("light")
      localStorage.setItem("theme", "light")
      setIsDark(false)
    } else {
      html.classList.remove("light")
      html.classList.add("dark")
      localStorage.setItem("theme", "dark")
      setIsDark(true)
    }
  }

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
