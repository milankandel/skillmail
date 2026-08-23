import type { SkillField } from '@/db/schema'
import { completeStructured } from './llm'

export type ExtractionResult = {
  status: 'ok' | 'skipped'
  data: Record<string, unknown> | null
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
  replyDraft: string | null
  model: string
  inputTokens: number
  outputTokens: number
}

type JsonProp = { type: string; description: string; items?: { type: string } }

/** The operator's field list becomes the tool schema the model must fill. */
function toolSchema(fields: SkillField[], wantsReply: boolean) {
  const properties: Record<string, JsonProp> = {}
  for (const f of fields) {
    const requiredNote = f.required ? ' This field is required whenever the record is present.' : ''
    properties[f.key] =
      f.type === 'string[]'
        ? { type: 'array', description: f.description + requiredNote, items: { type: 'string' } }
        : f.type === 'date'
          ? { type: 'string', description: `${f.description} Format as YYYY-MM-DD.${requiredNote}` }
          : { type: f.type, description: f.description + requiredNote }
  }

  return {
    type: 'object' as const,
    properties: {
      present: {
        type: 'boolean',
        description:
          'False when this email is not an instance of the record being extracted. Set it honestly; a wrong record is worse than no record.',
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How certain the extraction is.' },
      reasoning: { type: 'string', description: 'One sentence on what in the email supports this.' },
      ...properties,
      ...(wantsReply
        ? {
            replyDraft: {
              type: 'string',
              description:
                'A reply to this email written in the persona described above. Plain text, no subject line, no signature block. Omit when present is false.',
            },
          }
        : {}),
    },
    // Only the judgement fields are schema-required. Making record fields
    // required breaks the present:false path on strict providers — the model
    // is asked to fill fields for a record it just said is not there.
    required: ['present', 'confidence', 'reasoning'],
  }
}

function systemPrompt(persona: string): string {
  return [
    persona.trim(),
    '',
    'You are reading one inbound email and turning it into a single structured record for a CRM.',
    'Use only what the email states. Never invent an identifier, amount, or date that is not present —',
    'leave an optional field out rather than guessing. If the email is not the kind of record described,',
    'set present to false and stop. Your persona governs judgement and tone, never whether a fact is there.',
  ].join('\n')
}

export async function extract(input: {
  persona: string
  instruction: string
  fields: SkillField[]
  draftReply: boolean
  replyInstruction?: string | null
  message: { fromAddress: string; fromName: string | null; subject: string; body: string; receivedAt: Date }
}): Promise<ExtractionResult> {
  const description =
    input.draftReply && input.replyInstruction
      ? `${input.instruction}\n\nWhen drafting the reply: ${input.replyInstruction}`
      : input.instruction

  const result = await completeStructured({
    system: systemPrompt(input.persona),
    user: [
      `From: ${input.message.fromName ? `${input.message.fromName} <${input.message.fromAddress}>` : input.message.fromAddress}`,
      `Subject: ${input.message.subject}`,
      `Received: ${input.message.receivedAt.toISOString()}`,
      '',
      input.message.body.slice(0, 16_000),
    ].join('\n'),
    toolName: 'record',
    toolDescription: description,
    schema: toolSchema(input.fields, input.draftReply),
  })

  const { present, confidence, reasoning, replyDraft, ...data } = result.output as {
    present: boolean
    confidence: 'high' | 'medium' | 'low'
    reasoning: string
    replyDraft?: string
  } & Record<string, unknown>

  return {
    status: present ? 'ok' : 'skipped',
    data: present ? data : null,
    confidence: confidence ?? 'low',
    reasoning: reasoning ?? '',
    replyDraft: present && replyDraft ? replyDraft : null,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  }
}
