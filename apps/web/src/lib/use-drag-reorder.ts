import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { tapHaptic } from '@/lib/haptics'

const HOLD_MS = 500
const MOVE_TOLERANCE_PX = 10

export type DragState = { from: number; to: number; dy: number }

/**
 * Hold a row for half a second to pick it up, drag it up or down, release to drop. Pointer events
 * only (no dependency), so it works for touch and mouse. The up/down buttons stay, so reordering is
 * never drag-only. `count` rows register through `rowRef(i)`; the handle's handlers go on whatever
 * element should start the hold. `onReorder(from, to)` is called once on drop when the row moved.
 */
export function useDragReorder(onReorder: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const rows = useRef<(HTMLElement | null)[]>([])
  const rects = useRef<{ top: number; height: number }[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef({ x: 0, y: 0 })
  const active = useRef(false)
  const justDragged = useRef(false)
  const onReorderRef = useRef(onReorder)
  useEffect(() => {
    onReorderRef.current = onReorder
  })

  // Once a row is picked up the page must not scroll under the finger. React's touch handlers are
  // passive, so this one is attached by hand and only while dragging.
  const blockScroll = useRef((e: TouchEvent) => e.preventDefault())
  const stopBlocking = useCallback(() => {
    document.removeEventListener('touchmove', blockScroll.current)
  }, [])

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(
    () => () => {
      clearTimer()
      stopBlocking()
    },
    [stopBlocking],
  )

  const rowRef = (i: number) => (el: HTMLElement | null) => {
    rows.current[i] = el
  }

  function nearest(y: number) {
    let best = 0
    let bestDist = Infinity
    rects.current.forEach((r, i) => {
      const dist = Math.abs(y - (r.top + r.height / 2))
      if (dist < bestDist) {
        best = i
        bestDist = dist
      }
    })
    return best
  }

  function end(commit: boolean, from: number, to: number) {
    clearTimer()
    stopBlocking()
    active.current = false
    setDrag(null)
    if (commit) {
      justDragged.current = true
      if (from !== to) onReorderRef.current(from, to)
    }
  }

  const handle = (i: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      start.current = { x: e.clientX, y: e.clientY }
      justDragged.current = false
      clearTimer()
      const el = e.currentTarget
      const pointerId = e.pointerId
      timer.current = setTimeout(() => {
        rects.current = rows.current.map((r) => {
          const b = r?.getBoundingClientRect()
          return { top: b?.top ?? 0, height: b?.height ?? 0 }
        })
        active.current = true
        try {
          el.setPointerCapture(pointerId)
        } catch {
          // Capture is a nicety; the move events still arrive without it on most devices
        }
        document.addEventListener('touchmove', blockScroll.current, { passive: false })
        tapHaptic()
        setDrag({ from: i, to: i, dy: 0 })
      }, HOLD_MS)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (!active.current) {
        if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > MOVE_TOLERANCE_PX) clearTimer()
        return
      }
      setDrag({ from: i, to: nearest(e.clientY), dy: e.clientY - start.current.y })
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      if (active.current) {
        const to = nearest(e.clientY)
        end(true, i, to)
      } else clearTimer()
    },
    onPointerCancel: () => {
      if (active.current) end(false, i, i)
      else clearTimer()
    },
    // The release after a drag must not also toggle the row open
    onClickCapture: (e: React.MouseEvent) => {
      if (justDragged.current) {
        justDragged.current = false
        e.stopPropagation()
        e.preventDefault()
      }
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  })

  return { drag, rowRef, handle }
}
