import { z } from 'zod'

const isTest = process.env.NODE_ENV === 'test'

const schema = z.object({
  // Required, no default: a missing NODE_ENV must stop the process, never silently pick the
  // permissive development origin policy.
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  // Better Auth. Required in production and development; tests fall back to dummy values.
  BETTER_AUTH_SECRET: isTest
    ? z.string().min(32).default('test-secret-test-secret-test-secret-0000')
    : z.string().min(32),
  BETTER_AUTH_URL: isTest ? z.url().default('http://localhost:3000') : z.url(),
  // Extra allowed origins, comma separated.
  TRUSTED_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url())),
  // Directory of the built SPA; set only in the production image.
  STATIC_DIR: z.string().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  // Print which variables are wrong, never their values.
  console.error('Invalid environment:', z.flattenError(parsed.error).fieldErrors)
  process.exit(1)
}

export const env = parsed.data

export type Env = typeof env
