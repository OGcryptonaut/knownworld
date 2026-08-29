import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';

export const metadata = { title: 'Sign in — Knownworld' };

export default function LoginPage() {
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
