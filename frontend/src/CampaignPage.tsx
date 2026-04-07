import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './components/AuthScreen'
import { supabase } from './services/supabase'

interface LevelInfo {
  id: number
  title: string
  subtitle: string
  phase: 'beginner' | 'intermediate' | 'advanced'
  questCount: number
  requiredXP: number
  color: string
  glowColor: string
  icon: string
}

const LEVELS: LevelInfo[] = [
  {
    id: 1, title: 'LEVEL 1', subtitle: 'Beginner',
    phase: 'beginner', questCount: 0, requiredXP: 0,
    color: '#3fb950', glowColor: 'rgba(63,185,80,0.35)', icon: '🌱'
  },
  {
    id: 2, title: 'LEVEL 2', subtitle: 'Intermediate',
    phase: 'intermediate', questCount: 0, requiredXP: 500,
    color: '#e3b341', glowColor: 'rgba(227,179,65,0.35)', icon: '⚔️'
  },
  {
    id: 3, title: 'LEVEL 3', subtitle: 'Advanced',
    phase: 'advanced', questCount: 0, requiredXP: 1000,
    color: '#f85149', glowColor: 'rgba(248,81,73,0.35)', icon: '🔥'
  },
]

export const CampaignPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [started, setStarted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [questCounts, setQuestCounts] = useState<Record<string, number>>({})
  const [hoveredLevel, setHoveredLevel] = useState<number | null>(null)
  const [particles, setParticles] = useState<{ x: number; y: number; id: number }[]>([])
  const [bgParticles, setBgParticles] = useState<{ x: number; y: number; id: number }[]>([])
  const bannerRef = useRef<HTMLDivElement>(null)
  const particleId = useRef(0)

  const userXP = (user as any)?.totalXP ?? (user as any)?.totalxp ?? 0

  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')]
    els.forEach(el => { if (el) { el.style.overflow = 'auto'; el.style.height = 'auto' } })
    setTimeout(() => setVisible(true), 50)

    const fetchCounts = async () => {
      const { data } = await supabase
        .from('quests')
        .select('phase')
        .eq('isactive', true)
      if (data) {
        const counts: Record<string, number> = {}
        data.forEach((q: { phase: string }) => {
          counts[q.phase] = (counts[q.phase] || 0) + 1
        })
        setQuestCounts(counts)
      }
    }
    fetchCounts()

    return () => {
      els.forEach(el => { if (el) { el.style.overflow = ''; el.style.height = '' } })
    }
  }, [])

  const isLevelUnlocked = (requiredXP: number) => userXP >= requiredXP

  const handlePageClick = (e: React.MouseEvent) => {
    const id = particleId.current++
    setBgParticles(p => [...p, { x: e.clientX, y: e.clientY, id }])
    setTimeout(() => setBgParticles(p => p.filter(pt => pt.id !== id)), 900)
  }

  const handleLevelClick = (level: LevelInfo) => {
    if (!started || !isLevelUnlocked(level.requiredXP)) return
    if (level.id === 1) {
      navigate('/level/1')
    } else {
      navigate(`/campaign/inside/${level.phase}`)
    }
  }

  const handleBannerClick = (e: React.MouseEvent) => {
    const rect = bannerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const id = particleId.current++
    setParticles(p => [...p, { x, y, id }])
    setTimeout(() => setParticles(p => p.filter(pt => pt.id !== id)), 800)
    setStarted(true)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

        @keyframes scanline {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes flicker {
          0%, 95%, 100% { opacity: 1; }
          96% { opacity: 0.4; }
          97% { opacity: 1; }
          98% { opacity: 0.6; }
        }
        @keyframes drift {
          0%   { transform: translate(0,0) scale(1); }
          33%  { transform: translate(12px,-8px) scale(1.04); }
          66%  { transform: translate(-8px,12px) scale(0.97); }
          100% { transform: translate(0,0) scale(1); }
        }
        @keyframes particle-burst {
          0%   { transform: translate(-50%,-50%) scale(0); opacity: 1; }
          100% { transform: translate(-50%,-50%) scale(4); opacity: 0; }
        }
        @keyframes card-in {
          from { opacity: 0; transform: translateY(30px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes press-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(227,179,65,0.6); }
          50%     { box-shadow: 0 0 0 12px rgba(227,179,65,0); }
        }

        .campaign-root {
          position: relative;
          min-height: 100vh;
          width: 100%;
          background: transparent;
          font-family: 'IBM Plex Sans', system-ui, sans-serif;
          color: #e6edf3;
          overflow-x: hidden;
        }

        /* Fixed background layer — grid + scanline */
        .campaign-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
          background: #080b10;
        }
        @keyframes bg-particle-burst {
          0%   { transform: translate(-50%,-50%) scale(0); opacity: 0.8; }
          60%  { opacity: 0.5; }
          100% { transform: translate(-50%,-50%) scale(6); opacity: 0; }
        }

        .campaign-bg .grid {
          position: absolute;
          inset: 0;
          opacity: 0.25;
          background-image:
            linear-gradient(rgba(227,179,65,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(227,179,65,0.5) 1px, transparent 1px);
          background-size: 50px 50px;
          animation: drift 20s ease-in-out infinite;
        }
        .campaign-bg .scanline {
          position: absolute;
          left: 0; right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(227,179,65,0.2), transparent);
          animation: scanline 6s linear infinite;
        }

        /* Everything above the fixed bg */
        .campaign-content {
          position: relative;
          z-index: 1;
        }

        .level-card {
          animation: card-in 0.5s ease both;
        }
        .level-card:hover .lock-icon {
          animation: lock-shake 0.4s ease;
        }
        @keyframes lock-shake {
          0%,100% { transform: translateX(0); }
          20%     { transform: translateX(-4px); }
          40%     { transform: translateX(4px); }
          60%     { transform: translateX(-3px); }
          80%     { transform: translateX(3px); }
        }

        .press-btn {
          animation: flicker 5s ease-in-out infinite, press-pulse 2s ease-in-out infinite;
          transition: transform 0.2s ease;
        }
        .press-btn:hover {
          transform: scale(1.06);
        }
      `}</style>

      {/* ── Fixed background ── */}
      <div className="campaign-bg">
        <div className="grid" />
        <div className="scanline" />
      </div>

      {/* ── Global click particles overlay ── */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none', overflow: 'hidden' }}>
        {bgParticles.map(p => (
          <div key={p.id} style={{
            position: 'absolute', left: p.x, top: p.y,
            width: '70px', height: '70px', borderRadius: '50%',
            border: '2px solid rgba(227,179,65,0.7)',
            animation: 'bg-particle-burst 0.9s ease-out forwards',
            pointerEvents: 'none'
          }} />
        ))}
      </div>

      {/* ── Scrollable content ── */}
      <div
        className="campaign-root campaign-content"
        style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.4s ease' }}
        onClick={handlePageClick}
      >
        {/* ── Header ── */}
        <div style={{
          height: '58px',
          background: 'rgba(8,11,16,0.6)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #2d333b',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px',
          position: 'sticky', top: 0, zIndex: 100,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>🎯</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: '15px', letterSpacing: '-0.3px' }}>
              CodeSense Journey
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {user && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'rgba(63,185,80,0.1)',
                border: '1px solid rgba(63,185,80,0.25)',
                borderRadius: '8px', padding: '5px 12px'
              }}>
                <span style={{ fontSize: '12px' }}>⚡</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: '#3fb950', fontWeight: 700 }}>
                  {userXP.toLocaleString()} XP
                </span>
              </div>
            )}
            <button
              onClick={() => navigate('/home')}
              style={{
                background: 'transparent',
                border: '1px solid #444c56',
                color: '#8b949e',
                padding: '7px 14px', borderRadius: '6px',
                fontWeight: 600, fontSize: '11px', letterSpacing: '0.5px',
                cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace",
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#f85149'; e.currentTarget.style.color = '#f85149' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#444c56'; e.currentTarget.style.color = '#8b949e' }}
            >
              ← EXIT
            </button>
          </div>
        </div>

        {/* ── Main content ── */}
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px 60px' }}>

          {/* ── Hero Banner ── */}
          <div
            ref={bannerRef}
            onClick={handleBannerClick}
            style={{
              position: 'relative', borderRadius: '16px', overflow: 'hidden',
              height: '220px', marginBottom: '36px',
              background: 'linear-gradient(135deg, #0d1117 0%, #1a1f2e 50%, #0d1117 100%)',
              border: '1px solid #2d333b',
              cursor: 'pointer',
              boxShadow: started
                ? '0 0 40px rgba(227,179,65,0.2), inset 0 0 40px rgba(227,179,65,0.05)'
                : '0 8px 32px rgba(0,0,0,0.5)',
              transition: 'box-shadow 0.4s ease'
            }}
          >
            {/* Banner grid */}
            <div style={{
              position: 'absolute', inset: 0, opacity: 0.07,
              backgroundImage: 'linear-gradient(rgba(227,179,65,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(227,179,65,0.8) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
              animation: 'drift 12s ease-in-out infinite',
              pointerEvents: 'none'
            }} />
            {/* Banner scanline */}
            <div style={{
              position: 'absolute', left: 0, right: 0, height: '2px',
              background: 'linear-gradient(90deg, transparent, rgba(227,179,65,0.3), transparent)',
              animation: 'scanline 4s linear infinite',
              pointerEvents: 'none'
            }} />
            {/* Corner brackets */}
            {([
              { top: '12px',  left: '12px',  borderTop: true,  borderLeft: true  },
              { top: '12px',  right: '12px', borderTop: true,  borderRight: true },
              { bottom: '12px', left: '12px',  borderBottom: true, borderLeft: true  },
              { bottom: '12px', right: '12px', borderBottom: true, borderRight: true },
            ] as const).map((corner, i) => (
              <div key={i} style={{
                position: 'absolute',
                ...corner,
                width: '20px', height: '20px',
                borderTop:    (corner as any).borderTop    ? '2px solid rgba(227,179,65,0.4)' : undefined,
                borderBottom: (corner as any).borderBottom ? '2px solid rgba(227,179,65,0.4)' : undefined,
                borderLeft:   (corner as any).borderLeft   ? '2px solid rgba(227,179,65,0.4)' : undefined,
                borderRight:  (corner as any).borderRight  ? '2px solid rgba(227,179,65,0.4)' : undefined,
                pointerEvents: 'none'
              }} />
            ))}
            {/* Radial glow */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%,-50%)',
              width: '300px', height: '300px', borderRadius: '50%',
              background: started
                ? 'radial-gradient(circle, rgba(227,179,65,0.15) 0%, transparent 70%)'
                : 'radial-gradient(circle, rgba(88,166,255,0.08) 0%, transparent 70%)',
              transition: 'background 0.5s ease',
              pointerEvents: 'none'
            }} />
            {/* Click particles */}
            {particles.map(p => (
              <div key={p.id} style={{
                position: 'absolute', left: p.x, top: p.y,
                width: '60px', height: '60px', borderRadius: '50%',
                border: '2px solid rgba(227,179,65,0.8)',
                animation: 'particle-burst 0.8s ease-out forwards',
                pointerEvents: 'none'
              }} />
            ))}
            {/* Banner CTA */}
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '16px'
            }}>
              {!started ? (
                <button className="press-btn" style={{
                  background: 'transparent',
                  border: '2px solid #e3b341',
                  color: '#e3b341',
                  padding: '12px 36px', borderRadius: '8px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontWeight: 700, fontSize: '16px', letterSpacing: '3px',
                  cursor: 'pointer',
                  textShadow: '0 0 20px rgba(227,179,65,0.5)',
                }}>
                  PRESS TO START
                </button>
              ) : (
                <div style={{ textAlign: 'center', animation: 'card-in 0.4s ease' }}>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>🎯</div>
                  <div style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '18px', fontWeight: 700,
                    color: '#e3b341', letterSpacing: '2px'
                  }}>
                    CHOOSE YOUR PATH
                  </div>
                  <div style={{ fontSize: '13px', color: '#8b949e', marginTop: '6px' }}>
                    Select a difficulty level below to begin
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Level Cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
            {LEVELS.map((level, i) => {
              const unlocked = isLevelUnlocked(level.requiredXP)
              const active = started && unlocked
              const count = questCounts[level.phase] ?? '—'

              return (
                <div
                  key={level.id}
                  className="level-card"
                  onClick={() => handleLevelClick(level)}
                  style={{
                    animationDelay: `${i * 0.1 + 0.2}s`,
                    background: active
                      ? 'linear-gradient(160deg, #161b22 0%, #1c2128 100%)'
                      : '#0d1117',
                    border: `1px solid ${active ? level.color + '55' : '#21262d'}`,
                    borderRadius: '16px',
                    padding: '28px 24px',
                    cursor: active ? 'pointer' : 'not-allowed',
                    transition: 'all 0.25s ease',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: hoveredLevel === level.id && active
                      ? `0 8px 32px ${level.glowColor}, inset 0 0 20px ${level.color}08`
                      : '0 4px 12px rgba(0,0,0,0.3)',
                    transform: hoveredLevel === level.id && active ? 'translateY(-4px)' : 'none',
                    opacity: !started ? 0.7 : unlocked ? 1 : 0.5,
                  }}
                  onMouseEnter={() => setHoveredLevel(level.id)}
                  onMouseLeave={() => setHoveredLevel(null)}
                >
                  {active && hoveredLevel === level.id && (
                    <div style={{
                      position: 'absolute', inset: 0, borderRadius: '16px',
                      background: `radial-gradient(circle at 50% 0%, ${level.color}0a 0%, transparent 60%)`,
                      pointerEvents: 'none'
                    }} />
                  )}
                  {/* Top accent line */}
                  <div style={{
                    position: 'absolute', top: 0, left: '24px', right: '24px', height: '2px',
                    background: active
                      ? `linear-gradient(90deg, transparent, ${level.color}, transparent)`
                      : 'transparent',
                    borderRadius: '0 0 2px 2px',
                    transition: 'background 0.3s'
                  }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <span style={{ color: active ? level.color : '#444c56', fontSize: '14px', fontWeight: 700, transition: 'color 0.3s' }}>▶</span>
                    <span style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontWeight: 700, fontSize: '17px', letterSpacing: '0.5px',
                      color: active ? '#e6edf3' : '#484f58'
                    }}>
                      {level.title}
                    </span>
                  </div>
                  <div style={{
                    fontSize: '14px',
                    color: active ? '#8b949e' : '#30363d',
                    marginBottom: '28px', marginLeft: '24px',
                    transition: 'color 0.3s'
                  }}>
                    {level.subtitle}
                  </div>
                  {active && unlocked && (
                    <div style={{
                      fontSize: '11px', color: level.color,
                      fontFamily: "'IBM Plex Mono', monospace",
                      marginBottom: '16px', marginLeft: '24px', letterSpacing: '0.5px'
                    }}>
                      {count} {count === 1 ? 'quest' : 'quests'} available
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '56px', marginTop: 'auto' }}>
                    {unlocked ? (
                      <div style={{
                        width: '48px', height: '48px', borderRadius: '12px',
                        background: active ? `${level.color}18` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${active ? level.color + '44' : '#21262d'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '22px', transition: 'all 0.3s'
                      }}>
                        {active ? level.icon : '🔓'}
                      </div>
                    ) : (
                      <div className="lock-icon" style={{
                        width: '48px', height: '48px', borderRadius: '12px',
                        background: 'rgba(255,255,255,0.02)', border: '1px solid #21262d',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '22px'
                      }}>
                        🔒
                      </div>
                    )}
                  </div>
                  {!unlocked && (
                    <div style={{
                      textAlign: 'center', marginTop: '10px',
                      fontSize: '11px', color: '#484f58',
                      fontFamily: "'IBM Plex Mono', monospace"
                    }}>
                      Requires {level.requiredXP} XP
                    </div>
                  )}
                  {unlocked && active && (
                    <div style={{
                      position: 'absolute', top: '14px', right: '14px',
                      background: `${level.color}22`,
                      border: `1px solid ${level.color}44`,
                      borderRadius: '6px', padding: '3px 8px',
                      fontSize: '10px', fontWeight: 700, color: level.color,
                      fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.5px'
                    }}>
                      UNLOCKED
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {!started && (
            <p style={{
              textAlign: 'center', marginTop: '32px',
              color: '#484f58', fontSize: '13px',
              fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.5px'
            }}>
              Press the banner above to begin your journey
            </p>
          )}
        </div>
      </div>
    </>
  )
}