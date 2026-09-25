import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AccountRoute, AdminRoute, ProtectedRoute } from '@/routes/guards'

type MockAuth = {
  isAuthenticated: boolean
  isGuest: boolean
  isAdmin: boolean
}

let authState: MockAuth = {
  isAuthenticated: false,
  isGuest: false,
  isAdmin: false,
}

vi.mock('@/components/AuthContext', () => ({
  useAuth: () => authState,
}))

function setAuth(next: Partial<MockAuth>) {
  authState = {
    isAuthenticated: false,
    isGuest: false,
    isAdmin: false,
    ...next,
  }
}

function renderGuard(route: React.ReactElement, initialPath = '/target') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/target" element={route} />
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/signup" element={<div>signup page</div>} />
        <Route path="/home" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('route guards', () => {
  describe('ProtectedRoute', () => {
    it('redirects unauthenticated non-guests to login', () => {
      setAuth({})
      renderGuard(<ProtectedRoute><div>protected content</div></ProtectedRoute>)
      expect(screen.getByText('login page')).toBeInTheDocument()
    })

    it('allows guest sessions', () => {
      setAuth({ isGuest: true })
      renderGuard(<ProtectedRoute><div>protected content</div></ProtectedRoute>)
      expect(screen.getByText('protected content')).toBeInTheDocument()
    })

    it('allows authenticated users', () => {
      setAuth({ isAuthenticated: true })
      renderGuard(<ProtectedRoute><div>protected content</div></ProtectedRoute>)
      expect(screen.getByText('protected content')).toBeInTheDocument()
    })
  })

  describe('AccountRoute', () => {
    it('redirects unauthenticated users to signup', () => {
      setAuth({})
      renderGuard(<AccountRoute><div>account content</div></AccountRoute>)
      expect(screen.getByText('signup page')).toBeInTheDocument()
    })

    it('redirects guest users to signup', () => {
      setAuth({ isGuest: true })
      renderGuard(<AccountRoute><div>account content</div></AccountRoute>)
      expect(screen.getByText('signup page')).toBeInTheDocument()
    })

    it('allows authenticated non-guest users', () => {
      setAuth({ isAuthenticated: true })
      renderGuard(<AccountRoute><div>account content</div></AccountRoute>)
      expect(screen.getByText('account content')).toBeInTheDocument()
    })
  })

  describe('AdminRoute', () => {
    it('redirects unauthenticated users to login', () => {
      setAuth({})
      renderGuard(<AdminRoute><div>admin content</div></AdminRoute>)
      expect(screen.getByText('login page')).toBeInTheDocument()
    })

    it('redirects authenticated non-admins to home', () => {
      setAuth({ isAuthenticated: true })
      renderGuard(<AdminRoute><div>admin content</div></AdminRoute>)
      expect(screen.getByText('home page')).toBeInTheDocument()
    })

    it('allows authenticated admins', () => {
      setAuth({ isAuthenticated: true, isAdmin: true })
      renderGuard(<AdminRoute><div>admin content</div></AdminRoute>)
      expect(screen.getByText('admin content')).toBeInTheDocument()
    })

  })
})
