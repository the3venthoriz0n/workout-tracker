// Follow the OS colour scheme; shadcn's dark variant keys off the `dark` class on <html>.
// Returns a cleanup function that stops following.
export function followSystemTheme(): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => document.documentElement.classList.toggle('dark', query.matches)
  apply()
  query.addEventListener('change', apply)
  return () => query.removeEventListener('change', apply)
}
