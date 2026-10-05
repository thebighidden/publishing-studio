export type Bezier = [number, number, number, number]

/** Long, soft deceleration. Used for almost every reveal on the page. */
export const ease: Bezier = [0.22, 1, 0.36, 1]
/** Symmetric curve for curtains and panels that move across the screen. */
export const easeInOut: Bezier = [0.76, 0, 0.24, 1]
