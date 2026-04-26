import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { DataIsolationService } from '../Dataisolationservice'
import { DatabaseService } from '../services/DatabaseService'
import { supabase } from '../services/supabase'
import type { ExplorerProfile } from '../types'

interface AuthContextType {
  user: ExplorerProfile | null
  isGuest: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  maintenanceMode: boolean
  maintenanceMessage: string
  impersonatingUser: ExplorerProfile | null
  setUser: React.Dispatch<React.SetStateAction<ExplorerProfile | null>>
  login: (playerName: string, secretCode: string) => Promise<void>
  signup: (
    playerName: string,
    secretCode: string,
    email: string,
    userType?: 'student' | 'professional'
  ) => Promise<void>
  logout: () => void
  continueAsGuest: () => void
  goBack: () => void
  startImpersonation: (targetUser: ExplorerProfile) => void
  stopImpersonation: () => void
  refreshMaintenanceMode: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
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
          const msg = typeof row.value === 'string' ? row.value : JSON.stringify(row.value)
          setMaintenanceMessage(msg.replace(/^"|"$/g, ''))
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
  }, [refreshMaintenanceMode])

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

  // Admin impersonation — stores original admin user, sets view to target
  const startImpersonation = (targetUser: ExplorerProfile) => {
    if (!user?.isAdmin) return
    setImpersonatingUser(user)   // remember real admin
    setUser(targetUser)          // show UI as target user
  }

  const stopImpersonation = () => {
    if (!impersonatingUser) return
    setUser(impersonatingUser)   // restore admin
    setImpersonatingUser(null)
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
      {children}
    </AuthContext.Provider>
  )
}
