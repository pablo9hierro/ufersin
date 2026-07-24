import Navbar from '../components/landing/Navbar'
import Hero from '../components/landing/Hero'
import Features from '../components/landing/Features'
import Pricing from '../components/landing/Pricing'
import HowItWorks from '../components/landing/HowItWorks'
import Demo from '../components/landing/Demo'
import FAQ from '../components/landing/FAQ'
import Contact from '../components/landing/Contact'
import Footer from '../components/landing/Footer'

export default function Landing() {
  return (
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
  )
}
