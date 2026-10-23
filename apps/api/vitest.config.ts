import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The dev compose service exports NODE_ENV=development and vitest only defaults NODE_ENV when
  // it is unset; pin it so tests always run with the strict test origin policy.
  test: { env: { NODE_ENV: 'test' } },
})
