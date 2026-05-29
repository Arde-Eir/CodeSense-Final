import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './components/AuthScreen';


// ── Reusable field component ──────────────────────────────────────────────────
const Field: React.FC<{ label: string; error?: string; children: React.ReactNode }> = ({ label, error, children }) => (
  <div style={{ marginBottom: 20 }}>
    <label style={{
      display: 'block', color: '#8b949e', fontSize: 12, fontWeight: 700,
      letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 8,
      fontFamily: "'IBM Plex Mono', monospace",
    }}>
      {label}
    </label>
    {children}
    {error && (
      <p style={{ color: '#f85149', fontSize: 11, marginTop: 5, display: 'flex', alignItems: 'center', gap: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
        <span>⚠</span> {error}
      </p>
    )}
  </div>
);

const getInputStyle = (hasError: boolean): React.CSSProperties => ({
  width: '100%', padding: '11px 14px', background: '#0d1117',
  border: `1px solid ${hasError ? '#f85149' : '#30363d'}`, borderRadius: 8,
  color: '#e6edf3', fontSize: 16, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit', transition: 'border-color 0.2s, box-shadow 0.2s',
  WebkitTextFillColor: '#e6edf3',
});

// ── Philippine DPA Consent Modal (RA 10173) ───────────────────────────────────
const PrivacyConsentModal: React.FC<{ onAgree: () => void; onClose: () => void }> = ({ onAgree, onClose }) => {
  const [checked, setChecked] = useState({ collection: false, processing: false, rights: false, retention: false });
  const allChecked = Object.values(checked).every(Boolean);
  const toggle = (k: keyof typeof checked) => setChecked(p => ({ ...p, [k]: !p[k] }));

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
      backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 9999, padding: 16,
    }}>
      <div style={{
        background: 'linear-gradient(160deg, #161b22 0%, #0d1117 100%)',
        border: '1px solid #30363d', borderRadius: 16, maxWidth: 620, width: '100%',
        boxShadow: '0 24px 80px rgba(0,0,0,0.85)', animation: 'fadeUp 0.22s ease-out',
        display: 'flex', flexDirection: 'column', maxHeight: '92vh', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '20px 26px 16px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #30363d', borderRadius: 6, padding: '3px 9px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 11 }}>🇵🇭</span>
              <span style={{ color: '#484f58', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px' }}>REPUBLIC ACT NO. 10173</span>
            </div>
            <div style={{ background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.25)', borderRadius: 6, padding: '3px 9px' }}>
              <span style={{ color: '#4caf50', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px' }}>DATA PRIVACY ACT OF 2012</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontSize: 20, marginTop: 2 }}>🔐</span>
            <div>
              <h2 style={{ color: '#e6edf3', fontSize: 17, fontWeight: 700, margin: '0 0 3px' }}>Data Privacy Consent Form</h2>
              <p style={{ color: '#8b949e', fontSize: 11, margin: 0, lineHeight: 1.5 }}>
                CodeSense — Personal Information Controller (PIC)<br />
                Please read carefully before creating your account.
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '18px 26px', flex: 1, fontSize: 12, lineHeight: 1.75, color: '#8b949e' }}>

          <p style={{ margin: '0 0 18px' }}>
            In compliance with <b style={{ color: '#c9d1d9' }}>Republic Act No. 10173</b> (Data Privacy Act of 2012) and its
            Implementing Rules and Regulations issued by the <b style={{ color: '#c9d1d9' }}>National Privacy Commission (NPC)</b>,
            CodeSense informs you of the following before collecting any personal data.
          </p>

          {/* Section 1 */}
          <S icon="🏢" title="1. Identity of the Personal Information Controller">
            <KV label="Name"    value="CodeSense" />
            <KV label="Purpose" value="Basic C++ Code Safety Learning Platform" />
            <p style={np}>CodeSense acts as the <b style={{ color: '#c9d1d9' }}>Personal Information Controller (PIC)</b> under Section 3(h) of RA 10173.</p>
          </S>

          {/* Section 2 */}
          <S icon="📋" title="2. Personal Data We Collect">
            <p style={np}>Pursuant to the <b style={{ color: '#c9d1d9' }}>data minimization</b> principle (Sec. 11c, RA 10173), we collect only what is strictly necessary:</p>
            <DTable rows={[
              ['Player username',          'Account identification',                     'Required'],
              ['Email address',            'Account recovery & notifications',           'Required'],
              ['Password (hashed)',         'Authentication — never stored in plaintext', 'Required'],
              ['XP & level progress',      'Gamified learning progression tracking',    'Required'],
              ['Submitted source code',    'AI-powered code safety analysis',           'Required'],
              ['Sandbox run count',        'Usage statistics for your dashboard',       'Required'],
              ['Avatar image (optional)',  'Profile personalization',                   'Optional'],
            ]} />
            <p style={{ ...np, marginTop: 8 }}>
              <b style={{ color: '#f85149' }}>We do NOT collect:</b> government IDs, financial information, precise geolocation,
              biometric data, or any sensitive personal information under Section 3(l) of RA 10173.
            </p>
          </S>

          {/* Section 3 */}
          <S icon="⚖️" title="3. Purpose of Processing & Legal Basis">
            <p style={np}>Under <b style={{ color: '#c9d1d9' }}>Section 12 of RA 10173</b>, processing is lawful under:</p>
            {[
              ['Consent (Sec. 12a)',             'You explicitly agree to this form before account creation.'],
              ['Contractual necessity (Sec. 12b)', 'Processing is required to deliver the CodeSense service.'],
              ['Legitimate interest (Sec. 12f)',   'Anonymised, aggregated usage data improves our teaching tools. Your identity is never exposed.'],
            ].map(([b, d]) => (
              <div key={b} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <span style={{ color: '#4caf50', flexShrink: 0, marginTop: 1 }}>✓</span>
                <div><b style={{ color: '#c9d1d9' }}>{b}</b><p style={{ margin: '2px 0 0', color: '#8b949e' }}>{d}</p></div>
              </div>
            ))}
          </S>

          {/* Section 4 */}
          <S icon="🔒" title="4. Data Sharing & Third-Party Disclosure">
            <p style={np}>CodeSense does <b style={{ color: '#f85149' }}>not sell, rent, or trade</b> your personal data. Limited sharing occurs only as follows:</p>
            {[
              ['Supabase (Database & Storage)',     'Stores your account data and avatar under strict data processing agreements.'],
              ['AI Analysis Provider',              'Your submitted code is sent for analysis. No personally identifiable information accompanies the code payload.'],
              ['NPC & Competent Authorities',       'Disclosed only when required by Philippine law or lawful court order under Sec. 13 of RA 10173.'],
            ].map(([party, desc]) => (
              <div key={party} style={{ marginBottom: 10, paddingLeft: 10, borderLeft: '2px solid #30363d' }}>
                <b style={{ color: '#c9d1d9' }}>{party}</b>
                <p style={{ margin: '2px 0 0', color: '#8b949e' }}>{desc}</p>
              </div>
            ))}
          </S>

          {/* Section 5 */}
          <S icon="🗂️" title="5. Data Retention Period">
            <p style={np}>Under the <b style={{ color: '#c9d1d9' }}>storage limitation</b> principle (Sec. 11e, RA 10173):</p>
            <DTable rows={[
              ['Account & profile data',   'Active account duration + 30 days after deletion request'],
              ['Source code submissions',  'Retained 90 days for report generation, then permanently deleted'],
              ['XP / progress records',    'Retained while your account is active'],
              ['Anonymised analytics',     'Retained indefinitely (no personal identifiers attached)'],
            ]} />
          </S>

          {/* Section 6 */}
          <S icon="⚡" title="6. Your Rights as a Data Subject (Sec. 16, RA 10173)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
              {[
                ['Right to be Informed',   'Know what data we collect and why.'],
                ['Right to Access',        'Request a copy of your stored data anytime.'],
                ['Right to Rectification', 'Correct inaccurate or outdated data.'],
                ['Right to Erasure',       'Request deletion of your account and data.'],
                ['Right to Object',        'Opt out of non-essential processing.'],
                ['Right to Portability',   'Receive your data in a readable format.'],
                ['Right to Damages',       'Seek compensation for violations (Sec. 16f).'],
                ['Right to Complain',      'File with NPC at www.privacy.gov.ph.'],
              ].map(([r, d]) => (
                <div key={r} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #21262d', borderRadius: 7, padding: '9px 11px' }}>
                  <b style={{ color: '#64b5f6', fontSize: 11, display: 'block', marginBottom: 2 }}>{r}</b>
                  <span style={{ color: '#8b949e', fontSize: 11 }}>{d}</span>
                </div>
              ))}
            </div>
            <p style={{ ...np, marginTop: 9 }}>
              To exercise any right, email <b style={{ color: '#4caf50' }}>privacy@codesense.app</b>. We respond within
              <b style={{ color: '#c9d1d9' }}> 15 business days</b> as required by NPC guidelines.
            </p>
          </S>

          {/* Section 7 */}
          <S icon="🛡️" title="7. Security Measures (Sec. 20, RA 10173)">
            {[
              'Passwords are hashed using bcrypt — never stored in plaintext.',
              'All data in transit is encrypted via TLS 1.2+.',
              'Source code is stored in isolated, access-controlled storage buckets.',
              'Database access is restricted to authenticated services only.',
              'In the event of a breach, you will be notified within 72 hours (NPC Circular 16-03).',
            ].map(item => (
              <div key={item} style={{ display: 'flex', gap: 7, marginBottom: 6 }}>
                <span style={{ color: '#4caf50', flexShrink: 0 }}>•</span>
                <span>{item}</span>
              </div>
            ))}
          </S>

          {/* Section 8 */}
          <S icon="👶" title="8. Processing of Data of Minors">
            <p style={np}>
              If you are below 18 years of age, your parent or legal guardian must consent on your behalf per
              <b style={{ color: '#c9d1d9' }}> Section 13 of RA 10173</b> and NPC Advisory Opinion No. 2018-031.
              By proceeding, you confirm you are at least 13 years old or that parental consent has been obtained.
            </p>
          </S>

          {/* Consent checkboxes */}
          <div style={{ marginTop: 20, padding: '16px 18px', background: 'rgba(76,175,80,0.04)', border: '1px solid rgba(76,175,80,0.2)', borderRadius: 11 }}>
            <p style={{ color: '#c9d1d9', fontSize: 12, fontWeight: 700, margin: '0 0 12px', letterSpacing: '0.3px' }}>
              📝 INFORMED CONSENT — Please confirm each of the following:
            </p>
            {([
              ['collection', 'I have read and understood what personal data CodeSense collects and why (Sections 2 & 3).'],
              ['processing', 'I freely and voluntarily consent to the processing of my personal data as described, pursuant to Sec. 12(a) of RA 10173.'],
              ['rights',     'I am aware of my rights as a data subject under Section 16 of RA 10173 and know how to exercise them.'],
              ['retention',  'I understand the data retention periods and may request deletion of my account and data at any time.'],
            ] as [keyof typeof checked, string][]).map(([key, label]) => (
              <label key={key} style={{ display: 'flex', gap: 10, marginBottom: 9, cursor: 'pointer', alignItems: 'flex-start' }} onClick={() => toggle(key)}>
                <div style={{
                  width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 2,
                  border: `2px solid ${checked[key] ? '#4caf50' : '#30363d'}`,
                  background: checked[key] ? '#4caf50' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}>
                  {checked[key] && <span style={{ color: 'white', fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ color: '#8b949e', fontSize: 12, lineHeight: 1.6 }}>{label}</span>
              </label>
            ))}
          </div>

          <p style={{ color: '#484f58', fontSize: 10, textAlign: 'center', margin: '14px 0 0' }}>
            Effective March 2025 · CodeSense · Pursuant to RA 10173 & NPC Implementing Rules and Regulations
          </p>
        </div>

        {/* Footer buttons */}
        <div style={{ padding: '14px 26px 20px', borderTop: '1px solid #21262d', flexShrink: 0 }}>
          {!allChecked && (
            <p style={{ color: '#ffa726', fontSize: 11, textAlign: 'center', margin: '0 0 8px' }}>
              ⚠️ Please tick all four checkboxes to confirm your informed consent.
            </p>
          )}
          <button
            disabled={!allChecked}
            onClick={onAgree}
            style={{
              width: '100%', padding: '13px', marginBottom: 8,
              background: allChecked ? 'linear-gradient(135deg, #238636 0%, #2ea043 100%)' : 'rgba(35,134,54,0.2)',
              border: allChecked ? 'none' : '1px solid #238636',
              borderRadius: 9, color: allChecked ? 'white' : '#484f58',
              fontWeight: 700, fontSize: 13, letterSpacing: '0.4px',
              cursor: allChecked ? 'pointer' : 'not-allowed',
              boxShadow: allChecked ? '0 4px 20px rgba(35,134,54,0.4)' : 'none',
              transition: 'all 0.2s ease',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            ✓ I Give My Informed Consent — Create My Account
          </button>
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '11px', background: 'transparent',
              border: '1px solid #30363d', borderRadius: 9, color: '#484f58',
              fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s ease',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
            onMouseEnter={e => { (e.currentTarget.style.borderColor = '#8b949e'); (e.currentTarget.style.color = '#8b949e'); }}
            onMouseLeave={e => { (e.currentTarget.style.borderColor = '#30363d'); (e.currentTarget.style.color = '#484f58'); }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Small helper sub-components for the modal ─────────────────────────────────
const S: React.FC<{ icon: string; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div style={{ marginBottom: 20 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <h3 style={{ color: '#c9d1d9', fontSize: 12, fontWeight: 700, margin: 0 }}>{title}</h3>
    </div>
    <div style={{ paddingLeft: 2 }}>{children}</div>
  </div>
);

const KV: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
    <span style={{ color: '#484f58', fontSize: 12, minWidth: 65 }}>{label}:</span>
    <span style={{ color: '#c9d1d9', fontSize: 12, fontWeight: 600 }}>{value}</span>
  </div>
);

const DTable: React.FC<{ rows: string[][] }> = ({ rows }) => (
  <div style={{ border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden', marginTop: 6 }}>
    {rows.map(([c1, c2, c3], i) => (
      <div key={c1} style={{
        display: 'grid', gridTemplateColumns: c3 ? '1.3fr 2fr 0.65fr' : '1.3fr 2.65fr',
        background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
        borderBottom: i < rows.length - 1 ? '1px solid #21262d' : 'none',
      }}>
        <div style={{ padding: '7px 11px', color: '#c9d1d9', fontSize: 11, fontWeight: 600, borderRight: '1px solid #21262d' }}>{c1}</div>
        <div style={{ padding: '7px 11px', color: '#8b949e', fontSize: 11, borderRight: c3 ? '1px solid #21262d' : 'none' }}>{c2}</div>
        {c3 && <div style={{ padding: '7px 11px', color: c3 === 'Required' ? '#f85149' : '#8b949e', fontSize: 11, fontWeight: 600, textAlign: 'center' }}>{c3}</div>}
      </div>
    ))}
  </div>
);

const np: React.CSSProperties = { color: '#8b949e', fontSize: 12, lineHeight: 1.7, margin: '0 0 10px' };


// ── Main SignupPage component ─────────────────────────────────────────────────
export const SignupPage: React.FC = () => {
  const navigate = useNavigate();
  const { signup, goBack } = useAuth();

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    email: '',
    confirmPassword: '',
    userType: 'student' as 'student' | 'professional',
  });

  const [agreedToPrivacy,  setAgreedToPrivacy]  = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [errors,           setErrors]           = useState<Record<string, string>>({});
  const [isLoading,        setIsLoading]        = useState(false);
  const [focusedField,     setFocusedField]     = useState<string | null>(null);

  // ── Bot-detection: math CAPTCHA + honeypot + timing ─────────────────────────
  const [captchaQ, setCaptchaQ]         = useState({ a: 0, b: 0 });
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [honeypot, setHoneypot]         = useState('');  // bots fill this; humans don't
  const formLoadTime = useRef(Date.now());

  useEffect(() => {
    setCaptchaQ({
      a: Math.floor(Math.random() * 9) + 1,
      b: Math.floor(Math.random() * 9) + 1,
    });
    formLoadTime.current = Date.now();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};

    // Bot detection: honeypot field must be empty
    if (honeypot) { setErrors({ submit: 'Automated signup detected.' }); return false; }
    // Bot detection: form must take at least 4 seconds to fill
    if (Date.now() - formLoadTime.current < 4000) { setErrors({ submit: 'Please slow down and fill the form carefully.' }); return false; }

    if (!formData.username.trim())             errs.username = 'Player name is required';
    else if (formData.username.trim().length < 3)  errs.username = 'Name must be at least 3 characters';
    else if (formData.username.trim().length > 50) errs.username = 'Name must be 50 characters or fewer';
    if (!formData.email.trim())                errs.email = 'Email address is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errs.email = 'Please enter a valid email address';
    if (!formData.password)                    errs.password = 'Secret code is required';
    else if (formData.password.length < 8)     errs.password = 'Code must be at least 8 characters';
    if (!formData.confirmPassword)             errs.confirmPassword = 'Please confirm your code';
    else if (formData.password !== formData.confirmPassword) errs.confirmPassword = 'Codes do not match';
    if (!agreedToPrivacy)                      errs.privacy = 'You must agree to the Data Privacy Policy';

    // Math CAPTCHA
    const expected = captchaQ.a + captchaQ.b;
    if (!captchaAnswer.trim())                         errs.captcha = 'Please answer the security question';
    else if (parseInt(captchaAnswer, 10) !== expected) errs.captcha = 'Incorrect answer — try again';

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  if (!validateForm()) return;
  setIsLoading(true);
  
  try {
    await signup(
      formData.username.trim(),
      formData.password,
      formData.email.trim(),
      formData.userType
    );
    
    navigate('/welcome');
  } catch (err: any) {
    const msg = err?.message ?? '';
    // Handle specific errors from DatabaseService
    if      (msg === 'USERNAME_TAKEN')          setErrors({ username: 'This player name is already taken.' });
    else if (msg === 'EMAIL_TAKEN')             setErrors({ email: 'An account with this email already exists.' });
    else if (msg === 'EMAIL_ORPHANED')           setErrors({ email: 'This email is already registered. If this is your account, try logging in instead.' });
    else if (msg === 'PROFILE_SETUP_BLOCKED')   setErrors({ submit: 'Account auth was created, but profile setup is blocked by database security rules. Please apply the signup RLS fix in Supabase.' });
    else if (msg === 'SERVER_ERROR')            setErrors({ submit: 'A server error occurred. Please try again in a moment.' });
    else {
      setErrors({ submit: msg || 'An unexpected error occurred. Please try again.' });
    }
  } finally {
    setIsLoading(false);
  }
};

  const inputStyle = (name: string, hasError: boolean): React.CSSProperties => ({
    ...getInputStyle(hasError),
    borderColor: hasError ? '#f85149' : focusedField === name ? '#58a6ff' : '#30363d',
    boxShadow: focusedField === name && !hasError ? '0 0 0 3px rgba(88,166,255,0.12)' : 'none',
  });

  const focusProps = (name: string) => ({
    onFocus: () => setFocusedField(name),
    onBlur:  () => setFocusedField(null),
  });

  return (
    <>
      <style>{`
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px #0d1117 inset !important;
          -webkit-text-fill-color: #e6edf3 !important;
          transition: background-color 5000s ease-in-out 0s;
          caret-color: #e6edf3;
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 480px) {
          .signup-card { padding: 28px 20px !important; margin: 20px auto !important; }
        }
      `}</style>

      <div style={{
        minHeight: '100vh', width: '100%',
        background: 'radial-gradient(ellipse at 20% 50%, #0d1f12 0%, #0d1117 40%, #111827 100%)',
        display: 'block', overflowY: 'auto',
        fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
        WebkitOverflowScrolling: 'touch',
      }}>
        <div className="signup-card" style={{
          background: 'linear-gradient(160deg, rgba(22,27,34,0.97) 0%, rgba(13,17,23,0.97) 100%)',
          borderRadius: 16, padding: '36px 40px',
          width: 'calc(100% - 32px)', maxWidth: 500,
          margin: '40px auto', border: '1px solid #21262d',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
          animation: 'fadeUp 0.3s ease-out',
        }}>

          {/* Back button */}
          <button onClick={goBack} style={{
            background: 'transparent', border: 'none', color: '#484f58', cursor: 'pointer',
            fontSize: 13, padding: 0, display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: 28, fontFamily: "'IBM Plex Mono', monospace", transition: 'color 0.2s',
          }}
            onMouseEnter={e => (e.currentTarget.style.color = '#8b949e')}
            onMouseLeave={e => (e.currentTarget.style.color = '#484f58')}
          >
            ← Back to Home
          </button>

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 12, lineHeight: 1 }}>🛡️</div>
            <h1 style={{ color: '#e6edf3', fontSize: 26, fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.5px' }}>
              Begin Your Quest
            </h1>
            <p style={{ color: '#484f58', fontSize: 13, margin: 0 }}>Choose your path in CodeSense</p>
          </div>

          <form onSubmit={handleSubmit} noValidate>

            {/* Player Name */}
            <Field label="Player Name" error={errors.username}>
              <input type="text" name="username" value={formData.username} onChange={handleChange}
                placeholder="e.g. CoderKnight" autoComplete="username"
                style={inputStyle('username', !!errors.username)} {...focusProps('username')} />
            </Field>

            {/* Email */}
            <Field label="Email Address" error={errors.email}>
              <input type="email" name="email" value={formData.email} onChange={handleChange}
                placeholder="e.g. yourname@gmail.com" autoComplete="email"
                style={inputStyle('email', !!errors.email)} {...focusProps('email')} />
            </Field>

            {/* Password */}
            <Field label="Secret Code (Password)" error={errors.password}>
              <input type="password" name="password" value={formData.password} onChange={handleChange}
                placeholder="At least 8 characters" autoComplete="new-password"
                style={inputStyle('password', !!errors.password)} {...focusProps('password')} />
            </Field>

            {/* Confirm Password */}
            <Field label="Confirm Code" error={errors.confirmPassword}>
              <input type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange}
                placeholder="Repeat your code" autoComplete="new-password"
                style={inputStyle('confirmPassword', !!errors.confirmPassword)} {...focusProps('confirmPassword')} />
            </Field>

            {/* ── Honeypot: invisible to humans, bots auto-fill it ── */}
            <div style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }} aria-hidden="true">
              <input
                type="text" tabIndex={-1} autoComplete="off"
                value={honeypot} onChange={e => setHoneypot(e.target.value)}
              />
            </div>

            {/* User Type */}
            <Field label="I am a">
              <div style={{ display: 'flex', gap: 8 }}>
                {(['student', 'professional'] as const).map(type => {
                  const active = formData.userType === type;
                  return (
                    <button key={type} type="button"
                      onClick={() => setFormData(prev => ({ ...prev, userType: type }))}
                      style={{
                        flex: 1, padding: '10px 12px',
                        background: active ? 'rgba(76,175,80,0.15)' : 'rgba(13,17,23,0.6)',
                        border: `1px solid ${active ? '#4caf50' : '#21262d'}`,
                        borderRadius: 8, color: active ? '#4caf50' : '#484f58',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                        transition: 'all 0.15s ease',
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}
                    >
                      {type === 'student' ? '🎓 Student' : '💼 Professional'}
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* Math CAPTCHA */}
            <Field label={`Security Check: What is ${captchaQ.a} + ${captchaQ.b}?`} error={errors.captcha}>
              <input
                type="number" inputMode="numeric" value={captchaAnswer}
                onChange={e => { setCaptchaAnswer(e.target.value); if (errors.captcha) setErrors(p => ({ ...p, captcha: '' })); }}
                placeholder="Enter the answer"
                style={inputStyle('captcha', !!errors.captcha)}
                {...focusProps('captcha')}
              />
            </Field>

            {/* Privacy checkbox */}
            <div style={{
              background: errors.privacy ? 'rgba(248,81,73,0.06)' : 'rgba(88,166,255,0.04)',
              border: `1px solid ${errors.privacy ? '#f85149' : '#21262d'}`,
              borderRadius: 8, padding: '12px 14px', marginBottom: 20, transition: 'border-color 0.2s',
            }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer', gap: 10 }}>
                <input type="checkbox" checked={agreedToPrivacy}
                  onChange={e => { setAgreedToPrivacy(e.target.checked); if (e.target.checked) setErrors(prev => ({ ...prev, privacy: '' })); }}
                  style={{ marginTop: 2, accentColor: '#58a6ff', width: 15, height: 15, flexShrink: 0, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.5 }}>
                  I agree to the{' '}
                  <button type="button" onClick={() => setShowPrivacyModal(true)}
                    style={{ background: 'none', border: 'none', color: '#58a6ff', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit', fontSize: 13 }}>
                    Data Privacy Policy
                  </button>
                  {' '}<span style={{ color: '#484f58', fontSize: 11 }}>(RA 10173)</span>
                </span>
              </label>
              {errors.privacy && (
                <p style={{ color: '#f85149', fontSize: 11, margin: '6px 0 0', fontFamily: "'IBM Plex Mono', monospace" }}>
                  ⚠ {errors.privacy}
                </p>
              )}
            </div>

            {/* Submit error */}
            {errors.submit && (
              <div style={{
                background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)',
                borderRadius: 8, padding: '10px 14px', marginBottom: 16,
                color: '#f85149', fontSize: 13, textAlign: 'center',
              }}>
                ⚠ {errors.submit}
              </div>
            )}

            {/* Submit button */}
            <button type="submit" disabled={isLoading} style={{
              width: '100%', padding: '13px',
              background: isLoading ? '#21262d' : 'linear-gradient(135deg, #238636 0%, #2ea043 100%)',
              color: isLoading ? '#484f58' : 'white', border: 'none', borderRadius: 8,
              fontWeight: 700, fontSize: 13, letterSpacing: '0.8px',
              cursor: isLoading ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
              fontFamily: "'IBM Plex Mono', monospace",
              boxShadow: isLoading ? 'none' : '0 4px 14px rgba(35,134,54,0.4)',
            }}
              onMouseEnter={e => { if (!isLoading) e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
            >
              {isLoading ? '⟳  Creating your account…' : 'START JOURNEY →'}
            </button>

            {/* Sign-in link */}
            <p style={{ textAlign: 'center', marginTop: 20, color: '#484f58', fontSize: 13 }}>
              Already have an account?{' '}
              <button type="button" onClick={() => navigate('/login')}
                style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', padding: 0, font: 'inherit', fontSize: 13, textDecoration: 'underline' }}>
                Sign in
              </button>
            </p>
          </form>
        </div>
      </div>

      {/* ── Privacy Modal — RA 10173 / Philippine Data Privacy Act of 2012 ── */}
      {showPrivacyModal && (
        <PrivacyConsentModal
          onAgree={() => {
            setAgreedToPrivacy(true);
            setShowPrivacyModal(false);
            setErrors(prev => ({ ...prev, privacy: '' }));
          }}
          onClose={() => setShowPrivacyModal(false)}
        />
      )}
    </>
  );
};
