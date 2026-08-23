import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SkillMail — turn inbound email into CRM records',
  description:
    'Connect a mailbox, describe the record you want in plain English, and SkillMail extracts it with Claude and POSTs a signed webhook to your CRM.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
