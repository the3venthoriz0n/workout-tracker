import { useEffect, useRef, type PointerEvent } from 'react'

const HOLD_MS = 500
const MOVE_TOLERANCE_PX = 10

/**
 * Calls `onHold` when the pointer stays down for half a second without moving, so a scroll is never a
 * hold. Spread the result on the element. Touch and mouse alike (pointer events).
 */
export function useHold(onHold: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const latest = useRef(onHold)
  useEffect(() => {
    latest.current = onHold
  })
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])

  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return
      origin.current = { x: e.clientX, y: e.clientY }
      cancel()
      timer.current = setTimeout(() => {
        timer.current = null
        latest.current()
      }, HOLD_MS)
    },
    onPointerMove: (e: PointerEvent) => {
      if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > MOVE_TOLERANCE_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }
}
