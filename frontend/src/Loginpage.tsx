import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './components/AuthScreen';

// ── Account-suspended modal — shown when a banned user tries to log in ───────
const BannedModal: React.FC<{ reason: string; onClose: () => void }> = ({ reason, onClose }) => (
  <div style={{
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    animation: 'bannedFadeIn 0.2s ease',
  }}>
    <style>{`
      @keyframes bannedFadeIn { from { opacity: 0 } to { opacity: 1 } }
      @keyframes bannedSlideUp { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }
    `}</style>
    <div style={{
      background: 'linear-gradient(160deg, #1a0e0e 0%, #0d1117 100%)',
      border: '1px solid rgba(248,81,73,0.4)', borderRadius: '16px',
      maxWidth: '480px', width: '100%', padding: '32px',
      boxShadow: '0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(248,81,73,0.15)',
      animation: 'bannedSlideUp 0.25s ease-out',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <div style={{
          width: '72px', height: '72px', borderRadius: '50%',
          background: 'rgba(248,81,73,0.12)', border: '2px solid rgba(248,81,73,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px', fontSize: '38px',
        }}>
          🚫
        </div>
        <div style={{
          display: 'inline-block', background: 'rgba(248,81,73,0.15)',
          color: '#f85149', fontSize: '10px', fontWeight: '800',
          letterSpacing: '1.5px', padding: '4px 10px', borderRadius: '4px',
          textTransform: 'uppercase', marginBottom: '10px',
        }}>
          Account Suspended
        </div>
        <h2 style={{ color: '#e6edf3', fontSize: '22px', fontWeight: '700', margin: '0 0 8px' }}>
          Access Denied
        </h2>
        <p style={{ color: '#8b949e', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>
          This account has been banned from CodeSense by an administrator.
        </p>
      </div>

      <div style={{
        background: 'rgba(248,81,73,0.05)', border: '1px solid rgba(248,81,73,0.25)',
        borderRadius: '10px', padding: '14px 16px', marginBottom: '20px',
      }}>
        <div style={{
          color: '#f85149', fontSize: '10px', fontWeight: '700',
          letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px',
        }}>
          Reason for suspension
        </div>
        <div style={{ color: '#e6edf3', fontSize: '14px', lineHeight: 1.6 }}>
          {reason || 'No specific reason was provided.'}
        </div>
      </div>

      <div style={{
        background: 'rgba(88,166,255,0.05)', border: '1px solid rgba(88,166,255,0.2)',
        borderRadius: '10px', padding: '12px 14px', marginBottom: '22px',
        fontSize: '12px', color: '#8b949e', lineHeight: 1.6,
      }}>
        <strong style={{ color: '#c9d1d9' }}>Think this is a mistake?</strong>
        <br />
        Contact the CodeSense team at <span style={{ color: '#58a6ff' }}>support@codesense.app</span> with your player name and a brief appeal. Decisions are reviewed within 3 business days.
      </div>

      <button
        onClick={onClose}
        style={{
          width: '100%', padding: '12px', background: 'rgba(255,255,255,0.06)',
          border: '1px solid #30363d', borderRadius: '8px', color: '#e6edf3',
          fontSize: '13px', fontWeight: '700', cursor: 'pointer',
          transition: 'all 0.15s', letterSpacing: '0.4px',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      >
        Understood
      </button>
    </div>
  </div>
);

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, continueAsGuest } = useAuth();

  const [formData, setFormData] = useState({ playerName: '', secretCode: '' });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [banInfo, setBanInfo] = useState<{ reason: string } | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await login(formData.playerName, formData.secretCode);
      navigate('/welcome');
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (msg.startsWith('ACCOUNT_BANNED')) {
        // Format from DatabaseService: "ACCOUNT_BANNED: <reason>"  or just "ACCOUNT_BANNED"
        const reason = msg.slice('ACCOUNT_BANNED'.length).replace(/^:\s*/, '').trim();
        setBanInfo({ reason });
      } else {
        setError('Invalid Player Name or Secret Code.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestEntry = () => {
    continueAsGuest();
    navigate('/welcome'); 
  };

  return (
    <>
    <style>{`
      @media (max-width: 480px) {
        .login-card { padding: 28px 20px !important; }
        .login-card input { font-size: 16px !important; }
      }
    `}</style>
    <div style={containerStyle}>
      <div className="login-card" style={cardStyle}>
        <div style={{ width: '100%', marginBottom: '15px', textAlign: 'left' }}>
          <button 
            onClick={() => navigate('/')} 
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '0',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            &larr; Back to Home
          </button>
        </div>

        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <div style={{ fontSize: '50px' }}>🔑</div>
          <h2 style={{ color: 'white', marginTop: '10px' }}>Access System</h2>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>PLAYER NAME</label>
            <input
              type="text"
              required
              style={inputStyle}
              value={formData.playerName}
              onChange={(e) => setFormData({...formData, playerName: e.target.value})}
            />
          </div>

          <div style={{ marginBottom: '25px' }}>
            <label style={labelStyle}>SECRET CODE</label>
            <input
              type="password"
              required
              style={inputStyle}
              value={formData.secretCode}
              onChange={(e) => setFormData({...formData, secretCode: e.target.value})}
            />
          </div>

          {error && <p style={{ color: '#ff4444', fontSize: '13px', textAlign: 'center' }}>{error}</p>}

          <button type="submit" disabled={isLoading} style={primaryBtnStyle}>
            {isLoading ? 'DECRYPTING...' : 'LOGIN'}
          </button>
        </form>

        <div style={{ margin: '20px 0', textAlign: 'center', color: '#444' }}>OR</div>

        <button onClick={handleGuestEntry} style={secondaryBtnStyle}>
          CONTINUE AS GUEST
        </button>

        <p style={{ color: '#8b949e', textAlign: 'center', marginTop: '20px', fontSize: '14px' }}>
          New explorer? <span onClick={() => navigate('/signup')} style={linkStyle}>Register here</span>
        </p>
      </div>

      {banInfo && <BannedModal reason={banInfo.reason} onClose={() => setBanInfo(null)} />}
    </div>
    </>
  );
};

const containerStyle: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1117', padding: '20px' };
const cardStyle = { background: '#161b22', padding: '40px', borderRadius: '16px', border: '1px solid #30363d', width: '100%', maxWidth: '400px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)' };
const labelStyle = { display: 'block', color: '#8b949e', fontSize: '12px', marginBottom: '8px', fontWeight: 'bold' as const };
const inputStyle = { width: '100%', padding: '12px', background: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', color: 'white', outline: 'none', fontSize: '16px' };
const primaryBtnStyle = { width: '100%', padding: '12px', background: '#238636', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold' as const, cursor: 'pointer' };
const secondaryBtnStyle = { width: '100%', padding: '12px', background: 'transparent', color: '#58a6ff', border: '1px solid #58a6ff', borderRadius: '8px', fontWeight: 'bold' as const, cursor: 'pointer' };
const linkStyle = { color: '#58a6ff', cursor: 'pointer', textDecoration: 'underline' };
