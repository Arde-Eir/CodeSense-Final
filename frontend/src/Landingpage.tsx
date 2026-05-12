import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './components/AuthScreen';
import { supabase } from './services/supabase';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [playerCount, setPlayerCount] = useState<number | null>(null);

  // Authenticated users who land here (e.g. via the "About" button) go home
  useEffect(() => {
    if (isAuthenticated) navigate('/home', { replace: true });
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .then(({ count }) => setPlayerCount(count ?? 0));
  }, []);

  // Override layout.css overflow:hidden so page can scroll
  useEffect(() => {
    const els = [
      document.documentElement,
      document.body,
      document.getElementById('root')
    ]
    els.forEach(el => {
      if (el) {
        el.style.overflow = 'auto'
        el.style.height = 'auto'
        el.style.minHeight = '100%'
      }
    })
    return () => {
      els.forEach(el => {
        if (el) {
          el.style.overflow = ''
          el.style.height = ''
          el.style.minHeight = ''
        }
      })
    }
  }, [])

  return (
    <>
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-16px); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .landing-root {
          width: 100%;
          min-height: 100vh;
          background: linear-gradient(135deg, #0d1117 0%, #1a1f2e 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 24px;
          position: relative;
          overflow-x: hidden;
          font-family: 'IBM Plex Sans', system-ui, sans-serif;
          box-sizing: border-box;
        }
        .landing-content {
          max-width: 860px;
          width: 100%;
          text-align: center;
          animation: fadeUp 0.7s ease both;
          position: relative;
          z-index: 1;
        }
        .landing-card {
          background: rgba(22,27,34,0.85);
          border: 1px solid #21262d;
          border-radius: 14px;
          padding: 28px 20px;
          transition: all 0.25s ease;
        }
        .landing-card:hover {
          transform: translateY(-5px);
          border-color: rgba(76,175,80,0.4);
          background: rgba(22,27,34,0.95);
        }
        .cta-primary {
          padding: 15px 44px;
          background: linear-gradient(135deg, #4caf50, #2d7a2d);
          color: white; border: none; border-radius: 12px;
          font-size: 16px; font-weight: 700; cursor: pointer;
          box-shadow: 0 4px 20px rgba(76,175,80,0.3);
          transition: all 0.2s ease;
        }
        .cta-primary:hover { transform: scale(1.04); box-shadow: 0 8px 28px rgba(76,175,80,0.45); }
        .cta-secondary {
          padding: 15px 44px; background: transparent;
          color: #64b5f6; border: 2px solid #64b5f6;
          border-radius: 12px; font-size: 16px; font-weight: 700;
          cursor: pointer; transition: all 0.2s ease;
        }
        .cta-secondary:hover { background: rgba(100,181,246,0.1); transform: scale(1.04); }
        .guest-btn {
          padding: 11px 36px; background: transparent;
          color: #8b949e; border: 1px solid #30363d;
          border-radius: 8px; font-size: 14px; font-weight: 600;
          cursor: pointer; transition: all 0.2s ease;
        }
        .guest-btn:hover { background: rgba(139,148,158,0.12); border-color: #8b949e; color: #e6edf3; }
        .feature-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-bottom: 36px;
        }
        .stat-bar {
          display: flex;
          gap: 28px;
          justify-content: center;
          flex-wrap: wrap;
          margin-bottom: 40px;
        }
        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .stat-value {
          font-size: 22px;
          font-weight: 800;
          color: #4caf50;
          letter-spacing: -0.5px;
        }
        .stat-label {
          font-size: 11px;
          color: #8b949e;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          font-weight: 600;
        }
        @media (max-width: 1024px) and (min-width: 769px) {
          .feature-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 768px) {
          .landing-root { padding: 40px 16px; }
          .feature-grid { grid-template-columns: 1fr; gap: 12px; margin-bottom: 28px; }
          .cta-row { flex-direction: column; align-items: stretch !important; }
          .cta-primary, .cta-secondary {
            padding: 16px 20px;
            font-size: 15px;
            min-height: 52px;
            width: 100%;
          }
          .stat-bar { gap: 20px; margin-bottom: 28px; }
          .stat-value { font-size: 20px; }
          .landing-card { padding: 22px 16px; }
        }
      `}</style>

      <div className="landing-root">

        {/* Background blobs */}
        <div style={{ position: 'absolute', top: '12%', left: '6%', fontSize: '110px', opacity: 0.04, animation: 'float 6s ease-in-out infinite', pointerEvents: 'none', userSelect: 'none' }}>💻</div>
        <div style={{ position: 'absolute', bottom: '12%', right: '6%', fontSize: '90px', opacity: 0.04, animation: 'float 8s ease-in-out infinite reverse', pointerEvents: 'none', userSelect: 'none' }}>🧠</div>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '700px', height: '700px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(76,175,80,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div className="landing-content">

          {/* Logo */}
          <div style={{ fontSize: '72px', marginBottom: '16px', display: 'inline-block', animation: 'float 3s ease-in-out infinite' }}>🧠</div>

          {/* Title */}
          <h1 style={{
            fontSize: 'clamp(36px, 5.5vw, 62px)', fontWeight: '800',
            marginBottom: '16px', letterSpacing: '-1px',
            background: 'linear-gradient(135deg, #64b5f6 0%, #4caf50 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            lineHeight: 1.1
          }}>
            CodeSense
          </h1>

          {/* Subtitle */}
          <p style={{
            color: '#8b949e', fontSize: 'clamp(14px, 1.8vw, 18px)',
            lineHeight: 1.75, maxWidth: '560px', margin: '0 auto 44px'
          }}>
            Learn C++ security and best practices through interactive code analysis.{' '}
            Master safe coding with real-time feedback.
          </p>

          {/* Live stats bar */}
          <div className="stat-bar">
            <div className="stat-item">
              <span className="stat-value">
                {playerCount === null ? '—' : playerCount.toLocaleString()}
              </span>
              <span className="stat-label">Players</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">4</span>
              <span className="stat-label">Patch</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">C++</span>
              <span className="stat-label">Language</span>
            </div>
          </div>

          {/* Feature cards */}
          <div className="feature-grid">
            {[
              { icon: '🔬', title: 'Sandbox Mode', desc: 'Experiment freely with code analysis' },
              { icon: '🎯', title: 'Campaign Mode', desc: 'Complete missions and level up' },
              { icon: '📊', title: 'Track Progress', desc: 'Monitor your learning journey' },
            ].map(f => (
              <div key={f.title} className="landing-card">
                <div style={{ fontSize: '36px', marginBottom: '14px' }}>{f.icon}</div>
                <h3 style={{ color: '#e6edf3', fontSize: '15px', fontWeight: '700', marginBottom: '8px', margin: '0 0 8px' }}>{f.title}</h3>
                <p style={{ color: '#8b949e', fontSize: '13px', lineHeight: 1.5, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>

          {/* CTA row */}
          <div className="cta-row" style={{ display: 'flex', gap: '14px', justifyContent: 'center', marginBottom: '28px', flexWrap: 'wrap' }}>
            <button className="cta-primary" onClick={() => navigate('/signup')}>
              Create an Account
            </button>
            <button className="cta-secondary" onClick={() => navigate('/login')}>
              Sign In
            </button>
          </div>


        </div>
      </div>
    </>
  );
};