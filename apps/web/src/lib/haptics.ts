// A light tap of feedback (e.g. when a set is marked done). Skipped where unsupported
// and when the user prefers reduced motion.
export function tapHaptic() {
  if (typeof navigator.vibrate !== 'function') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  try {
    navigator.vibrate(10)
  } catch {
    // ignore
  }
}
