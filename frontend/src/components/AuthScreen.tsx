import React, { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { AuthContext, useAuth } from '@/components/AuthContext'
import { DataIsolationService } from '@/services/DataIsolationService'
import { DatabaseService } from '@/services/DatabaseService'
import { supabase } from '@/services/supabase'
import type { ExplorerProfile } from '@/types'

// ─── MaintenanceGate ──────────────────────────────────────────────────────────
// Wraps the entire app. When maintenanceMode is ON, non-admin users (including
// guests and unauthenticated visitors) see a full-screen maintenance page and
// CANNOT navigate anywhere else. Admins pass through untouched.
export const MaintenanceGate: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { maintenanceMode, maintenanceMessage, isAdmin, isAuthenticated, logout } = useAuth()

  // Admins always bypass maintenance mode
  if (!maintenanceMode || isAdmin) return <>{children}</>

  // Everyone else (guests, students, professionals, unauthenticated) is blocked
  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 50% 30%, #1a0e00 0%, #0d1117 60%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
      padding: '24px',
    }}>
      <div style={{
        maxWidth: 480, width: '100%', textAlign: 'center',
        background: 'linear-gradient(160deg, #161b22 0%, #0d1117 100%)',
        border: '1px solid rgba(255,167,38,0.35)',
        borderRadius: 16, padding: '48px 40px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
      }}>
        <div style={{ fontSize: 52, marginBottom: 20 }}>🔧</div>
        <h1 style={{
          color: '#e6edf3', fontSize: 24, fontWeight: 800,
          margin: '0 0 12px', letterSpacing: '-0.5px',
        }}>
          System Maintenance
        </h1>
        <p style={{
          color: '#8b949e', fontSize: 14, lineHeight: 1.7,
          margin: '0 0 32px',
        }}>
          {maintenanceMessage || "We're currently down for scheduled maintenance. Please check back shortly."}
        </p>
        <div style={{
          background: 'rgba(255,167,38,0.08)',
          border: '1px solid rgba(255,167,38,0.25)',
          borderRadius: 8, padding: '10px 16px',
          color: '#b45309', fontSize: 12, marginBottom: 28,
        }}>
          ⚠️ Only administrators can access the system during maintenance.
        </div>
        {isAuthenticated && (
          <button
            onClick={logout}
            style={{
              background: 'transparent', border: '1px solid #30363d',
              borderRadius: 8, color: '#8b949e', fontSize: 13,
              padding: '10px 24px', cursor: 'pointer',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            ← Sign out
          </button>
        )}
      </div>
    </div>
  )
}

const settingStringValue = (value: unknown): string => {
  if (typeof value !== 'string') return String(value ?? '')
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : value
  } catch {
    return value
  }
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<ExplorerProfile | null>(null)
  const [isGuest, setIsGuest] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [impersonatingUser, setImpersonatingUser] = useState<ExplorerProfile | null>(null)
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    'System is temporarily offline for scheduled maintenance. We\'ll be back soon!'
  )

  const isAdmin = (impersonatingUser ? false : user?.isAdmin) ?? false

  const refreshMaintenanceMode = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('system_settings')
        .select('key, value')
        .in('key', ['maintenance_mode', 'maintenance_message'])
      if (!data) return
      for (const row of data) {
        if (row.key === 'maintenance_mode') {
          setMaintenanceMode(row.value === true || row.value === 'true')
        }
        if (row.key === 'maintenance_message') {
          setMaintenanceMessage(settingStringValue(row.value))
        }
      }
    } catch {
      // Table may not exist yet — fail silently
    }
  }, [])

  useEffect(() => {
    const restore = async () => {
      try {
        const guestMode = sessionStorage.getItem('guestMode')
        if (guestMode === 'true') {
          setIsGuest(true)
          setIsLoading(false)
          return
        }
        const profile = await DatabaseService.restoreSession()
        if (profile) {
          setUser(profile)
          setIsAuthenticated(true)
        }
      } catch (error) {
        console.error('Session restore failed:', error)
      } finally {
        setIsLoading(false)
      }
    }
    restore()
    refreshMaintenanceMode()

    // Poll every 60 s so users already inside get the maintenance screen
    // automatically when an admin turns it on, without needing a page refresh.
    const pollInterval = setInterval(refreshMaintenanceMode, 60_000)
    return () => clearInterval(pollInterval)
  }, [refreshMaintenanceMode])

  useEffect(() => {
    if (!user?.id || isGuest || impersonatingUser) return

    let lastTouch = 0
    const touch = () => {
      const now = Date.now()
      if (now - lastTouch < 60_000) return
      lastTouch = now
      DatabaseService.updateLastActive(user.id)
    }

    touch()
    const interval = window.setInterval(touch, 120_000)
    const onVisible = () => { if (document.visibilityState === 'visible') touch() }
    const onFocus = () => touch()

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [user?.id, isGuest, impersonatingUser])

  const login = async (playerName: string, secretCode: string) => {
    const profile = await DatabaseService.login(playerName, secretCode)
    sessionStorage.removeItem('guestMode')
    setUser(profile)
    setIsAuthenticated(true)
    setIsGuest(false)
  }

  const signup = async (
    playerName: string,
    secretCode: string,
    email: string,
    userType: 'student' | 'professional' = 'student'
  ) => {
    const profile = await DatabaseService.signUp(playerName, secretCode, email, userType)
    sessionStorage.removeItem('guestMode')
    DataIsolationService.migrateGuestToUser(profile.id)
    setUser(profile)
    setIsAuthenticated(true)
    setIsGuest(false)
  }

  const logout = () => {
    DatabaseService.logout()
    sessionStorage.removeItem('guestMode')
    setUser(null)
    setIsAuthenticated(false)
    setIsGuest(false)
    setImpersonatingUser(null)
  }

  const continueAsGuest = () => {
    sessionStorage.setItem('guestMode', 'true')
    setIsGuest(true)
    setIsAuthenticated(false)
    setUser(null)
  }

  const goBack = () => { window.history.back() }

  // Admin impersonation — stores original admin user, sets view to target.
  // The target's isAdmin is forced to false so the preview never gets
  // admin capabilities (e.g. accessing /admin while inside a preview).
  const startImpersonation = (targetUser: ExplorerProfile) => {
    if (!user?.isAdmin) return
    setImpersonatingUser(user)                          // remember real admin
    setUser({ ...targetUser, isAdmin: false })          // preview as non-admin
  }

  const stopImpersonation = () => {
    if (!impersonatingUser) return
    setUser(impersonatingUser)        // restore real admin profile
    setImpersonatingUser(null)        // clear impersonation flag
    // isAdmin derives from (impersonatingUser ? false : user?.isAdmin).
    // Once impersonatingUser is null, isAdmin will re-evaluate correctly
    // on the next render — no extra setter needed. But isAuthenticated
    // must be confirmed true so AdminRoute doesn't redirect to /home.
    setIsAuthenticated(true)
  }

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0d1117',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#8b949e', fontSize: '16px',
      }}>
        Loading CodeSense...
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{
      user, setUser, isGuest, isAuthenticated,
      isAdmin, maintenanceMode, maintenanceMessage,
      impersonatingUser,
      login, signup, logout, continueAsGuest, goBack,
      startImpersonation, stopImpersonation, refreshMaintenanceMode,
    }}>
      <MaintenanceGate>
        {children}
      </MaintenanceGate>
    </AuthContext.Provider>
  )
}
