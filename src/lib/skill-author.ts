import Anthropic from '@anthropic-ai/sdk'
import type { SkillField } from '@/db/schema'

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

export type DraftedSkill = {
  name: string
  persona: string
  instruction: string
  fields: SkillField[]
  matchFrom: string | null
  matchSubject: string | null
  draftReply: boolean
  replyInstruction: string | null
  notes: string
}

const SPEC = {
  type: 'object' as const,
  properties: {
    name: { type: 'string', description: 'Short label for this skill, three or four words.' },
    persona: {
      type: 'string',
      description:
        'Two or three sentences in the second person telling the model who it is acting as while reading these emails — its role, the business it works in, and the judgement it is expected to apply. Not a tone instruction.',
    },
    instruction: {
      type: 'string',
      description:
        'What record to extract, and explicitly what does NOT count. The second half matters most: name the near-miss emails that should be skipped.',
    },
    fields: {
      type: 'array',
      description:
        'The record shape. Prefer six to twelve fields. Mark required only what every genuine instance of this record will always contain.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'camelCase identifier, letters and digits only.' },
          type: { type: 'string', enum: ['string', 'number', 'boolean', 'date', 'string[]'] },
          description: { type: 'string', description: 'What this field holds, written for the model that fills it.' },
          required: { type: 'boolean' },
        },
        required: ['key', 'type', 'description', 'required'],
      },
    },
    matchFrom: { type: 'string', description: 'Substring the sender address must contain, only when the operator implied one. Otherwise empty.' },
    matchSubject: { type: 'string', description: 'Substring the subject must contain, only when the operator implied one. Otherwise empty.' },
    draftReply: { type: 'boolean', description: 'True only if the operator asked for replies to be written.' },
    replyInstruction: { type: 'string', description: 'How the reply should be written, when draftReply is true. Otherwise empty.' },
    notes: {
      type: 'string',
      description:
        'One or two sentences to the operator: the judgement calls you made, and anything they should tighten before switching this on.',
    },
  },
  required: ['name', 'persona', 'instruction', 'fields', 'draftReply', 'notes'],
}

/**
 * Turns a sentence like "pull quote requests out of my inbox and tell me what
 * they want to pay" into a full skill spec the operator can edit. Authoring is
 * where most of the accuracy is won or lost, so this drafts rather than
 * decides — everything it returns lands in an editable form.
 */
export async function draftSkill(prompt: string, apiKey?: string): Promise<DraftedSkill> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('No Anthropic API key configured')

  const response = await new Anthropic({ apiKey: key }).messages.create({
    model: MODEL,
    max_tokens: 2000,
    system:
      'You design email extraction skills. The operator describes, in their own words, a job they want done ' +
      'against their inbox. You return a complete specification: the persona the model should adopt, what record ' +
      'to look for, and the exact fields to pull out.\n\n' +
      'Two things make a skill work. First, the instruction must say what does NOT count — the near-miss emails ' +
      'that would otherwise produce junk records. Second, every field description must be written for the model ' +
      'that fills it, not for a human reading a form. Infer the operator\'s industry from their wording and use ' +
      'its real vocabulary in the field descriptions.',
    tools: [{ name: 'skill', description: 'The drafted skill specification.', input_schema: SPEC }],
    tool_choice: { type: 'tool', name: 'skill' },
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content.find((c) => c.type === 'tool_use')
  if (!block || block.type !== 'tool_use') throw new Error('model returned no skill specification')

  const raw = block.input as Omit<DraftedSkill, 'matchFrom' | 'matchSubject' | 'replyInstruction'> & {
    matchFrom?: string
    matchSubject?: string
    replyInstruction?: string
  }

  return {
    name: raw.name,
    persona: raw.persona,
    instruction: raw.instruction,
    fields: raw.fields.filter((f) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(f.key)),
    matchFrom: raw.matchFrom?.trim() || null,
    matchSubject: raw.matchSubject?.trim() || null,
    draftReply: Boolean(raw.draftReply),
    replyInstruction: raw.replyInstruction?.trim() || null,
    notes: raw.notes,
  }
}
