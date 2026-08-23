import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/AuthForm'
import { logIn } from '@/actions/auth'
import { currentUser } from '@/lib/session'

export default async function LoginPage() {
  if (await currentUser()) redirect('/dashboard')
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <AuthForm mode="login" action={logIn} />
    </main>
  )
}
