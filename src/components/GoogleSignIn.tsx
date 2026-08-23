'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { firebaseConfig } from '@/lib/firebase-client'

async function exchange(idToken: string): Promise<void> {
  const res = await fetch('/api/auth/firebase', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `sign-in failed (${res.status})`)
  }
}

export function GoogleSignIn() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Completes the redirect-fallback flow when the browser lands back here.
  useEffect(() => {
    void (async () => {
      const { getApps, initializeApp } = await import('firebase/app')
      const { getAuth, getRedirectResult } = await import('firebase/auth')
      const app = getApps()[0] ?? initializeApp(firebaseConfig)
      const result = await getRedirectResult(getAuth(app)).catch(() => null)
      if (!result) return
      setBusy(true)
      try {
        await exchange(await result.user.getIdToken())
        router.push('/dashboard')
        router.refresh()
      } catch (e) {
        setError((e as Error).message)
        setBusy(false)
      }
    })()
  }, [router])

  const signIn = async () => {
    setBusy(true)
    setError(null)
    try {
      // Loaded on click, not on page load — Firebase never taxes first paint.
      const { initializeApp, getApps } = await import('firebase/app')
      const { GoogleAuthProvider, getAuth, signInWithPopup } = await import('firebase/auth')

      const app = getApps()[0] ?? initializeApp(firebaseConfig)
      const auth = getAuth(app)
      const provider = new GoogleAuthProvider()

      let credential
      try {
        credential = await signInWithPopup(auth, provider)
      } catch (popupError) {
        // Popup blockers (and some mobile browsers) kill the popup flow;
        // the full-page redirect works everywhere. Resumed below on return.
        if ((popupError as { code?: string }).code === 'auth/popup-blocked') {
          const { signInWithRedirect } = await import('firebase/auth')
          await signInWithRedirect(auth, provider)
          return
        }
        throw popupError
      }
      const idToken = await credential.user.getIdToken()

      await exchange(idToken)
      router.push('/dashboard')
      router.refresh()
    } catch (e) {
      const code = (e as { code?: string }).code
      setError(
        code === 'auth/popup-closed-by-user'
          ? null
          : code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found'
            ? 'Google sign-in is not enabled on this deployment yet.'
            : (e as Error).message,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button type="button" onClick={signIn} disabled={busy} className="btn btn-ghost w-full">
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.02.15 3.5 2.7.24.02c2.2-2 3.5-5 3.5-8.6" />
          <path fill="#34A853" d="M12 24c3.2 0 5.9-1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2a7.2 7.2 0 0 1-6.8-5l-.14.01-3.7 2.8-.05.13A12 12 0 0 0 12 24" />
          <path fill="#FBBC05" d="M5.2 14.4a7.4 7.4 0 0 1-.4-2.4c0-.8.2-1.6.4-2.4l-.01-.16-3.7-2.9-.12.06a12 12 0 0 0 0 10.8l3.83-3" />
          <path fill="#EB4335" d="M12 4.6c2.3 0 3.8 1 4.7 1.8l3.4-3.3C18 1.2 15.2 0 12 0A12 12 0 0 0 1.3 6.6l3.9 3A7.2 7.2 0 0 1 12 4.6" />
        </svg>
        {busy ? 'Signing in…' : 'Continue with Google'}
      </button>
      {error && <p className="mt-2 text-center text-xs text-rose-400">{error}</p>}
    </div>
  )
}
