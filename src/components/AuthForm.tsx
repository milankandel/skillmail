'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import type { FormState } from '@/actions/auth'

type Props = {
  mode: 'login' | 'signup'
  action: (prev: FormState, data: FormData) => Promise<FormState>
}

export function AuthForm({ mode, action }: Props) {
  const [state, submit, pending] = useActionState(action, {})
  const isSignup = mode === 'signup'

  return (
    <form action={submit} className="card w-full max-w-sm space-y-4 p-7">
      <div>
        <h1 className="text-lg font-semibold text-white">{isSignup ? 'Create your workspace' : 'Welcome back'}</h1>
        <p className="mt-1 text-sm text-gray-400">
          {isSignup ? 'A demo inbox and a worked extractor are set up for you.' : 'Sign in to your MailHook workspace.'}
        </p>
      </div>

      {isSignup && (
        <label className="block">
          <span className="mb-1.5 block text-xs text-gray-400">Name</span>
          <input name="name" autoComplete="name" className="input-base" placeholder="Milan Kandel" />
        </label>
      )}

      <label className="block">
        <span className="mb-1.5 block text-xs text-gray-400">Work email</span>
        <input name="email" type="email" required autoComplete="email" className="input-base" placeholder="you@company.com" />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs text-gray-400">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          className="input-base"
          placeholder="At least 8 characters"
        />
      </label>

      {state.error && (
        <p className="rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{state.error}</p>
      )}

      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? 'Working…' : isSignup ? 'Create workspace' : 'Sign in'}
      </button>

      <p className="text-center text-sm text-gray-500">
        {isSignup ? 'Already have an account? ' : 'Need an account? '}
        <Link href={isSignup ? '/login' : '/signup'} className="text-brand hover:underline">
          {isSignup ? 'Sign in' : 'Sign up'}
        </Link>
      </p>
    </form>
  )
}
