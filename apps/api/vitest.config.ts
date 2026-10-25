import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The dev compose service exports NODE_ENV=development and vitest only defaults NODE_ENV when
  // it is unset; pin it so tests always run with the strict test origin policy.
  // Some tests loop over every route against a real database; CI runners are several times slower
  // than a dev machine, so the 5 s default timed out there.
  test: { env: { NODE_ENV: 'test' }, testTimeout: 30_000, hookTimeout: 30_000 },
})
