import { useCallback, useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { verifySetupToken } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import type { SetupTokenInfo } from '@/types'

const GENERIC_INVALID = 'This setup link is invalid or has expired.'

/** Prefer the server's wording, which is deliberately identical for every
 * rejection cause, and fall back to the same sentence when there is none. */
function invalidMessage(err: unknown): string {
  if (isAxiosError(err) && err.code === 'ERR_CANCELED') {
    return 'The server took too long to respond. Please reload the page.'
  }
  if (isAxiosError(err)) {
    const detail = (err.response?.data as { detail?: string } | undefined)?.detail
    if (detail) return detail
  }
  return GENERIC_INVALID
}

/**
 * Where an admin-issued setup link lands. The visitor has no credentials yet —
 * holding the token is the authority — so this route sits outside
 * ProtectedRoute and renders the sidebar-free shell that /login uses.
 */
export function AccountSetupPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { completeSetup, isAuthenticated, user } = useAuth()
  const token = searchParams.get('token') ?? ''

  const [info, setInfo] = useState<SetupTokenInfo | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const check = useCallback(async () => {
    // An absent token cannot be valid; say so without a pointless round trip.
    if (!token) {
      setLinkError(GENERIC_INVALID)
      return
    }
    try {
      setInfo(await verifySetupToken(token))
    } catch (err: unknown) {
      setLinkError(invalidMessage(err))
    }
  }, [token])

  useEffect(() => {
    void check()
  }, [check])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (password !== confirmPassword) {
      setFormError('The passwords do not match.')
      return
    }

    setIsSubmitting(true)
    try {
      await completeSetup(token, password, githubToken.trim())
      navigate('/')
    } catch (err: unknown) {
      // The link can go stale between loading this page and submitting it.
      setFormError(invalidMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const error = linkError ?? formError

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-orchid-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-orchid-600 shadow-lg mb-4">
            <span className="text-2xl font-bold text-white">R</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">RepoPulse</h1>
          <p className="text-muted-foreground mt-1">Set up your account</p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {linkError ? (
          <Card>
            <CardHeader>
              <CardTitle>Link unusable</CardTitle>
              <CardDescription>
                Setup links expire and can only be used once. Ask an administrator to send
                you a new one.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to="/login"
                className="text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                Back to sign in
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Choose a password</CardTitle>
              <CardDescription>
                {info
                  ? `Welcome, ${info.display_name} — pick a password for ${info.email}.`
                  : 'Checking your link...'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* An admin opening their own generated link would otherwise be
                  swapped to the new account without warning. */}
              {isAuthenticated && (
                <p className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                  You are already signed in as {user?.display_name}. Finishing setup will
                  replace that session.
                </p>
              )}
              {info && (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="new-password" className="text-sm font-medium">
                      New Password
                    </label>
                    <div className="relative">
                      <Input
                        id="new-password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={8}
                        autoComplete="new-password"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="confirm-password" className="text-sm font-medium">
                      Confirm Password
                    </label>
                    <Input
                      id="confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={8}
                      autoComplete="new-password"
                    />
                  </div>
                  {/* Optional, and asked for here because this is the only
                      moment the recipient is identified without an admin in
                      the room. Blank leaves any existing token untouched. */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="github-token" className="text-sm font-medium">
                      GitHub Token <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <Input
                      id="github-token"
                      type="password"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder="ghp_..."
                      autoComplete="off"
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Lets RepoPulse clone and sync repositories on your behalf. You can
                      add or change this later in Settings.
                    </p>
                  </div>
                  <Button
                    type="submit"
                    loading={isSubmitting}
                    disabled={isSubmitting}
                    className="w-full"
                  >
                    {isSubmitting ? 'Setting up...' : 'Set Password'}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}
      </motion.div>
    </div>
  )
}
