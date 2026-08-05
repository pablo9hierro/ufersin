import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import Navbar from '../components/landing/Navbar'
import Hero from '../components/landing/Hero'
import Features from '../components/landing/Features'
import Pricing from '../components/landing/Pricing'
import HowItWorks from '../components/landing/HowItWorks'
import Demo from '../components/landing/Demo'
import FAQ from '../components/landing/FAQ'
import Contact from '../components/landing/Contact'
import Footer from '../components/landing/Footer'
import { api } from '../lib/api'
import { CmsEditProvider, usePlatformContent } from '../lib/cms'
import { useAuthReady, useIsAuthenticated, useSession } from '../lib/authStore'
import { isKnownPlatformAdminEmail } from '../lib/platformAdmin'
import { resolveSessionHome } from '../lib/sessionHome'

/**
 * Marketing `/` — lojistas (e qualquer sessão autenticada que não seja
 * superadmin) não devem ver nem transitar a landing. Superadmin pode
 * permanecer logado na landing.
 */
export default function Landing() {
  const navigate = useNavigate()
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const session = useSession()
  const { content, ready: contentReady } = usePlatformContent()
  const [allowLanding, setAllowLanding] = useState(false)

  useEffect(() => {
    if (!ready) return

    if (!isAuthenticated) {
      setAllowLanding(true)
      return
    }

    const email = session?.user?.email ?? null
    if (isKnownPlatformAdminEmail(email)) {
      setAllowLanding(true)
      return
    }

    let cancelled = false
    setAllowLanding(false)

    ;(async () => {
      try {
        await api.superadminWhoami()
        if (!cancelled) setAllowLanding(true)
      } catch {
        if (cancelled) return
        try {
          const dest = await resolveSessionHome({ email })
          if (!cancelled) navigate(dest, { replace: true })
        } catch {
          if (!cancelled) navigate('/onboarding', { replace: true })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [ready, isAuthenticated, session?.user?.email, navigate])

  if (!ready || !allowLanding || !contentReady) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }

  return (
    <CmsEditProvider editable={false} content={content}>
      <main className="min-h-screen bg-uf-black text-uf-silver">
        <Navbar />
        <Hero />
        <Features />
        <Pricing />
        <HowItWorks />
        <Demo />
        <FAQ />
        <Contact />
        <Footer />
      </main>
    </CmsEditProvider>
  )
}
