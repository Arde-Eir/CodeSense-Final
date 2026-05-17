import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './components/AuthScreen'
import { supabase } from './services/supabase'
import { getLevelProgress, getXPToNextLevel, getLevelName, XP_LEVELS, calculateLevel } from './types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileData {
  playername: string
  email: string
  totalxp: number
  currentlevel: number
  sandbox_runs: number
  charactertype: string | null
  user_type: string | null
  createdat: string
}

interface LeaderboardEntry {
  rank: number
  userid: string
  users: { playername: string } | null
  totalxp: number
}

interface ReportEntry {
  id: string
  type: string
  createdat: string
  mode_context: string
  cognitive_complexity: number | null
}

interface QuestEntry {
  questid: string
  completedat: string | null
  first_completed_at?: string | null
  updatedat?: string | null
  status?: string | null
  hintsused: number
  quests: { title: string } | { title: string }[] | null
}

interface FastQuestEntry {
  questid: string
  completion_time_seconds: number
  quests: { title: string } | null
}

interface ActivityLogEntry {
  id:         string
  type:       string
  title:      string
  description:string
  xp_gained:  number
  createdat:  string
  meta:       Record<string, unknown>
}

const fmtTime = (s: number): string =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

const isCompletedMissionRow = (row: { first_completed_at?: string | null; status?: string | null }) =>
  Boolean(row.first_completed_at || row.status === 'completed')

const missionDoneAt = (row: { first_completed_at?: string | null; completedat?: string | null }) =>
  row.first_completed_at ?? row.completedat ?? null

const countUniqueCompletedQuests = (rows: { questid?: string | null; id?: string | null; first_completed_at?: string | null; status?: string | null }[]) =>
  new Set(rows.filter(isCompletedMissionRow).map(row => row.questid ?? row.id)).size

// ─── Achievements definition ──────────────────────────────────────────────────

interface Achievement {
  id: string
  icon: string
  title: string
  desc: string
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  check: (p: ProfileData, questCount: number) => boolean
}

const ACHIEVEMENTS: Achievement[] = [
  { id: 'joined',     icon: '🌱', title: 'First Boot',      desc: 'Joined the CodeSense academy',              rarity: 'common',    check: () => true },
  { id: 'run1',       icon: '🔬', title: 'First Analysis',  desc: 'Run your first sandbox analysis',           rarity: 'common',    check: p => p.sandbox_runs >= 1 },
  { id: 'run10',      icon: '⚗️', title: 'Lab Regular',     desc: 'Complete 10 sandbox analyses',              rarity: 'common',    check: p => p.sandbox_runs >= 10 },
  { id: 'run25',      icon: '🧪', title: 'Code Scientist',  desc: 'Complete 25 sandbox analyses',              rarity: 'rare',      check: p => p.sandbox_runs >= 25 },
  { id: 'run50',      icon: '🔭', title: 'Master Analyst',  desc: 'Complete 50 sandbox analyses',              rarity: 'epic',      check: p => p.sandbox_runs >= 50 },
  { id: 'quest1',     icon: '⚔️', title: 'First Quest',     desc: 'Complete your first campaign quest',        rarity: 'common',    check: (_, qc) => qc >= 1 },
  { id: 'quest5',     icon: '🛡️', title: 'Quest Knight',    desc: 'Complete 5 campaign quests',                rarity: 'rare',      check: (_, qc) => qc >= 5 },
  { id: 'quest10',    icon: '🏆', title: 'Quest Champion',  desc: 'Complete 10 campaign quests',               rarity: 'epic',      check: (_, qc) => qc >= 10 },
  { id: 'xp5000',     icon: '⚔️', title: 'Rising Knight',   desc: 'Earn 5,000 XP and reach Knight rank',      rarity: 'common',    check: p => p.totalxp >= 5000 },
  { id: 'xp20000',    icon: '🌟', title: 'Noble Lord',      desc: 'Earn 20,000 XP and reach Lord rank',       rarity: 'rare',      check: p => p.totalxp >= 20000 },
  { id: 'xp75000',    icon: '👑', title: 'Grand Duke',      desc: 'Earn 75,000 XP and reach Duke rank',       rarity: 'epic',      check: p => p.totalxp >= 75000 },
  { id: 'xp250000',   icon: '🔱', title: 'Legendary King',  desc: 'Amass 250,000 XP and claim the crown',     rarity: 'legendary', check: p => p.totalxp >= 250000 },
]

const RARITY_STYLE: Record<Achievement['rarity'], { color: string; glow: string; bg: string; label: string }> = {
  common:    { color: '#8b949e', glow: 'rgba(139,148,158,0.3)',  bg: 'rgba(139,148,158,0.08)', label: 'Common'    },
  rare:      { color: '#58a6ff', glow: 'rgba(88,166,255,0.35)',  bg: 'rgba(88,166,255,0.08)',  label: 'Rare'      },
  epic:      { color: '#a371f7', glow: 'rgba(163,113,247,0.4)',  bg: 'rgba(163,113,247,0.08)', label: 'Epic'      },
  legendary: { color: '#ffc107', glow: 'rgba(255,193,7,0.45)',   bg: 'rgba(255,193,7,0.1)',    label: 'Legendary' },
}

const CHAR_META: Record<string, { icon: string; color: string; desc: string; unlockLevel: 1|2|3|4|5 }> = {
  squire: { icon: '🛡️', color: '#8b949e', desc: 'Beginner path — learning the basics',       unlockLevel: 1 },
  knight: { icon: '⚔️', color: '#58a6ff', desc: 'Intermediate — sharpen your skills',         unlockLevel: 2 },
  lord:   { icon: '🌟', color: '#a371f7', desc: 'Advanced — rise above the ranks',            unlockLevel: 3 },
  duke:   { icon: '👑', color: '#e3b341', desc: 'Elite — a title of true mastery',           unlockLevel: 4 },
  king:   { icon: '🔱', color: '#ffd700', desc: 'Supreme — the highest title of the realm',   unlockLevel: 5 },
}
const TITLE_ORDER = ['squire', 'knight', 'lord', 'duke', 'king'] as const

const MODE_COLOR: Record<string, string> = {
  sandbox: '#4caf50', campaign: '#ffa726',
}

// ─── Global animation styles ─────────────────────────────────────────────────

