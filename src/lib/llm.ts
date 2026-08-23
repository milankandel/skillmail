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
  { name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile' },
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
    const detail = (await res.text()).slice(0, 300)
    throw new Error(`${provider.name} request failed (${res.status}): ${detail}`)
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
  return callOpenAiCompatible(provider, input)
}
