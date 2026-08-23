import type { ParsedMessage } from './gmail'

const days = (n: number) => new Date(Date.now() - n * 86_400_000)

/**
 * A stand-in inbox so a new account can watch the whole pipeline run before
 * deciding whether to hand over access to a real mailbox.
 */
export const DEMO_MESSAGES: ParsedMessage[] = [
  {
    providerId: 'demo-1',
    fromAddress: 'procurement@northwindfreight.com',
    fromName: 'Dana Whitfield',
    subject: 'RFQ — 3 loads, Savannah to Atlanta, week of Sep 8',
    snippet: 'Hi Milan, we have three drayage loads out of Savannah…',
    receivedAt: days(1),
    body: `Hi Milan,

We have three drayage loads out of Savannah the week of September 8th and
would like a quote.

  Container MSCU7241883 — Savannah GPA to Atlanta 30336, 40HC, 38,400 lbs
  Container TGHU4410927 — Savannah GPA to Atlanta 30336, 40HC, 41,100 lbs
  Container CAIU9930012 — Savannah GPA to Marietta 30060, 20GP, 22,750 lbs

All three are live unload, two-hour free time. We need chassis provided.
Please include fuel surcharge in the all-in rate.

Budget is around $780 per load and we need an answer by Sep 3.

Thanks,
Dana Whitfield
Procurement Manager, Northwind Freight
dana.whitfield@northwindfreight.com | (912) 555-0148`,
  },
  {
    providerId: 'demo-2',
    fromAddress: 'ap@cascadelogistics.com',
    fromName: 'Cascade Logistics AP',
    subject: 'Invoice INV-10250 is past due',
    snippet: 'Our records show invoice INV-10250 for $8,730.25 remains unpaid…',
    receivedAt: days(2),
    body: `Good morning,

Our records show invoice INV-10250 for $8,730.25 remains unpaid. It was due
on 2026-08-01 and is now 22 days past terms.

Reference: PO 44-8871
Remit to: Cascade Logistics, account ending 4417

If payment has already been sent, please share the confirmation number.

Regards,
Accounts Payable
Cascade Logistics`,
  },
  {
    providerId: 'demo-3',
    fromAddress: 'newsletter@logisticsweekly.com',
    fromName: 'Logistics Weekly',
    subject: 'Port volumes climb 6% in July',
    snippet: 'This week: West Coast volumes, chassis shortages, and rate trends…',
    receivedAt: days(2),
    body: `This week in Logistics Weekly.

West Coast container volumes climbed six percent year over year in July.
Chassis availability remains the binding constraint in Savannah and Houston.

Unsubscribe at any time.`,
  },
  {
    providerId: 'demo-4',
    fromAddress: 'ops@harborline.co',
    fromName: 'Priya Raman',
    subject: 'New shipment request — 2 reefers, Long Beach',
    snippet: 'Need pickup Sept 12 from Long Beach for two reefer containers…',
    receivedAt: days(4),
    body: `Hello,

Need pickup on September 12 from Long Beach (Pier T) for two reefer
containers going to Riverside, CA 92507. Temperature setpoint is 34F and
both need genset.

  MSKU6612340 — 40RF
  MSKU6612377 — 40RF

Last free day is September 14 so we cannot slip. Our rate ceiling is $1,150
per container all-in.

Priya Raman
Operations, Harborline
priya@harborline.co`,
  },
  {
    providerId: 'demo-5',
    fromAddress: 'no-reply@calendar.google.com',
    fromName: 'Google Calendar',
    subject: 'Reminder: Standup at 9:00am',
    snippet: 'This is a reminder for your event tomorrow…',
    receivedAt: days(5),
    body: 'This is a reminder that Standup begins tomorrow at 9:00am in the main room.',
  },
]
