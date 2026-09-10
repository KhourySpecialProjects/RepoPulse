import { motion } from 'framer-motion'

/**
 * Intentionally blank landing page reached from the RepoPulse logo.
 * Placeholder for future dashboard content.
 */
export function HomePage() {
  return (
    <motion.div
      data-testid="home-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="min-h-screen"
    />
  )
}
