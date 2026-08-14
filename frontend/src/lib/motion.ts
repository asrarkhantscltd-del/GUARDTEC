import type { Variants } from "framer-motion"

/**
 * Shared animation primitives.
 *
 * The easing curve must be a fixed-length tuple, not `number[]` — framer-motion's
 * `Easing` type only accepts a 4-tuple cubic bezier, so a plain array literal
 * fails to type-check where it is used in a `Variants` object.
 */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const

/** Builds a container/item variant pair for staggered list entrances. */
export function makeStagger(staggerChildren = 0.06, duration = 0.4): {
  container: Variants
  item: Variants
} {
  return {
    container: { animate: { transition: { staggerChildren } } },
    item: {
      initial: { opacity: 0, y: 16, scale: 0.97 },
      animate: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { duration, ease: EASE_OUT_EXPO },
      },
    },
  }
}

/** Default stagger used by most list/grid views. */
export const stagger = makeStagger()
