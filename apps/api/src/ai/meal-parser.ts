// Turns "1 chicken burrito, 1 yogurt" into estimated nutrition with whichever AI service is configured.
// Two small adapters, both plain `fetch` (no SDK): OpenAI-compatible chat completions (Groq,
// OpenRouter, Gemini's compatible endpoint, Ollama and many more) and Anthropic Messages.
//
// Providers differ in how strictly they follow a schema, so the contract is ours: the prompt asks for
// JSON listing only the tracked nutrients, and the answer is parsed and validated here. The meal
// text, the key and anything the provider says never reach an error, a log line or the client.
import { AiFailedError, AiLimitError, AiUnavailableError, NUTRIENTS, NUTRIENT_KEYS, mealDraftSchema } from '@workout/shared'
import type { MealDraft, NutrientKey } from '@workout/shared'

export interface MealParser {
  /** Estimates each food in `text`, for the `tracked` nutrients only (the rest come back null). */
  parse(text: string, tracked: NutrientKey[]): Promise<MealDraft[]>
}

type AiEnv = {
  AI_PROVIDER: 'openai' | 'anthropic'
  AI_BASE_URL?: string | undefined
  AI_API_KEY?: string | undefined
  AI_MODEL?: string | undefined
}

const TIMEOUT_MS = 30_000
const MAX_ITEMS = 20
const ANTHROPIC_BASE = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'

function systemPrompt(tracked: NutrientKey[]): string {
  const listed = NUTRIENTS.filter((n) => tracked.includes(n.key))
    .map((n) => `"${n.key}" (${n.unit === 'kcal' ? 'kilocalories' : n.unit === 'mg' ? 'milligrams' : 'grams'})`)
    .join(', ')
  const shape = ['"name": string', '"quantity": string', ...tracked.map((k) => `"${k}": number`)].join(', ')
  return [
    'You turn a description of food and drink someone consumed into estimated nutrition.',
    `Reply with JSON only, no other text, in exactly this shape: {"items":[{${shape}}]}.`,
    'Give one item per distinct food or drink. "quantity" is the amount as written or assumed (for example "1 burrito").',
    `Estimate these values for the amount described: ${listed}. Use plain numbers, never strings or units inside values.`,
    'If you are unsure, give your best estimate.',
    'If the text does not describe food or drink, reply {"items":[]}.',
  ].join('\n')
}

/** The JSON object in a model answer: tolerates a code fence or prose around it. */
function extractJson(raw: string): unknown {
  const unfenced = raw.replace(/```(?:json)?/gi, '')
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(unfenced.slice(start, end + 1))
  } catch {
    return undefined
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Validated drafts for the tracked nutrients, or undefined when the answer is unusable. Extra keys are dropped. */
function toDrafts(raw: unknown, tracked: NutrientKey[]): MealDraft[] | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.items) || raw.items.length > MAX_ITEMS) return undefined
  const out: MealDraft[] = []
  for (const item of raw.items) {
    if (!isRecord(item)) return undefined
    const candidate: Record<string, unknown> = { name: item.name, quantity: item.quantity ?? '' }
    // Untracked nutrients are never taken from the model, even when it volunteers them.
    for (const key of NUTRIENT_KEYS) candidate[key] = tracked.includes(key) ? item[key] : null
    const parsed = mealDraftSchema.safeParse(candidate)
    if (!parsed.success) return undefined
    out.push(parsed.data)
  }
  return out
}

/** The reply text of one request, or '' when the provider answered without usable text. */
type Complete = (system: string, text: string) => Promise<string>

async function send(fetchFn: typeof fetch, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new AiFailedError()
  }
  if (res.status === 429) throw new AiLimitError()
  if (res.status === 401 || res.status === 403) throw new AiUnavailableError()
  if (!res.ok) throw new AiFailedError()
  try {
    return await res.json()
  } catch {
    return undefined
  }
}

function openAiCompatible(fetchFn: typeof fetch, baseUrl: string, key: string, model: string): Complete {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  return async (system, text) => {
    const data = await send(fetchFn, url, { Authorization: `Bearer ${key}` }, {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
    })
    const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined
    const message = isRecord(choice) ? choice.message : undefined
    return isRecord(message) && typeof message.content === 'string' ? message.content : ''
  }
}

function anthropic(fetchFn: typeof fetch, baseUrl: string, key: string, model: string): Complete {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`
  return async (system, text) => {
    const data = await send(fetchFn, url, { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }, {
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: text }],
    })
    if (!isRecord(data) || data.stop_reason === 'refusal' || !Array.isArray(data.content)) return ''
    return data.content.map((b) => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('')
  }
}

/** The configured parser, or null when no key is set (the feature then reports itself unavailable). */
export function createMealParser(env: AiEnv, fetchFn: typeof fetch = fetch): MealParser | null {
  const key = env.AI_API_KEY
  const model = env.AI_MODEL
  if (!key || !model) return null
  const base = env.AI_PROVIDER === 'anthropic' ? (env.AI_BASE_URL ?? ANTHROPIC_BASE) : env.AI_BASE_URL
  if (!base) return null
  const complete = env.AI_PROVIDER === 'anthropic' ? anthropic(fetchFn, base, key, model) : openAiCompatible(fetchFn, base, key, model)
  return {
    async parse(text, tracked) {
      const system = systemPrompt(tracked)
      // One retry, only for an answer that cannot be used; a provider error is final.
      for (let attempt = 0; attempt < 2; attempt++) {
        const drafts = toDrafts(extractJson(await complete(system, text)), tracked)
        if (drafts) return drafts
      }
      throw new AiFailedError()
    },
  }
}
