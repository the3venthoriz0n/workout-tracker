// A bottom sheet on phones; from md up the same sheet docks to the right edge as a side panel.
// The md:data-[side=bottom] variants match the specificity of SheetContent's own bottom-side rules.
export const responsiveSheet =
  'max-h-[92dvh] overflow-hidden gap-0 md:data-[side=bottom]:inset-x-auto md:data-[side=bottom]:top-0 md:data-[side=bottom]:right-0 md:data-[side=bottom]:h-full md:data-[side=bottom]:max-h-none md:data-[side=bottom]:w-full md:data-[side=bottom]:max-w-md md:data-[side=bottom]:rounded-none md:data-[side=bottom]:rounded-l-sheet'

export const isDesktop = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(min-width: 768px)').matches
