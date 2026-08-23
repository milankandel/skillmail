import { db } from '@/db'
import { destinations, mailboxes, skills } from '@/db/schema'
import { newSecret } from './crypto'

/**
 * A fresh account gets a demo mailbox, one worked example of a skill, and a
 * paused destination, so the first sync produces something to look at without
 * the operator configuring anything first.
 */
export async function seedWorkspace(userId: string) {
  await db.insert(mailboxes).values({ userId, provider: 'demo', address: 'demo-inbox@skillmail.dev' })
  await db.insert(skills).values({
    userId,
    name: 'Inbound quote request',
    persona:
      'You are a dispatch coordinator at a drayage carrier. You read inbound mail the way someone who has to quote it does: ' +
      'you care about lane, equipment, timing, and whether the sender named a number. You are sceptical of anything that ' +
      'reads like marketing.',
    instruction:
      'Extract a freight quote request: who is asking, what they need moved, where from and to, and what they are willing ' +
      'to pay. A newsletter, an invoice, a status update, or an internal thread is not a quote request — skip those.',
    draftReply: false,
    authoredFrom: 'Pull freight quote requests out of my inbox and tell me what they want to pay.',
    fields: [
      { key: 'company', type: 'string', description: 'The requesting company name.', required: true },
      { key: 'contactName', type: 'string', description: 'Full name of the person asking.', required: false },
      { key: 'contactEmail', type: 'string', description: 'Reply-to email address.', required: true },
      { key: 'originCity', type: 'string', description: 'City or port the freight moves from.', required: true },
      { key: 'destinationCity', type: 'string', description: 'City the freight moves to.', required: true },
      { key: 'containerNumbers', type: 'string[]', description: 'Every container or equipment number listed.', required: false },
      { key: 'loadCount', type: 'number', description: 'How many loads or containers in total.', required: false },
      { key: 'targetRateUsd', type: 'number', description: 'Rate per load the sender named, in USD.', required: false },
      { key: 'respondBy', type: 'date', description: 'Date the sender needs an answer by.', required: false },
    ],
    active: true,
  })
  await db.insert(destinations).values({
    userId,
    name: 'Sandbox endpoint',
    url: 'https://webhook.site/replace-me',
    secret: newSecret(),
    active: false,
  })
}
