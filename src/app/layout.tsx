import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MailHook — turn inbound email into CRM records',
  description:
    'Connect a mailbox, describe the record you want in plain English, and MailHook extracts it with Claude and POSTs a signed webhook to your CRM.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
