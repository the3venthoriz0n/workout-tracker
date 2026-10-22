export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export const formatWeight = (n: number): string => String(Number(n.toFixed(2)))

export const pluralize = (n: number, singular: string, plural = `${singular}s`): string =>
  `${n} ${n === 1 ? singular : plural}`
