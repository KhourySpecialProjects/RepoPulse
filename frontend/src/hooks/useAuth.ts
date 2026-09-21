import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  completeAccountSetup as apiCompleteAccountSetup,
  devLogin as apiDevLogin,
  login as apiLogin,
  setAuthToken,
  clearAuthToken,
} from '@/services/api'
import type { TokenResponse, User, UserRole } from '@/types'

interface AuthUser {
  id: string
  display_name: string
  role: UserRole
  email?: string
}

interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  devLogin: (userId: string) => Promise<void>
  completeSetup: (token: string, newPassword: string, githubToken?: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function parseStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('auth_user')
    if (!raw) return null
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const storedUser = parseStoredUser()
    const token = localStorage.getItem('auth_token')
    if (storedUser && token) {
      setUser(storedUser)
    }
    setIsLoading(false)
  }, [])

  /**
   * Adopt a freshly issued token as the current session.
   *
   * Shared by every way in — password login, dev login, and completing account
   * setup — so a new entry point cannot forget a step. `queryClient.clear()`
   * is one of them: without it the previous user's cached data is served to
   * the next one (see AuthCacheIsolation.test.tsx).
   */
  const applyToken = useCallback((tokenResponse: TokenResponse) => {
    const authUser: AuthUser = {
      id: tokenResponse.user_id,
      display_name: tokenResponse.display_name,
      role: tokenResponse.role,
    }
    setAuthToken(tokenResponse.access_token)
    localStorage.setItem('auth_user', JSON.stringify(authUser))
    queryClient.clear()
    setUser(authUser)
  }, [queryClient])

  const login = useCallback(async (email: string, password: string) => {
    applyToken(await apiLogin(email, password))
  }, [applyToken])

  const devLogin = useCallback(async (userId: string) => {
    applyToken(await apiDevLogin(userId))
  }, [applyToken])

  const completeSetup = useCallback(
    async (token: string, newPassword: string, githubToken?: string) => {
      applyToken(await apiCompleteAccountSetup(token, newPassword, githubToken))
    },
    [applyToken]
  )

  const logout = useCallback(() => {
    clearAuthToken()
    queryClient.clear()
    setUser(null)
  }, [queryClient])

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    login,
    devLogin,
    completeSetup,
    logout,
  }

  return React.createElement(AuthContext.Provider, { value }, children)
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}

// Keep User type import used for potential future reference
export type { User }
