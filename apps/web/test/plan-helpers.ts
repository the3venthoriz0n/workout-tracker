import { fireEvent, screen } from '@testing-library/react'

/** Plan items are collapsed to a name and target; this finds the row and opens it if it is closed. */
export async function openItem(name: string): Promise<HTMLElement> {
  const row = await screen.findByRole('listitem', { name })
  const toggle = row.querySelector<HTMLButtonElement>(`button[aria-label="${name} details"]`)
  if (toggle && toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
  return row
}
