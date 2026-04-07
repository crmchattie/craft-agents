import scrunchyLogo from "@/assets/scrunchy_logo_s.svg"

interface ScrunchyAppIconProps {
  className?: string
  size?: number
}

/**
 * ScrunchyAppIcon - Displays the Scrunchy logo ("S" icon)
 */
export function ScrunchyAppIcon({ className, size = 64 }: ScrunchyAppIconProps) {
  return (
    <img
      src={scrunchyLogo}
      alt="Scrunchy"
      width={size}
      height={size}
      className={className}
    />
  )
}

// Legacy alias
export { ScrunchyAppIcon as CraftAppIcon }
