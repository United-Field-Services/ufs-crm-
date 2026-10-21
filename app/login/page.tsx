import type { Metadata } from 'next';
import { standaloneConfigured } from '../../lib/standalone-auth';
import LoginForm from './login-form';
import './login.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Sign in | UFS People',
  description: 'Sign in to your United Field Services workspace.',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ reason?: string | string[] }>;
}) {
  const query = await searchParams;
  const allowedReasons = ['expired', 'access_denied', 'signed_out'];
  const reason = typeof query?.reason === 'string' && allowedReasons.includes(query.reason)
    ? query.reason
    : undefined;

  return (
    <main className="ufs-login">
      <div className="ufs-login-layout">
        <section className="ufs-login-welcome" aria-labelledby="ufs-welcome-title">
          <div className="ufs-login-brand" aria-label="UFS People, United Field Services">
            {/* eslint-disable-next-line @next/next/no-img-element -- static company logo; this host has no image optimizer */}
            <img className="ufs-login-logo" src="/ufs-logo.png" alt="United Field Services" /><strong>People</strong>
          </div>
          <div className="ufs-login-intro">
            <span className="ufs-login-eyebrow">YOUR PEOPLE WORKSPACE</span>
            <h1 id="ufs-welcome-title">A home for{' '}<br />your workday.</h1>
            <p>Your team, time off, and everyday essentials.<br className="ufs-login-desktop-break" /> Together in one place.</p>
            <div className="ufs-login-features" aria-label="Workspace features">
              <span>People &amp; teams</span><span>Time off</span><span>Documents</span>
            </div>
          </div>
          <p className="ufs-login-welcome-footer">Built around our people.</p>
          <div className="ufs-login-orbit" aria-hidden="true"><span /><span /><span /></div>
        </section>
        <section className="ufs-login-panel" aria-label="Workspace sign in">
          <div className="ufs-login-card">
            <div className="ufs-login-lock" aria-hidden="true">
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
              </svg>
            </div>
            <LoginForm authEnabled={standaloneConfigured()} reason={reason} />
          </div>
          <p className="ufs-login-footer">United Field Services <span aria-hidden="true">·</span> UFS People</p>
        </section>
      </div>
    </main>
  );
}
