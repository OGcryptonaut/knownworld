import { redirect } from 'next/navigation';

// account creation happens ON the landing (the card switches in place)
export default function SignupPage() {
  redirect('/login?mode=signup');
}
