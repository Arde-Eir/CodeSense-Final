// src/WelcomePage.tsx
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/components/AuthContext'

export const WelcomePage: React.FC = () => {
  const navigate = useNavigate()
  const { user, isGuest } = useAuth()
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const playerName = isGuest ? 'Explorer' : (user?.playerName ?? 'Explorer')

  // Redirect returning (non-guest) users who already have XP — they've been
  // here before and shouldn't see the new-user welcome screen again.
  useEffect(() => {
    if (!isGuest && user && (user.totalXP ?? 0) > 0) {
      navigate('/home', { replace: true })
    }
  }, [isGuest, user, navigate])

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50)
    return () => {
      clearTimeout(t)
      if (navTimerRef.current) clearTimeout(navTimerRef.current)
    }
  }, [])

  const handleStart = () => {
    setExiting(true)
    navTimerRef.current = setTimeout(() => navigate('/home'), 500)
  }

  return (
    <>
    <style>{`
      @media (max-width: 480px) {
        .welcome-card { padding: 36px 24px !important; }
      }
    `}</style>
    <div style={{
      minHeight: '100vh', width: '100%',
      background: 'linear-gradient(135deg, #0d1117 0%, #1a1f2e 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      overflow: 'hidden', position: 'relative'
    }}>

      {/* Animated background grid */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.06,
        backgroundImage: 'linear-gradient(rgba(76,175,80,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(76,175,80,0.8) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)'
      }} />

      {/* Glow orbs */}
      <div style={{
        position: 'absolute', width: '500px', height: '500px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(76,175,80,0.08) 0%, transparent 70%)',
        top: '10%', left: '20%', pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute', width: '400px', height: '400px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(100,181,246,0.06) 0%, transparent 70%)',
        bottom: '10%', right: '15%', pointerEvents: 'none'
      }} />

      {/* Main card */}
      <div className="welcome-card" style={{
        position: 'relative', zIndex: 1, textAlign: 'center',
        background: 'rgba(22,27,34,0.85)', border: '1px solid #21262d',
        borderRadius: '24px', padding: '60px 72px',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(76,175,80,0.1)',
        maxWidth: '520px', width: '90%',
        opacity: visible && !exiting ? 1 : 0,
        transform: visible && !exiting ? 'translateY(0) scale(1)' : exiting ? 'translateY(-20px) scale(0.97)' : 'translateY(24px) scale(0.97)',
        transition: 'opacity 0.5s ease, transform 0.5s ease'
      }}>

        {/* Logo */}
        <div style={{
          width: '72px', height: '72px', borderRadius: '20px', margin: '0 auto 24px',
          background: 'linear-gradient(135deg, #1a3a1a, #0d2a0d)',
          border: '1px solid rgba(76,175,80,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 24px rgba(76,175,80,0.2)',
          fontSize: '36px'
        }}>
          🧠
        </div>

        {/* CodeSense label */}
        <div style={{ color: '#4caf50', fontSize: '12px', fontWeight: '700', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '16px', opacity: 0.8 }}>
          CodeSense
        </div>

        {/* Welcome text */}
        <h1 style={{
          margin: '0 0 10px',
          fontSize: '32px', fontWeight: '800', lineHeight: 1.2,
          background: 'linear-gradient(135deg, #e6edf3 0%, #8b949e 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
        }}>
          Welcome{isGuest ? '' : ' back'},
        </h1>
        <h1 style={{
          margin: '0 0 16px',
          fontSize: '32px', fontWeight: '800', lineHeight: 1.2,
          background: 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
        }}>
          {playerName}!
        </h1>

        <p style={{ color: '#8b949e', fontSize: '15px', lineHeight: 1.6, margin: '0 0 36px' }}>
          {isGuest
            ? 'Exploring as a guest. Try the sandbox and see what CodeSense can do.'
            : 'Your journey to master code safety continues. Ready to level up?'}
        </p>

        {/* Divider */}
        <div style={{ width: '48px', height: '2px', background: 'rgba(76,175,80,0.4)', borderRadius: '2px', margin: '0 auto 32px' }} />

        {/* Start button */}
        <button
          onClick={handleStart}
          style={{
            background: 'linear-gradient(135deg, #4caf50, #2d7a2d)',
            border: 'none', borderRadius: '12px',
            color: 'white', fontSize: '15px', fontWeight: '700',
            padding: '14px 48px', cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(76,175,80,0.35)',
            transition: 'all 0.2s', letterSpacing: '0.5px',
            width: '100%'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-2px)'
            e.currentTarget.style.boxShadow = '0 12px 32px rgba(76,175,80,0.45)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(76,175,80,0.35)'
          }}
        >
          Start →
        </button>

        {/* Guest note */}
        {isGuest && (
          <p style={{ color: '#484f58', fontSize: '12px', marginTop: '16px', marginBottom: 0 }}>
            Want to save your progress?{' '}
            <span
              onClick={() => navigate('/signup')}
              style={{ color: '#4caf50', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Create an account
            </span>
          </p>
        )}
      </div>
    </div>
    </>
  )
}
