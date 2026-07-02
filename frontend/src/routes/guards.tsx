import type React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/components/AuthContext'

export const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isGuest } = useAuth()
  if (!isAuthenticated && !isGuest) return <Navigate to="/login" replace />
  return children
}

export const AccountRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isGuest } = useAuth()
  if (!isAuthenticated || isGuest) return <Navigate to="/signup" replace />
  return children
}

export const AdminRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isAdmin } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/home" replace />
  return children
}
