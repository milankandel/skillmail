'use client'

import { useState } from 'react'

export function SecretReveal({ secret }: { secret: string }) {
  const [shown, setShown] = useState(false)
  return (
    <button
      type="button"
      onClick={() => setShown((s) => !s)}
      title={shown ? 'Hide signing secret' : 'Reveal signing secret'}
      className="font-mono text-[11px] text-gray-500 transition hover:text-brand"
    >
      {shown ? secret : `${secret.slice(0, 10)}${'•'.repeat(14)}`}
    </button>
  )
}
