// Thematic marker icons as own components (decisions/stack): ONLY where
// lucide has no fitting glyph. Everything else — chevrons, search, copy,
// bookmark, pin, dice, gem, pen, fork — comes from lucide-react.
// Icons render in currentColor; callers set size and color.

import type { SVGProps } from "react";

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * Wordmark/app icon: open book with a spark (brass on anthracite), ported
 * from the design prototype (design/Grimoire.dc.html `ic('logo')`) — the
 * same glyph as design/grimoire-icon.svg.
 */
export function IconLogo({ size = 16, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="block flex-none"
      {...rest}
    >
      <path d="M12 10.5c-2.4-2.4-5.8-3.2-8.8-3.2v11.6c3 0 6.4.8 8.8 3.2 2.4-2.4 5.8-3.2 8.8-3.2V7.3c-3 0-6.4.8-8.8 3.2z" />
      <path d="M12 10.5v11.6" />
      <path d="M12 .8l1.3 2.6 2.6 1.3-2.6 1.3L12 8.6l-1.3-2.6-2.6-1.3 2.6-1.3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The scene's AI brainstorming: a speech bubble with the logo's spark in it.
 * Lucide has no chat bubble with a sparkle; the bubble is lucide's own
 * `message-circle`, the spark the one of IconLogo.
 */
export function IconChatSpark({ size = 16, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="block flex-none"
      {...rest}
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      <path d="M12 7.6l1.4 2.9 2.9 1.4-2.9 1.4L12 16.2l-1.4-2.9-2.9-1.4 2.9-1.4z" fill="currentColor" stroke="none" />
    </svg>
  );
}
