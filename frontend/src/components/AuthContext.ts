import { createContext, useContext } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ExplorerProfile } from '@/types'

export interface AuthContextType {
  user: ExplorerProfile | null
  isGuest: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  maintenanceMode: boolean
  maintenanceMessage: string
  impersonatingUser: ExplorerProfile | null
  setUser: Dispatch<SetStateAction<ExplorerProfile | null>>
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

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
