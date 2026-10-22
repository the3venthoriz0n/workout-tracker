import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { NumberField } from '../src/components/number-field'

function setup(props: Partial<Parameters<typeof NumberField>[0]> = {}) {
  const onCommit = vi.fn()
  render(<NumberField label="Weight" value={60} onCommit={onCommit} kind="weight" {...props} />)
  return { onCommit, input: screen.getByLabelText('Weight') as HTMLInputElement }
}

test('commits a comma decimal on blur', async () => {
  const user = userEvent.setup()
  const { onCommit, input } = setup()
  await user.clear(input)
  await user.type(input, '62,5')
  await user.tab()
  expect(onCommit).toHaveBeenCalledWith(62.5)
})

test('invalid text reverts without committing', async () => {
  const user = userEvent.setup()
  const { onCommit, input } = setup()
  await user.clear(input)
  await user.type(input, 'abc')
  await user.tab()
  expect(onCommit).not.toHaveBeenCalled()
  expect(input.value).toBe('60')
})

test('empty commits null when allowed', async () => {
  const user = userEvent.setup()
  const { onCommit, input } = setup({ allowEmpty: true })
  await user.clear(input)
  await user.tab()
  expect(onCommit).toHaveBeenCalledWith(null)
})

test('empty reverts when not allowed', async () => {
  const user = userEvent.setup()
  const { onCommit, input } = setup()
  await user.clear(input)
  await user.tab()
  expect(onCommit).not.toHaveBeenCalled()
  expect(input.value).toBe('60')
})

test('trims whitespace around the number', async () => {
  const user = userEvent.setup()
  const { onCommit, input } = setup()
  await user.clear(input)
  await user.type(input, ' 62.5 ')
  await user.tab()
  expect(onCommit).toHaveBeenCalledWith(62.5)
})

test('Enter then blur commits exactly once', async () => {
  const user = userEvent.setup()
  const { onCommit, input } = setup()
  await user.clear(input)
  await user.type(input, '70{Enter}')
  await user.tab()
  expect(onCommit).toHaveBeenCalledTimes(1)
})

test('a rejected commit shows the previous value again', async () => {
  const user = userEvent.setup()
  const onCommit = vi.fn(() => false)
  render(<NumberField label="Weight" value={5} onCommit={onCommit} kind="weight" />)
  const input = screen.getByLabelText('Weight') as HTMLInputElement
  await user.clear(input)
  await user.type(input, '0')
  await user.tab()
  await waitFor(() => expect(input.value).toBe('5'))
})

test('external value changes do not clobber text while typing', async () => {
  const user = userEvent.setup()
  const onCommit = vi.fn()
  const { rerender } = render(
    <NumberField label="Weight" value={60} onCommit={onCommit} kind="weight" />,
  )
  const input = screen.getByLabelText('Weight') as HTMLInputElement
  await user.click(input)
  await user.clear(input)
  await user.type(input, '12')
  rerender(<NumberField label="Weight" value={80} onCommit={onCommit} kind="weight" />)
  expect(input.value).toBe('12')
  await user.tab()
  await waitFor(() => expect(input.value).toBe('80'))
})

test('Enter commits and reps use numeric inputmode', async () => {
  const user = userEvent.setup()
  const { onCommit, input } = setup({ kind: 'reps', value: 5 })
  expect(input.inputMode).toBe('numeric')
  await user.clear(input)
  await user.type(input, '8{Enter}')
  expect(onCommit).toHaveBeenCalledWith(8)
})

test('the post-commit re-sync does not clobber typing that has resumed', async () => {
  const user = userEvent.setup()
  const { input } = setup()
  await user.clear(input)
  await user.type(input, '70')
  await user.tab()
  await user.click(input)
  await user.type(input, '1')
  await new Promise((r) => setTimeout(r, 120))
  expect(input.value).toBe('701')
})