const PROFILE_STYLES = `
  @keyframes profileFadeUp { from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)} }
  @keyframes shimmer { 0%,100%{opacity:1}50%{opacity:0.55} }
  @keyframes spinOnce { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
  @keyframes badgeUnlock { 0%{transform:scale(0.6);opacity:0}60%{transform:scale(1.15)}100%{transform:scale(1);opacity:1} }
  .prof-tab { transition:color 0.18s,border-color 0.18s,background 0.18s; }
  .prof-tab:hover { color:#e6edf3 !important; background:rgba(255,255,255,0.05) !important; }
  .prof-badge { transition:transform 0.2s,box-shadow 0.2s; cursor:default; }
  .prof-badge.unlocked:hover { transform:translateY(-4px) scale(1.04); }
  .prof-action-card { transition:transform 0.2s,box-shadow 0.2s,border-color 0.2s; cursor:pointer; }
  .prof-action-card:hover { transform:translateY(-4px); box-shadow:0 12px 32px rgba(0,0,0,0.4) !important; }
  .prof-action-card:active { transform:translateY(-1px) scale(0.98); }
  .prof-stat-chip { transition:background 0.15s,transform 0.15s; }
  .prof-stat-chip:hover { background:rgba(255,255,255,0.07) !important; transform:translateY(-2px); }
  .prof-input:focus { border-color:#58a6ff !important; box-shadow:0 0 0 3px rgba(88,166,255,0.12) !important; outline:none; }
  .prof-danger-btn:hover { background:rgba(248,81,73,0.15) !important; border-color:#f85149 !important; }
`

// ─── Main Component ───────────────────────────────────────────────────────────

