import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/AuthForm'
import { signUp } from '@/actions/auth'
import { currentUser } from '@/lib/session'

export default async function SignupPage() {
  if (await currentUser()) redirect('/dashboard')
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <AuthForm mode="signup" action={signUp} />
    </main>
  )
}
