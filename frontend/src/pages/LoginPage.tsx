import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { GraduationCap, BookOpen, Shield, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface MockUser {
  id: string
  name: string
  role: string
  icon: React.ReactNode
  description: string
}

const MOCK_USERS: MockUser[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Instructor Mark',
    role: 'Instructor',
    icon: <GraduationCap className="h-6 w-6" />,
    description: 'Full access to all collections and analytics',
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'TA Sarah',
    role: 'Teaching Assistant',
    icon: <BookOpen className="h-6 w-6" />,
    description: 'View collections and add notes',
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    name: 'Admin Alex',
    role: 'Administrator',
    icon: <Shield className="h-6 w-6" />,
    description: 'System settings and user management',
  },
]

export function LoginPage() {
  const navigate = useNavigate()
  const { devLogin, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleDevLogin(userId: string) {
    setLoadingUserId(userId)
    setError(null)
    try {
      await devLogin(userId)
      navigate('/')
    } catch (err: unknown) {
      const axiosError = err as { response?: { status?: number } }
      if (axiosError?.response?.status === 403) {
        setError('Dev login is not available. Please use email and password.')
      } else {
        setError('Login failed. Please try again.')
      }
    } finally {
      setLoadingUserId(null)
    }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await login(email, password)
      navigate('/')
    } catch {
      setError('Invalid email or password.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg mb-4">
            <span className="text-2xl font-bold text-white">R</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">RepoPulse</h1>
          <p className="text-muted-foreground mt-1">Monitor student repositories at a glance</p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <p className="text-center text-sm text-muted-foreground mb-1">Sign in as</p>
          {MOCK_USERS.map((mockUser, index) => (
            <motion.div
              key={mockUser.id}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.07, duration: 0.25 }}
            >
              <Card
                className={cn(
                  'cursor-pointer bg-white border border-border hover:shadow-md hover:border-indigo-200 transition-all duration-200',
                  loadingUserId === mockUser.id && 'opacity-60 pointer-events-none'
                )}
                onClick={() => handleDevLogin(mockUser.id)}
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-100 to-violet-100 text-indigo-600">
                    {mockUser.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{mockUser.name}</div>
                    <div className="text-xs text-muted-foreground">{mockUser.role}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{mockUser.description}</div>
                  </div>
                  {loadingUserId === mockUser.id && (
                    <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-3 text-muted-foreground">
              Or sign in with email
            </span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
            <CardDescription>Enter your credentials to access RepoPulse</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
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
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
