import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { ArrowUp } from 'lucide-react'
import { Logo } from './ui/Logo'

const COLUMNS = [
  { title: 'Product', links: ['Features', 'Automations', 'Integrations', 'Pricing'] },
  { title: 'Resources', links: ['Documentation', 'Blog', 'Guides', 'API'] },
  { title: 'Company', links: ['About', 'Contact', 'Careers'] },
  { title: 'Legal', links: ['Privacy', 'Terms', 'Cookies'] },
]

export function Footer() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end end'] })
  const wordY = useTransform(scrollYProgress, [0, 1], ['40%', '0%'])

  return (
    <footer id="resources" ref={ref} className="relative overflow-hidden border-t border-line pt-20 md:pt-28">
      <div className="container-x">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-4">
            <Logo />
            <p className="mt-4 max-w-[26ch] text-[15px] leading-snug text-muted">AI-powered content automation.</p>
            <p className="mt-10 font-mono text-[11px] leading-relaxed text-dim">
              Built for people who’d
              <br />
              rather be making things.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-4 md:col-span-8">
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">{c.title}</p>
                <ul className="mt-4 space-y-2.5">
                  {c.links.map((l) => (
                    <li key={l}>
                      <a href="#top" className="group relative text-[14px] text-muted transition-colors hover:text-fg">
                        {l}
                        <span className="absolute -bottom-0.5 left-0 h-px w-full origin-right scale-x-0 bg-current transition-transform duration-500 ease-expo group-hover:origin-left group-hover:scale-x-100" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t border-line py-6 font-mono text-[11px] text-dim">
          <span>© 2026 FlowAI. All rights reserved.</span>
          <a href="#top" className="group flex items-center gap-2 uppercase tracking-[0.16em] transition-colors hover:text-fg">
            Back to top
            <ArrowUp className="size-3.5 transition-transform duration-500 ease-expo group-hover:-translate-y-1" />
          </a>
        </div>
      </div>

      <div aria-hidden className="pointer-events-none select-none overflow-hidden">
        <motion.p
          style={{ y: wordY }}
          className="-mb-[0.2em] text-center text-[27vw] font-semibold leading-[0.8] tracking-[-0.07em] text-fg/[0.06]"
        >
          FlowAI
        </motion.p>
      </div>
    </footer>
  )
}
