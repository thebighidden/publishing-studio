import { useRef, type ElementType, type HTMLAttributes, type ReactNode } from 'react'
import { motion, useInView, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { ease } from '../../lib/motion'
import { cn } from '../../lib/cn'

/** Italic serif accent used inside headlines. Extra props (data-thread…) pass straight through. */
export function Serif({ children, className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...rest} className={cn('font-serif font-normal italic tracking-[-0.01em] pr-[0.04em]', className)}>
      {children}
    </span>
  )
}

type LineRevealProps = {
  lines: ReactNode[]
  as?: ElementType
  className?: string
  lineClassName?: string
  delay?: number
  /** Force the animation state (the hero waits for the preloader). Defaults to in-view. */
  play?: boolean
}

/**
 * Each line slides up from behind a mask. The in-view check sits on the parent:
 * the lines start fully clipped, so observing them directly would never fire.
 */
export function LineReveal({ lines, as: Tag = 'h2', className, lineClassName, delay = 0, play }: LineRevealProps) {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -12% 0px' })
  const show = play ?? inView

  return (
    <Tag ref={ref} className={className}>
      {lines.map((line, i) => (
        <span key={i} className={cn('-mb-[0.12em] block overflow-hidden pb-[0.12em]', lineClassName)}>
          <motion.span
            className="block will-change-transform"
            initial={{ y: '108%' }}
            animate={{ y: show ? '0%' : '108%' }}
            transition={{ duration: 1.15, ease, delay: delay + i * 0.09 }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  )
}

type RevealProps = {
  children: ReactNode
  className?: string
  delay?: number
  y?: number
  as?: 'div' | 'li' | 'p' | 'span' | 'figure'
}

export function Reveal({ children, className, delay = 0, y = 28, as = 'div' }: RevealProps) {
  const Comp = motion[as]
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.9, ease, delay }}
    >
      {children}
    </Comp>
  )
}

export type Word = { text: string; serif?: boolean; mark?: boolean }

/**
 * Words brighten one by one as the paragraph travels up the viewport.
 * Consecutive `mark` words are wrapped together so the drawn line can find them (`markProps`).
 */
export function ScrollWords({
  words,
  className,
  markProps,
}: {
  words: Word[]
  className?: string
  markProps?: Record<string, string>
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.9', 'end 0.45'] })

  const render = (w: Word, i: number, space = true) => (
    <ScrollWord
      key={i}
      progress={scrollYProgress}
      range={[i / words.length, (i + 1) / words.length]}
      serif={w.serif}
      space={space}
    >
      {w.text}
    </ScrollWord>
  )

  const out: ReactNode[] = []
  for (let i = 0; i < words.length; i++) {
    if (!words[i].mark) {
      out.push(render(words[i], i))
      continue
    }
    const group: ReactNode[] = []
    const first = i
    while (i < words.length && words[i].mark) {
      group.push(render(words[i], i, words[i + 1]?.mark === true))
      i++
    }
    i--
    // The space after the group sits outside it, so the line can still break there.
    out.push(
      <span key={`m${first}`} {...markProps} className="whitespace-nowrap">
        {group}
      </span>,
      ' ',
    )
  }

  return (
    <p ref={ref} className={className}>
      {out}
    </p>
  )
}

function ScrollWord({
  progress,
  range,
  serif,
  space = true,
  children,
}: {
  progress: MotionValue<number>
  range: [number, number]
  serif?: boolean
  space?: boolean
  children: string
}) {
  const opacity = useTransform(progress, range, [0.14, 1])
  return (
    <>
      <motion.span style={{ opacity }} className={serif ? 'font-serif font-normal italic tracking-normal' : undefined}>
        {children}
      </motion.span>
      {space && ' '}
    </>
  )
}
