import { motion } from "motion/react";

// One easing for the whole product: quick start, long soft settle, no bounce.
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * Shared "you are here" pill that glides between navigation items. It is a
 * decorative layer behind the label; the item's aria-current carries meaning.
 * Entrances elsewhere use CSS keyframes so content can never be left hidden
 * if script-driven animation stalls.
 */
export function NavIndicator({ id }: { id: string }) {
  return (
    <motion.span
      aria-hidden="true"
      className="nav-indicator"
      layoutId={id}
      // Only animate when the selected item changes (this element remounts),
      // not when unrelated content shifts the whole navigation.
      layoutDependency={id}
      transition={{ type: "tween", duration: 0.34, ease: EASE_OUT }}
    />
  );
}
