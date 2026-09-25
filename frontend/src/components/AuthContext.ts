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
  setUser: Dispatch<SetStateAction<ExplorerProfile | null>>
  login: (playerName: string, secretCode: string) => Promise<void>
  signup: (
    playerName: string,
    secretCode: string,
    email: string,
    userType: 'student' | 'professional',
    recaptchaToken: string
  ) => Promise<void>
  logout: () => void
  continueAsGuest: () => void
  goBack: () => void
  refreshMaintenanceMode: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
