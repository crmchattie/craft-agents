interface ScrunchyLogoProps {
  className?: string
}

/**
 * Scrunchy text logo - uses accent color from theme
 * Apply text-accent class to get the brand purple color
 */
export function ScrunchyLogo({ className }: ScrunchyLogoProps) {
  return (
    <svg
      viewBox="0 0 180 30"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y="24"
        fill="currentColor"
        fontFamily="'Inter', system-ui, sans-serif"
        fontWeight="700"
        fontSize="28"
        letterSpacing="-0.5"
      >
        Scrunchy
      </text>
    </svg>
  )
}