export const ProfileSettings: React.FC = () => {
  const navigate = useNavigate()
  const { user, setUser } = useAuth()

  // Core profile state
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [myRank, setMyRank] = useState<number | null>(null)
  const [questsCompleted, setQuestsCompleted] = useState(0)
  const [reports, setReports] = useState<ReportEntry[]>([])
  const [completedQuests, setCompletedQuests] = useState<QuestEntry[]>([])
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [fastestQuests, setFastestQuests] = useState<FastQuestEntry[]>([])

  // Image state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [bannerUrl, setBannerUrl] = useState<string | null>(null)
  const [cropModalOpen, setCropModalOpen] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 })
  const [cropScale, setCropScale] = useState(1)
  const cropCanvasRef = useRef<HTMLCanvasElement>(null)
  const cropImageRef = useRef<HTMLImageElement | null>(null)
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })

  // UI state
  const [activeTab, setActiveTab] = useState<'overview' | 'achievements' | 'activity' | 'settings' | 'learn'>('overview')
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [loading, setLoading] = useState(true)

  // Settings tab state
  const [editCharType, setEditCharType] = useState('')
  const [editUserType, setEditUserType] = useState<'student' | 'professional'>('student')
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwMsg, setPwMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  // Prevent layout.css overflow:hidden from clipping the page
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')]
    els.forEach(el => { if (el) el.style.overflow = 'auto' })
    return () => { els.forEach(el => { if (el) el.style.overflow = '' }) }
  }, [])

  // Fix crop drag-stuck bug when mouse leaves window
  useEffect(() => {
    if (!cropModalOpen) return
    const stop = () => { isDragging.current = false }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [cropModalOpen])

  // Inject styles
  useEffect(() => {
    const id = 'profile-styles'
    if (!document.getElementById(id)) {
      const tag = document.createElement('style'); tag.id = id; tag.textContent = PROFILE_STYLES
      document.head.appendChild(tag)
    }
  }, [])

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    fetchAll()
  }, [user?.id])

  const fetchAll = useCallback(async () => {
    if (!user) return
    try {
      // Profile
      const { data: prof } = await supabase
        .from('users')
        .select('playername, email, totalxp, currentlevel, sandbox_runs, charactertype, user_type, createdat')
        .eq('id', user.id).single()
      if (prof) {
        setProfile(prof)
        setEditName(prof.playername)
        setEditEmail(prof.email ?? '')
        setEditCharType(prof.charactertype ?? 'squire')
        setEditUserType((prof.user_type as any) ?? 'student')
      }

      // Leaderboard
      const { data: lb } = await supabase
        .from('users').select('id, playername, totalxp, currentlevel')
        .eq('isactive', true).order('totalxp', { ascending: false }).limit(10)
      if (lb) {
        setLeaderboard(lb.map((u: any, i: number) => ({ rank: i + 1, userid: u.id, totalxp: u.totalxp, users: { playername: u.playername } })))
        const myPos = lb.findIndex((u: any) => u.id === user.id)
        if (myPos !== -1) { setMyRank(myPos + 1) }
        else {
          const { count } = await supabase.from('users').select('*', { count: 'exact', head: true })
            .eq('isactive', true).gt('totalxp', prof?.totalxp ?? 0)
          setMyRank((count ?? 0) + 1)
        }
      }

      // Quests completed. first_completed_at survives retakes, so it is the
      // durable completion signal; status='completed' remains a legacy fallback.
      const { data: progressRows } = await supabase.from('mission_progress')
        .select('id, questid, status, first_completed_at')
        .eq('userid', user.id)
      setQuestsCompleted(countUniqueCompletedQuests((progressRows ?? []) as any[]))

      // Recent completed quests for activity
      const { data: cq } = await supabase.from('mission_progress')
        .select('questid, status, completedat, first_completed_at, updatedat, hintsused, quests(title)')
        .eq('userid', user.id)
        .order('updatedat', { ascending: false }).limit(40)
      const recentCompleted = ((cq ?? []) as unknown as QuestEntry[])
        .filter(isCompletedMissionRow)
        .filter(q => Boolean(missionDoneAt(q)))
        .sort((a, b) => new Date(missionDoneAt(b)!).getTime() - new Date(missionDoneAt(a)!).getTime())
        .slice(0, 15)
      setCompletedQuests(recentCompleted)

      // Fastest quest completions
      const { data: fq } = await supabase
        .from('mission_progress')
        .select('questid, completion_time_seconds, quests(title)')
        .eq('userid', user.id)
        .not('completion_time_seconds', 'is', null)
        .order('completion_time_seconds', { ascending: true })
        .limit(10)
      setFastestQuests((fq as any[]) ?? [])

      // Recent reports (kept for stats counters)
      const { data: reps } = await supabase.from('reports')
        .select('id, type, createdat, mode_context, cognitive_complexity')
        .eq('userid', user.id).order('createdat', { ascending: false }).limit(20)
      setReports((reps ?? []) as ReportEntry[])

      // Activity log — primary feed source
      const { data: al } = await supabase
        .from('activity_log')
        .select('id, type, title, description, xp_gained, createdat, meta')
        .eq('userid', user.id)
        .order('createdat', { ascending: false })
        .limit(30)
      setActivityLog((al ?? []) as ActivityLogEntry[])

      // Avatar
      const { data: avatarFiles } = await supabase.storage.from('Avatars').list(user.id, { limit: 10 })
      const af = avatarFiles?.find(f => f.id && f.name && !f.name.includes('banner') && f.metadata?.mimetype?.startsWith('image/'))
        ?? avatarFiles?.find(f => f.id && f.name && f.name !== 'banner')
      if (af) {
        const { data: ud } = supabase.storage.from('Avatars').getPublicUrl(`${user.id}/${af.name}`)
        setAvatarUrl(ud.publicUrl)
      }

      // Banner
      const { data: bannerFiles } = await supabase.storage.from('Avatars').list(`${user.id}/banner`, { limit: 1 })
      if (bannerFiles && bannerFiles.length > 0) {
        const { data: ud } = supabase.storage.from('Avatars').getPublicUrl(`${user.id}/banner/${bannerFiles[0].name}`)
        setBannerUrl(ud.publicUrl)
      }
    } catch (e) { console.error('Profile fetch error:', e) }
    finally { setLoading(false) }
  }, [user])

  // ── Image handling ────────────────────────────────────────────────────────

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !user) return
    if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2 MB'); e.target.value = ''; return }
    const reader = new FileReader()
    reader.onload = ev => { setCropImageSrc(ev.target?.result as string); setCropOffset({ x: 0, y: 0 }); setCropScale(1); setCropModalOpen(true) }
    reader.readAsDataURL(file); e.target.value = ''
  }

  const drawCrop = () => {
    const canvas = cropCanvasRef.current, img = cropImageRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const size = 280; canvas.width = size; canvas.height = size; ctx.clearRect(0, 0, size, size)
    ctx.save(); ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip()
    const sw = img.naturalWidth * cropScale, sh = img.naturalHeight * cropScale
    ctx.drawImage(img, (size - sw) / 2 + cropOffset.x, (size - sh) / 2 + cropOffset.y, sw, sh)
    ctx.restore(); ctx.strokeStyle = '#4caf50'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); ctx.stroke()
  }

  const handleCropConfirm = async () => {
    const canvas = cropCanvasRef.current; if (!canvas || !user) return
    setUploadingAvatar(true); setCropModalOpen(false)
    canvas.toBlob(async blob => {
      if (!blob) { setUploadingAvatar(false); return }
      try {
        const path = `${user.id}/avatar.webp`
        await supabase.storage.from('Avatars').upload(path, blob, { upsert: true, contentType: 'image/webp' })
        const { data } = supabase.storage.from('Avatars').getPublicUrl(path)
        setAvatarUrl(data.publicUrl + '?t=' + Date.now())
      } catch (e) { console.error(e) }
      finally { setUploadingAvatar(false) }
    }, 'image/webp', 0.92)
  }

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !user) return
    setUploadingBanner(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${user.id}/banner/banner.${ext}`
      await supabase.storage.from('Avatars').upload(path, file, { upsert: true })
      const { data } = supabase.storage.from('Avatars').getPublicUrl(path)
      setBannerUrl(data.publicUrl + '?t=' + Date.now())
    } catch (e) { console.error(e) }
    finally { setUploadingBanner(false) }
  }

  // ── Save profile ──────────────────────────────────────────────────────────

  const handleSaveProfile = async () => {
    if (!user) return; setSaving(true)
    try {
      await supabase.from('users').update({ playername: editName, email: editEmail }).eq('id', user.id)
      setProfile(prev => prev ? { ...prev, playername: editName, email: editEmail } : prev)
      setIsEditing(false); flashSave('Profile updated!')
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }

  const handleSaveSettings = async () => {
    if (!user || !profile) return; setSaving(true)
    try {
      await supabase.from('users').update({ charactertype: editCharType, user_type: editUserType }).eq('id', user.id)
      setProfile(prev => prev ? { ...prev, charactertype: editCharType, user_type: editUserType } : prev)
      if (user) setUser({ ...user, characterType: editCharType as any, userType: editUserType })
      flashSave('Settings saved!')
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }

  const handleChangePassword = async () => {
    setPwMsg(null)
    if (!pwCurrent) { setPwMsg({ text: 'Enter your current password', ok: false }); return }
    if (!pwNew || pwNew.length < 8) { setPwMsg({ text: 'New password must be at least 8 characters', ok: false }); return }
    if (pwNew !== pwConfirm) { setPwMsg({ text: 'Passwords do not match', ok: false }); return }
    setSaving(true)
    try {
      const { error: reAuthErr } = await supabase.auth.signInWithPassword({
        email: profile!.email, password: pwCurrent,
      })
      if (reAuthErr) { setPwMsg({ text: 'Current password is incorrect', ok: false }); return }
      const { error } = await supabase.auth.updateUser({ password: pwNew })
      if (error) { setPwMsg({ text: error.message, ok: false }) }
      else { setPwMsg({ text: 'Password changed successfully!', ok: true }); setPwCurrent(''); setPwNew(''); setPwConfirm('') }
    } catch (e: any) { setPwMsg({ text: e.message, ok: false }) }
    finally { setSaving(false) }
  }

  const flashSave = (msg: string) => { setSaveMsg(msg); setTimeout(() => setSaveMsg(''), 3500) }

  // ── Derived values ────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px', animation: 'shimmer 1.5s ease infinite' }}>⚙️</div>
        <div>Loading profile...</div>
      </div>
    </div>
  )
  if (!profile) return null

  const derivedLevel = calculateLevel(profile.totalxp) as 1 | 2 | 3 | 4 | 5
  const levelName = getLevelName(derivedLevel)
  const levelProgress = getLevelProgress(profile.totalxp)
  const xpToNext = getXPToNextLevel(profile.totalxp)
  const memberSince = new Date(profile.createdat).toLocaleDateString([], { year: 'numeric', month: 'long' })
  const unlockedCount = ACHIEVEMENTS.filter(a => a.check(profile, questsCompleted)).length

  const TABS = [
    { id: 'overview',      label: '📋 Overview'     },
    { id: 'achievements',  label: '🏅 Achievements'  },
    { id: 'activity',      label: '📈 Activity'      },
    { id: 'settings',      label: '⚙️ Settings'      },
    { id: 'learn',         label: '📚 Learn'         },
  ] as const

  // Activity feed — prefer activity_log rows; fall back to manual merge when empty
  const TYPE_ICON: Record<string, string> = {
    sandbox_run:      '🔬',
    report_generated: '🔬',
    quest_completed:  '⚔️',
    quest_started:    '📖',
    level_up:         '🏆',
  }
  const TYPE_COLOR: Record<string, string> = {
    sandbox_run:      '#58a6ff',
    report_generated: '#58a6ff',
    quest_completed:  '#ffa726',
    quest_started:    '#3fb950',
    level_up:         '#e3b341',
  }

  const activityFeed = activityLog.length > 0
    ? activityLog.map(e => ({
        key:   `al-${e.id}`,
        date:  e.createdat,
        icon:  TYPE_ICON[e.type] ?? '📌',
        title: e.title,
        sub:   e.description || (e.xp_gained > 0 ? `+${e.xp_gained} XP` : ''),
        color: TYPE_COLOR[e.type] ?? '#8b949e',
      }))
    // Fallback: derive feed from reports + mission_progress while activity_log is empty
    : [
        ...reports.map(r => ({
          key: `r-${r.id}`, date: r.createdat, icon: '🔬',
          title: `${r.mode_context === 'campaign' ? 'Campaign' : 'Sandbox'} analysis`,
          sub: r.cognitive_complexity != null ? `Complexity score: ${r.cognitive_complexity}` : r.type,
          color: MODE_COLOR[r.mode_context] ?? '#8b949e',
        })),
        ...completedQuests.map(q => {
          const questTitle = Array.isArray(q.quests) ? q.quests[0]?.title : q.quests?.title
          const completedAt = missionDoneAt(q) ?? ''
          return {
            key: `q-${q.questid}`, date: completedAt, icon: '⚔️',
            title: `Quest completed: ${questTitle ?? 'Unknown'}`,
            sub: q.hintsused > 0 ? `${q.hintsused} hint${q.hintsused > 1 ? 's' : ''} used` : 'No hints used 🎯',
            color: '#ffa726',
          }
        }),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 25)

  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      background: 'linear-gradient(135deg, #0d1117 0%, #1a1f2e 100%)',
      color: 'white', fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    }}>
      <style>{`
        @media (max-width: 768px) {
          .ps-header {
            padding: 10px 14px !important;
            flex-wrap: wrap !important;
            gap: 8px !important;
          }
          .ps-header-actions { display: none !important; }
          .ps-main-grid {
            grid-template-columns: 1fr !important;
            padding: 14px !important;
            gap: 14px !important;
            max-width: 100% !important;
          }
          .ps-sidebar { order: -1; }
          .prof-tab {
            padding: 10px 14px !important;
            font-size: 13px !important;
            min-height: 44px !important;
          }
          .prof-stats-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          .prof-stat-chip {
            padding: 16px 8px !important;
          }
        }
      `}</style>
      <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleAvatarUpload} />
      <input ref={bannerInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleBannerUpload} />

      {/* ── Crop Modal ── */}
      {cropModalOpen && cropImageSrc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '16px', padding: '28px', width: '360px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <h3 style={{ color: '#e6edf3', margin: 0, fontSize: '16px', fontWeight: '700' }}>Crop Profile Picture</h3>
            <p style={{ color: '#8b949e', fontSize: '12px', margin: 0, textAlign: 'center' }}>Drag to reposition · Scroll to zoom</p>
            <div style={{ position: 'relative', cursor: 'grab', userSelect: 'none' }}>
              <img ref={cropImageRef} src={cropImageSrc} onLoad={drawCrop} style={{ display: 'none' }} alt="" />
              <canvas ref={cropCanvasRef} width={280} height={280}
                style={{ borderRadius: '50%', display: 'block', border: '2px solid #4caf50' }}
                onMouseDown={e => { isDragging.current = true; dragStart.current = { x: e.clientX - cropOffset.x, y: e.clientY - cropOffset.y } }}
                onMouseMove={e => { if (!isDragging.current) return; setCropOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }); setTimeout(drawCrop, 0) }}
                onWheel={e => { e.preventDefault(); setCropScale(prev => { const n = Math.min(4, Math.max(0.3, prev - e.deltaY * 0.001)); setTimeout(drawCrop, 0); return n }) }}
              />
            </div>
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ color: '#8b949e', fontSize: '12px' }}>🔍</span>
              <input type="range" min={0.3} max={4} step={0.01} value={cropScale}
                onChange={e => { setCropScale(parseFloat(e.target.value)); setTimeout(drawCrop, 0) }}
                style={{ flex: 1, accentColor: '#4caf50' }} />
              <span style={{ color: '#8b949e', fontSize: '11px', minWidth: '36px' }}>{Math.round(cropScale * 100)}%</span>
            </div>
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button onClick={() => setCropModalOpen(false)} style={{ flex: 1, background: 'transparent', border: '1px solid #30363d', color: '#8b949e', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
              <button onClick={handleCropConfirm} style={{ flex: 1, background: '#4caf50', border: 'none', color: 'white', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>✓ Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Nav ── */}
      <header className="ps-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', background: 'rgba(22,27,34,0.95)', borderBottom: '1px solid #21262d', position: 'sticky', top: 0, zIndex: 100, backdropFilter: 'blur(8px)' }}>
        <button onClick={() => navigate('/home')} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          ← Dashboard
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#8b949e', fontSize: '13px', fontWeight: '500' }}>Profile Settings</span>
          {saveMsg && <span style={{ color: '#4caf50', fontSize: '12px', fontWeight: '600', animation: 'profileFadeUp 0.3s ease' }}>✓ {saveMsg}</span>}
        </div>
        <div className="ps-header-actions" style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => navigate('/sandbox')} style={{ background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.3)', color: '#4caf50', padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>🔬 Sandbox</button>
          <button onClick={() => navigate('/campaign')} style={{ background: 'rgba(255,167,38,0.1)', border: '1px solid rgba(255,167,38,0.3)', color: '#ffa726', padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>⚔️ Campaign</button>
        </div>
      </header>

      <div className="ps-main-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px', padding: '24px', maxWidth: '1100px', margin: '0 auto', boxSizing: 'border-box' }}>

        {/* ── LEFT ── */}
        <div style={{ minWidth: 0 }}>
          <div style={{ background: 'rgba(22,27,34,0.9)', border: '1px solid #21262d', borderRadius: '16px', overflow: 'hidden', animation: 'profileFadeUp 0.4s ease' }}>

            {/* Banner */}
            <div onClick={() => bannerInputRef.current?.click()} style={{ height: '160px', position: 'relative', cursor: 'pointer', background: bannerUrl ? `url(${bannerUrl}) center/cover no-repeat` : 'linear-gradient(135deg, #0d2a0d 0%, #1a3a1a 40%, #0d1a2a 100%)' }}>
              {!bannerUrl && <div style={{ position: 'absolute', inset: 0, opacity: 0.15, backgroundImage: 'linear-gradient(rgba(76,175,80,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(76,175,80,0.3) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />}
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0')}>
                <span style={{ color: 'white', fontSize: '13px', fontWeight: '600', background: 'rgba(0,0,0,0.65)', padding: '7px 16px', borderRadius: '8px' }}>{uploadingBanner ? '⏳ Uploading…' : '📷 Change Background'}</span>
              </div>
            </div>

            {/* Profile header */}
            <div style={{ padding: '0 24px 24px', position: 'relative' }}>
              {/* Avatar */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', marginTop: '-48px', marginBottom: '18px' }}>
                <div onClick={() => avatarInputRef.current?.click()} style={{ width: '96px', height: '96px', borderRadius: '50%', cursor: 'pointer', border: '4px solid #161b22', overflow: 'hidden', position: 'relative', background: avatarUrl ? 'transparent' : 'linear-gradient(135deg, #4caf50, #2d7a2d)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {avatarUrl ? <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '36px', fontWeight: '700', color: 'white' }}>{profile.playername.charAt(0).toUpperCase()}</span>}
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', opacity: 0, transition: 'opacity 0.2s' }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0')}>
                    <span style={{ fontSize: '20px' }}>{uploadingAvatar ? '⏳' : '📷'}</span>
                  </div>
                </div>
                <div style={{ flex: 1, paddingBottom: '4px' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input value={editName} onChange={e => setEditName(e.target.value)} className="prof-input" style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '7px 12px', color: 'white', fontSize: '16px', fontWeight: '700', width: '200px', transition: 'border-color 0.2s,box-shadow 0.2s' }} />
                      <button onClick={handleSaveProfile} disabled={saving} style={{ background: '#4caf50', border: 'none', color: 'white', padding: '7px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>{saving ? '…' : '✓ Save'}</button>
                      <button onClick={() => setIsEditing(false)} style={{ background: 'transparent', border: '1px solid #30363d', color: '#8b949e', padding: '7px 14px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div>
                        <div style={{ fontSize: '22px', fontWeight: '800', color: '#e6edf3' }}>{profile.playername}</div>
                        <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '2px' }}>@{profile.playername.toLowerCase().replace(/\s+/g, '')} · {levelName}</div>
                      </div>
                      <button onClick={() => setIsEditing(true)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid #30363d', color: '#e6edf3', padding: '5px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>✏️ Edit</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Badge strip */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '18px' }}>
                <span style={{ background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.3)', color: '#4caf50', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700' }}>
                  {CHAR_META[profile.charactertype ?? 'squire']?.icon} {profile.charactertype ?? 'Squire'}
                </span>
                <span style={{ background: 'rgba(100,181,246,0.1)', border: '1px solid rgba(100,181,246,0.25)', color: '#64b5f6', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700' }}>
                  {profile.user_type === 'professional' ? '💼 Professional' : '🎓 Student'}
                </span>
                <span style={{ background: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.25)', color: '#ffc107', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700' }}>
                  ⭐ {profile.totalxp} XP
                </span>
                <span style={{ background: 'rgba(163,113,247,0.1)', border: '1px solid rgba(163,113,247,0.25)', color: '#a371f7', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700' }}>
                  🏅 {unlockedCount}/{ACHIEVEMENTS.length} badges
                </span>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid #21262d', marginBottom: '20px', gap: '2px', overflowX: 'auto' }}>
                {TABS.map(t => (
                  <button key={t.id} className="prof-tab" onClick={() => setActiveTab(t.id)}
                    style={{ background: activeTab === t.id ? 'rgba(76,175,80,0.08)' : 'transparent', border: 'none', borderBottom: `2px solid ${activeTab === t.id ? '#4caf50' : 'transparent'}`, color: activeTab === t.id ? '#4caf50' : '#8b949e', padding: '9px 16px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: '8px 8px 0 0', marginBottom: '-1px' }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* ── OVERVIEW TAB ── */}
              {activeTab === 'overview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', animation: 'profileFadeUp 0.3s ease' }}>

                  {/* XP Progress bar */}
                  <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '12px', padding: '18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '700' }}>Rank Progress</span>
                      <span style={{ color: '#ffc107', fontSize: '13px', fontWeight: '700' }}>{levelName}</span>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '8px', height: '10px', overflow: 'hidden', marginBottom: '6px' }}>
                      <div style={{ width: `${levelProgress}%`, height: '100%', background: 'linear-gradient(90deg,#4caf50,#66bb6a)', borderRadius: '8px', transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '10px', color: '#484f58' }}>{profile.totalxp} XP earned</span>
                      <span style={{ fontSize: '10px', color: '#ffc107', fontWeight: '600' }}>{xpToNext === null ? '🌟 MAX RANK' : `${xpToNext} XP to next`}</span>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="prof-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                    {[
                      { icon: '⭐', value: profile.totalxp,    label: 'Total XP',   color: '#ffc107' },
                      { icon: '🔬', value: profile.sandbox_runs, label: 'Analyses',  color: '#4caf50' },
                      { icon: '⚔️', value: questsCompleted,    label: 'Quests',     color: '#ffa726' },
                      { icon: '🏆', value: myRank ? `#${myRank}` : '—', label: 'Rank', color: '#a371f7' },
                    ].map(s => (
                      <div key={s.label} className="prof-stat-chip" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #30363d', borderRadius: '10px', padding: '14px 8px', textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', marginBottom: '5px' }}>{s.icon}</div>
                        <div style={{ color: s.color, fontSize: '20px', fontWeight: '800' }}>{s.value}</div>
                        <div style={{ color: '#484f58', fontSize: '10px', marginTop: '2px' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* About — only fields not shown in the badge strip above */}
                  <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '12px', padding: '18px' }}>
                    <div style={{ color: '#8b949e', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '12px' }}>About</div>
                    {[
                      { label: 'Member since', value: memberSince,              icon: '📅' },
                      { label: 'Email',        value: profile.email ?? 'Not set', icon: '📧' },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #21262d' }}>
                        <span style={{ color: '#8b949e', fontSize: '12px' }}>{item.icon} {item.label}</span>
                        <span style={{ color: '#e6edf3', fontSize: '12px', fontWeight: '500' }}>{item.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Fastest completions */}
                  {fastestQuests.length > 0 && (
                    <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '12px', padding: '18px' }}>
                      <div style={{ color: '#8b949e', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '12px' }}>⚡ Fastest Completions</div>
                      {fastestQuests.map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: i < fastestQuests.length - 1 ? '1px solid #21262d' : 'none' }}>
                          <span style={{ fontSize: '10px', color: '#484f58', fontFamily: 'monospace', minWidth: 20 }}>#{i + 1}</span>
                          <span style={{ flex: 1, fontSize: '12px', color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                            {(r.quests as any)?.title ?? r.questid}
                          </span>
                          <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#3fb950', fontWeight: 700 }}>
                            {fmtTime(r.completion_time_seconds)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── ACHIEVEMENTS TAB ── */}
              {activeTab === 'achievements' && (
                <div style={{ animation: 'profileFadeUp 0.3s ease' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ color: '#8b949e', fontSize: '13px' }}>
                      <span style={{ color: '#4caf50', fontWeight: '700' }}>{unlockedCount}</span> / {ACHIEVEMENTS.length} unlocked
                    </div>
                    <div style={{ background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.25)', borderRadius: '20px', padding: '3px 12px' }}>
                      <span style={{ color: '#4caf50', fontSize: '11px', fontWeight: '700' }}>{Math.round((unlockedCount / ACHIEVEMENTS.length) * 100)}% complete</span>
                    </div>
                  </div>
                  {/* Overall progress bar */}
                  <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '6px', height: '6px', marginBottom: '20px', overflow: 'hidden' }}>
                    <div style={{ width: `${(unlockedCount / ACHIEVEMENTS.length) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #4caf50, #ffc107)', borderRadius: '6px', transition: 'width 1s ease' }} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    {ACHIEVEMENTS.map(ach => {
                      const unlocked = ach.check(profile, questsCompleted)
                      const rs = RARITY_STYLE[ach.rarity]
                      return (
                        <div key={ach.id} className={`prof-badge ${unlocked ? 'unlocked' : ''}`} style={{
                          background: unlocked ? rs.bg : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${unlocked ? rs.color + '55' : '#21262d'}`,
                          borderRadius: '12px', padding: '14px',
                          boxShadow: unlocked ? `0 0 12px ${rs.glow}` : 'none',
                          opacity: unlocked ? 1 : 0.5,
                          animation: unlocked ? 'badgeUnlock 0.5s ease' : 'none',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ fontSize: '28px', filter: unlocked ? 'none' : 'grayscale(1)', flexShrink: 0 }}>{ach.icon}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ color: unlocked ? rs.color : '#484f58', fontSize: '13px', fontWeight: '700', marginBottom: '2px' }}>{ach.title}</div>
                              <div style={{ color: '#8b949e', fontSize: '11px', lineHeight: 1.4 }}>{ach.desc}</div>
                              <div style={{ marginTop: '5px' }}>
                                <span style={{ fontSize: '9px', fontWeight: '700', letterSpacing: '0.8px', textTransform: 'uppercase', padding: '2px 7px', borderRadius: '10px', background: unlocked ? rs.bg : 'rgba(255,255,255,0.05)', color: unlocked ? rs.color : '#484f58', border: `1px solid ${unlocked ? rs.color + '44' : 'transparent'}` }}>
                                  {rs.label}
                                </span>
                                {unlocked && <span style={{ fontSize: '10px', color: '#4caf50', marginLeft: '6px', fontWeight: '600' }}>✓ Unlocked</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── ACTIVITY TAB ── */}
              {activeTab === 'activity' && (
                <div style={{ animation: 'profileFadeUp 0.3s ease' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <span style={{ color: '#8b949e', fontSize: '13px' }}>Last {activityFeed.length} actions</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <span style={{ fontSize: '11px', background: 'rgba(76,175,80,0.1)', color: '#4caf50', padding: '2px 8px', borderRadius: '6px' }}>🔬 {reports.length} analyses</span>
                      <span style={{ fontSize: '11px', background: 'rgba(255,167,38,0.1)', color: '#ffa726', padding: '2px 8px', borderRadius: '6px' }}>⚔️ {questsCompleted} quests</span>
                    </div>
                  </div>
                  {activityFeed.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: '#484f58' }}>
                      <div style={{ fontSize: '36px', marginBottom: '12px' }}>📭</div>
                      <div style={{ fontSize: '13px' }}>No activity yet — start analysing code!</div>
                      <button onClick={() => navigate('/sandbox')} style={{ marginTop: '14px', background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.3)', color: '#4caf50', padding: '8px 20px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>Open Sandbox →</button>
                    </div>
                  ) : (
                    <div style={{ position: 'relative' }}>
                      {/* Timeline line */}
                      <div style={{ position: 'absolute', left: '19px', top: 0, bottom: 0, width: '2px', background: 'rgba(255,255,255,0.06)' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {activityFeed.map((item, i) => (
                          <div key={item.key} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', padding: '8px 0', position: 'relative', animation: `profileFadeUp 0.3s ease ${i * 0.03}s both` }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: `${item.color}22`, border: `2px solid ${item.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1, fontSize: '16px' }}>
                              {item.icon}
                            </div>
                            <div style={{ flex: 1, paddingTop: '4px' }}>
                              <div style={{ color: '#e6edf3', fontSize: '13px', fontWeight: '600' }}>{item.title}</div>
                              <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '2px' }}>{item.sub}</div>
                            </div>
                            <div style={{ color: '#484f58', fontSize: '10px', paddingTop: '5px', whiteSpace: 'nowrap' }}>
                              {item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── SETTINGS TAB ── */}
              {activeTab === 'settings' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', animation: 'profileFadeUp 0.3s ease' }}>

                  {/* Displayed Title */}
                  <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '12px', padding: '18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                      <div style={{ color: '#8b949e', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Displayed Title</div>
                      <div style={{ color: '#484f58', fontSize: '10px' }}>Unlocks through XP</div>
                    </div>
                    <p style={{ color: '#8b949e', fontSize: '12px', margin: '0 0 14px', lineHeight: 1.5 }}>
                      Everyone starts as a <b style={{ color: '#e6edf3' }}>Squire</b>. New titles unlock as you level up — choose which unlocked title to display.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginBottom: '14px' }}>
                      {TITLE_ORDER.map(ct => {
                        const meta = CHAR_META[ct]
                        const unlocked = derivedLevel >= meta.unlockLevel
                        const active = editCharType === ct && unlocked
                        return (
                          <button
                            key={ct}
                            disabled={!unlocked}
                            onClick={() => unlocked && setEditCharType(ct)}
                            style={{
                              padding: '12px', position: 'relative',
                              background: active ? `${meta.color}18` : unlocked ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)',
                              border: `1px solid ${active ? meta.color : unlocked ? '#30363d' : '#21262d'}`,
                              borderRadius: '10px',
                              color: active ? meta.color : unlocked ? '#8b949e' : '#484f58',
                              cursor: unlocked ? 'pointer' : 'not-allowed',
                              textAlign: 'left', transition: 'all 0.15s',
                              opacity: unlocked ? 1 : 0.55,
                            }}
                          >
                            <div style={{ fontSize: '20px', marginBottom: '4px', filter: unlocked ? 'none' : 'grayscale(1)' }}>{meta.icon}</div>
                            <div style={{ fontSize: '13px', fontWeight: '700', textTransform: 'capitalize' }}>{ct}</div>
                            <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '2px' }}>{meta.desc.split('—')[0]}</div>
                            {!unlocked && (
                              <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.6)', border: '1px solid #30363d', borderRadius: '6px', padding: '2px 6px', fontSize: '9px', color: '#8b949e', fontWeight: '700', letterSpacing: '0.4px' }}>
                                🔒 Lv {meta.unlockLevel}
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ color: '#8b949e', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '10px' }}>I am a</div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                      {(['student', 'professional'] as const).map(ut => (
                        <button key={ut} onClick={() => setEditUserType(ut)} style={{ flex: 1, padding: '10px', background: editUserType === ut ? 'rgba(76,175,80,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${editUserType === ut ? '#4caf50' : '#30363d'}`, borderRadius: '8px', color: editUserType === ut ? '#4caf50' : '#8b949e', fontSize: '12px', fontWeight: '700', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px', transition: 'all 0.15s' }}>
                          {ut === 'student' ? '🎓 Student' : '💼 Professional'}
                        </button>
                      ))}
                    </div>
                    <button onClick={handleSaveSettings} disabled={saving} style={{ background: '#4caf50', border: 'none', color: 'white', padding: '9px 22px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
                      {saving ? 'Saving…' : '✓ Save Preferences'}
                    </button>
                  </div>

                  {/* Change password */}
                  <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '12px', padding: '18px' }}>
                    <div style={{ color: '#8b949e', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '14px' }}>Change Password</div>
                    {[
                      { label: 'Current password', val: pwCurrent, set: setPwCurrent },
                      { label: 'New password (min 8 chars)', val: pwNew, set: setPwNew },
                      { label: 'Confirm new password', val: pwConfirm, set: setPwConfirm },
                    ].map(f => (
                      <div key={f.label} style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'block', color: '#484f58', fontSize: '11px', fontWeight: '600', marginBottom: '5px' }}>{f.label}</label>
                        <input type="password" value={f.val} onChange={e => f.set(e.target.value)} className="prof-input"
                          style={{ width: '100%', background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '9px 12px', color: 'white', fontSize: '13px', boxSizing: 'border-box', transition: 'border-color 0.2s,box-shadow 0.2s' }} />
                      </div>
                    ))}
                    {pwMsg && <div style={{ color: pwMsg.ok ? '#4caf50' : '#f85149', fontSize: '12px', marginBottom: '10px' }}>{pwMsg.ok ? '✓ ' : '⚠ '}{pwMsg.text}</div>}
                    <button onClick={handleChangePassword} disabled={saving} style={{ background: 'rgba(88,166,255,0.12)', border: '1px solid rgba(88,166,255,0.35)', color: '#58a6ff', padding: '9px 22px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
                      🔑 Update Password
                    </button>
                  </div>

                  {/* Danger zone */}
                  <div style={{ background: 'rgba(248,81,73,0.04)', border: '1px solid rgba(248,81,73,0.25)', borderRadius: '12px', padding: '18px' }}>
                    <div style={{ color: '#f85149', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '10px' }}>⚠️ Danger Zone</div>
                    {!showDeleteConfirm ? (
                      <div>
                        <p style={{ color: '#8b949e', fontSize: '12px', marginBottom: '12px', lineHeight: 1.6 }}>
                          Permanently delete your account and all associated data. This cannot be undone.
                        </p>
                        <button className="prof-danger-btn" onClick={() => setShowDeleteConfirm(true)} style={{ background: 'transparent', border: '1px solid rgba(248,81,73,0.35)', color: '#f85149', padding: '8px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s' }}>
                          Delete My Account
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p style={{ color: '#f85149', fontSize: '12px', marginBottom: '10px', fontWeight: '600' }}>
                          Type your username <strong>"{profile.playername}"</strong> to confirm deletion:
                        </p>
                        <input value={deleteInput} onChange={e => setDeleteInput(e.target.value)} className="prof-input"
                          style={{ width: '100%', background: '#161b22', border: '1px solid rgba(248,81,73,0.4)', borderRadius: '8px', padding: '9px 12px', color: 'white', fontSize: '13px', boxSizing: 'border-box', marginBottom: '10px', transition: 'border-color 0.2s' }} />
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button disabled={deleteInput !== profile.playername} onClick={async () => {
                            await supabase.auth.signOut()
                            navigate('/', { replace: true })
                          }} style={{ background: deleteInput === profile.playername ? '#f85149' : 'rgba(248,81,73,0.15)', border: 'none', color: 'white', padding: '8px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: deleteInput === profile.playername ? 'pointer' : 'not-allowed', opacity: deleteInput === profile.playername ? 1 : 0.5 }}>
                            Confirm Delete
                          </button>
                          <button onClick={() => { setShowDeleteConfirm(false); setDeleteInput('') }} style={{ background: 'transparent', border: '1px solid #30363d', color: '#8b949e', padding: '8px 14px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── LEARN TAB ── */}
              {activeTab === 'learn' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', animation: 'profileFadeUp 0.3s ease' }}>
                  <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '12px', padding: '18px' }}>
                    <div style={{ color: '#8b949e', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '14px' }}>Rank Progression Path</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {([1, 2, 3, 4, 5] as const).map(lvl => {
                        const name = getLevelName(lvl), threshold = XP_LEVELS[lvl].minXP
                        const isReached = profile.totalxp >= threshold, isCurrent = derivedLevel === lvl
                        return (
                          <div key={lvl} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 14px', borderRadius: '10px', background: isCurrent ? 'rgba(76,175,80,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isCurrent ? 'rgba(76,175,80,0.35)' : '#21262d'}` }}>
                            <span style={{ fontSize: '22px' }}>{lvl === 1 ? '🛡️' : lvl === 2 ? '⚔️' : lvl === 3 ? '🌟' : lvl === 4 ? '👑' : '🔱'}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '13px', fontWeight: '700', color: isReached ? '#4caf50' : '#484f58' }}>{name}</div>
                              <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '1px' }}>Requires {threshold.toLocaleString()} XP</div>
                            </div>
                            {isCurrent && <span style={{ fontSize: '10px', color: '#4caf50', fontWeight: '700', background: 'rgba(76,175,80,0.15)', padding: '3px 10px', borderRadius: '10px' }}>CURRENT</span>}
                            {isReached && !isCurrent && <span style={{ fontSize: '16px' }}>✅</span>}
                            {!isReached && <span style={{ fontSize: '10px', color: '#484f58' }}>🔒</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: '12px', padding: '18px' }}>
                    <div style={{ color: '#8b949e', fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '12px' }}>How to Earn XP</div>
                    {[
                      { action: 'Complete a campaign quest',  xp: '+Base XP (varies)', icon: '⚔️' },
                      { action: 'Complete without hints',      xp: 'Bonus XP',          icon: '🎯' },
                      { action: 'Run sandbox analysis',        xp: 'Activity tracked',  icon: '🔬' },
                    ].map(tip => (
                      <div key={tip.action} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px solid #21262d' }}>
                        <span style={{ fontSize: '18px' }}>{tip.icon}</span>
                        <span style={{ flex: 1, fontSize: '12px', color: '#e6edf3' }}>{tip.action}</span>
                        <span style={{ fontSize: '11px', color: '#4caf50', fontWeight: '600' }}>{tip.xp}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <div className="ps-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Share stats card */}
          <div style={{ background: 'linear-gradient(135deg, rgba(76,175,80,0.12), rgba(100,181,246,0.08))', border: '1px solid rgba(76,175,80,0.25)', borderRadius: '14px', padding: '16px' }}>
            <div style={{ color: '#4caf50', fontSize: '12px', fontWeight: '700', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>📣 My Stats</div>
            <div style={{ color: '#e6edf3', fontSize: '12px', lineHeight: 1.7, fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '10px' }}>
              🧠 CodeSense · {levelName}<br />
              ⭐ {profile.totalxp} XP · #{myRank ?? '?'} ranked<br />
              🔬 {profile.sandbox_runs} analyses<br />
              ⚔️ {questsCompleted} quests done<br />
              🏅 {unlockedCount}/{ACHIEVEMENTS.length} badges
            </div>
            <button onClick={() => { navigator.clipboard.writeText(`🧠 CodeSense | ${levelName}\n⭐ ${profile.totalxp} XP · #${myRank ?? '?'} ranked\n🔬 ${profile.sandbox_runs} analyses · ⚔️ ${questsCompleted} quests\n🏅 ${unlockedCount}/${ACHIEVEMENTS.length} badges`).then(() => flashSave('Stats copied!')) }} style={{ marginTop: '10px', width: '100%', background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.3)', color: '#4caf50', padding: '7px', borderRadius: '7px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>
              📋 Copy to Clipboard
            </button>
          </div>

          {/* Leaderboard */}
          <div style={{ background: 'rgba(22,27,34,0.9)', border: '1px solid #21262d', borderRadius: '14px', padding: '18px' }}>
            <h3 style={{ color: '#e6edf3', fontSize: '12px', fontWeight: '700', margin: '0 0 12px', letterSpacing: '1px', textTransform: 'uppercase' }}>🏆 Leaderboard</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {leaderboard.map((entry, i) => {
                const isMe = entry.userid === user?.id
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 8px', borderRadius: '8px', background: isMe ? 'rgba(76,175,80,0.1)' : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', border: isMe ? '1px solid rgba(76,175,80,0.3)' : '1px solid transparent' }}>
                    <span style={{ fontSize: medal ? '14px' : '10px', minWidth: '20px', textAlign: 'center', color: '#8b949e', fontWeight: '700' }}>{medal ?? `#${i + 1}`}</span>
                    <span style={{ flex: 1, fontSize: '11px', color: isMe ? '#4caf50' : '#e6edf3', fontWeight: isMe ? '700' : '400', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(entry.users as any)?.playername ?? '?'}{isMe && <span style={{ fontSize: '9px', marginLeft: '4px', opacity: 0.7 }}>(you)</span>}
                    </span>
                    <span style={{ fontSize: '10px', color: '#ffc107', fontWeight: '700' }}>{entry.totalxp}</span>
                  </div>
                )
              })}
              {myRank && myRank > 10 && (
                <div style={{ marginTop: '4px', padding: '6px 8px', borderRadius: '7px', background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.2)', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '10px', color: '#4caf50' }}>Your rank: #{myRank}</span>
                  <span style={{ fontSize: '10px', color: '#ffc107' }}>{profile.totalxp} XP</span>
                </div>
              )}
            </div>
            <button onClick={() => navigate('/leaderboard')} style={{ marginTop: '10px', width: '100%', background: 'transparent', border: '1px solid rgba(255,193,7,0.3)', color: '#ffc107', padding: '8px', borderRadius: '7px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>
              View Full Leaderboard →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
