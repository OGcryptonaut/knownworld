'use client';

import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { ThemeToggle } from '@/components/ThemeProvider';

export default function SignupPage() {
  return (
    <div className="relative">
      <div className="absolute right-5 top-5 z-10">
        <ThemeToggle />
      </div>
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </div>
  );
}
