import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
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
