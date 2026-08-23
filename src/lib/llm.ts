import Anthropic from '@anthropic-ai/sdk'

/**
 * One structured-output call, many providers. The product's only LLM need is
 * "fill this JSON Schema from this text", which every provider exposes as tool
 * calling — so the demo can run on a free-tier key (Groq, Gemini, OpenRouter)
 * and a paid deployment can point the same code at Anthropic.
 */

export type LlmResult = {
  output: Record<string, unknown>
  model: string
  inputTokens: number
  outputTokens: number
}

type Provider = {
  name: string
  baseUrl: string
  keyEnv: string
  defaultModel: string
}

const OPENAI_COMPATIBLE: Provider[] = [
  { name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', defaultModel: 'openai/gpt-oss-120b' },
  {
    name: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-flash',
  },
  { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free' },
]

export function activeProvider(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  const forced = process.env.LLM_PROVIDER
  if (forced) return OPENAI_COMPATIBLE.some((p) => p.name === forced && process.env[p.keyEnv]) ? forced : null
  return OPENAI_COMPATIBLE.find((p) => process.env[p.keyEnv])?.name ?? null
}

export function isLlmConfigured(): boolean {
  return activeProvider() !== null
}

async function callAnthropic(input: {
  system: string
  user: string
  toolName: string
  toolDescription: string
  schema: Record<string, unknown>
}): Promise<LlmResult> {
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: input.system,
    tools: [{ name: input.toolName, description: input.toolDescription, input_schema: input.schema as Anthropic.Tool['input_schema'] }],
    tool_choice: { type: 'tool', name: input.toolName },
    messages: [{ role: 'user', content: input.user }],
  })

  const block = response.content.find((c) => c.type === 'tool_use')
  if (!block || block.type !== 'tool_use') throw new Error('model returned no structured output')

  return {
    output: block.input as Record<string, unknown>,
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  }
}

async function callOpenAiCompatible(
  provider: Provider,
  input: { system: string; user: string; toolName: string; toolDescription: string; schema: Record<string, unknown> },
): Promise<LlmResult> {
  const model = process.env.LLM_MODEL ?? provider.defaultModel

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env[provider.keyEnv]}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      tools: [
        {
          type: 'function',
          function: { name: input.toolName, description: input.toolDescription, parameters: input.schema },
        },
      ],
      tool_choice: { type: 'function', function: { name: input.toolName } },
    }),
  })

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 600)

    // Groq enforces tool choice strictly: when the model emits its JSON as
    // text instead of a tool call, the API 400s but includes the generation.
    // The JSON is usually valid — recover it rather than failing the message.
    if (res.status === 400 && detail.includes('tool_use_failed')) {
      try {
        const parsed = JSON.parse(detail) as { error?: { failed_generation?: string } }
        const recovered = parsed.error?.failed_generation
        if (recovered) {
          return { output: JSON.parse(recovered) as Record<string, unknown>, model: `${provider.name}/${model}`, inputTokens: 0, outputTokens: 0 }
        }
      } catch {
        // fall through to the normal error
      }
    }

    const err = new Error(`${provider.name} request failed (${res.status}): ${detail.slice(0, 300)}`) as Error & {
      status?: number
      retryAfterMs?: number
    }
    err.status = res.status
    const wait = detail.match(/try again in ([\d.]+)(m?s)/i)
    if (wait) err.retryAfterMs = Math.ceil(parseFloat(wait[1]) * (wait[2].toLowerCase() === 'ms' ? 1 : 1000))
    throw err
  }

  const json = (await res.json()) as {
    choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }

  const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
  if (!args) throw new Error(`${provider.name} returned no structured output`)

  let output: Record<string, unknown>
  try {
    output = JSON.parse(args) as Record<string, unknown>
  } catch {
    throw new Error(`${provider.name} returned unparseable tool arguments`)
  }

  return {
    output,
    model: `${provider.name}/${model}`,
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  }
}

export async function completeStructured(input: {
  system: string
  user: string
  toolName: string
  toolDescription: string
  schema: Record<string, unknown>
}): Promise<LlmResult> {
  const active = activeProvider()
  if (!active) {
    throw new Error('No LLM key configured. Set ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY.')
  }
  if (active === 'anthropic') return callAnthropic(input)

  const provider = OPENAI_COMPATIBLE.find((p) => p.name === active)!

  // Free tiers rate-limit by tokens-per-minute; a burst of messages in one
  // sync trips it constantly. Honour the server's suggested wait, capped so a
  // sync cannot hang, and give up after a few rounds.
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await callOpenAiCompatible(provider, input)
    } catch (e) {
      const err = e as Error & { status?: number; retryAfterMs?: number }
      if (err.status !== 429) throw e
      lastError = e
      const wait = Math.min(err.retryAfterMs ?? 2000 * (attempt + 1), 15_000)
      await new Promise((r) => setTimeout(r, wait + 250))
    }
  }
  throw lastError
}
