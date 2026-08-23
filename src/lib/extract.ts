import Anthropic from '@anthropic-ai/sdk'
import type { ExtractorField } from '@/db/schema'

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

export type ExtractionResult = {
  status: 'ok' | 'skipped'
  data: Record<string, unknown> | null
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
  model: string
  inputTokens: number
  outputTokens: number
}

type JsonProp = { type: string; description: string; items?: { type: string } }

/** The operator's field list becomes the tool schema the model must fill. */
function toolSchema(fields: ExtractorField[]) {
  const properties: Record<string, JsonProp> = {}
  for (const f of fields) {
    properties[f.key] =
      f.type === 'string[]'
        ? { type: 'array', description: f.description, items: { type: 'string' } }
        : f.type === 'date'
          ? { type: 'string', description: `${f.description} Format as YYYY-MM-DD.` }
          : { type: f.type, description: f.description }
  }

  return {
    type: 'object' as const,
    properties: {
      present: {
        type: 'boolean',
        description: 'False when this email is not an instance of the record being extracted. Set it honestly; a wrong record is worse than no record.',
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How certain the extraction is.' },
      reasoning: { type: 'string', description: 'One sentence on what in the email supports this.' },
      ...properties,
    },
    required: ['present', 'confidence', 'reasoning', ...fields.filter((f) => f.required).map((f) => f.key)],
  }
}

export async function extract(input: {
  instruction: string
  fields: ExtractorField[]
  message: { fromAddress: string; fromName: string | null; subject: string; body: string; receivedAt: Date }
  apiKey?: string
}): Promise<ExtractionResult> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('No Anthropic API key configured')

  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system:
      'You extract one structured record from a single email for delivery into a CRM. ' +
      'Use only what the email states. Never invent an identifier, amount, or date that is not present — ' +
      'leave an optional field out rather than guessing. If the email is not the kind of record described, set present to false.',
    tools: [
      {
        name: 'record',
        description: input.instruction,
        input_schema: toolSchema(input.fields),
      },
    ],
    tool_choice: { type: 'tool', name: 'record' },
    messages: [
      {
        role: 'user',
        content: [
          `From: ${input.message.fromName ? `${input.message.fromName} <${input.message.fromAddress}>` : input.message.fromAddress}`,
          `Subject: ${input.message.subject}`,
          `Received: ${input.message.receivedAt.toISOString()}`,
          '',
          input.message.body.slice(0, 16_000),
        ].join('\n'),
      },
    ],
  })

  const block = response.content.find((c) => c.type === 'tool_use')
  if (!block || block.type !== 'tool_use') {
    throw new Error('model returned no structured record')
  }

  const { present, confidence, reasoning, ...data } = block.input as {
    present: boolean
    confidence: 'high' | 'medium' | 'low'
    reasoning: string
  } & Record<string, unknown>

  return {
    status: present ? 'ok' : 'skipped',
    data: present ? data : null,
    confidence: confidence ?? 'low',
    reasoning: reasoning ?? '',
    model: MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  }
}
