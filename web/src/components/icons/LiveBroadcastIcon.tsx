import React from 'react'

interface LiveBroadcastIconProps {
  className?: string
}

/**
 * "Live" broadcast glyph (center dot + two pairs of signal arcs). Uses
 * `currentColor`; pair with the `.live-reveal-icon` class for the radar sweep.
 */
export const LiveBroadcastIcon: React.FC<LiveBroadcastIconProps> = ({ className }) => (
  <svg
    viewBox="8 0 32 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <circle cx="24" cy="12" r="3" fill="currentColor" />
    <path d="M17.5 7.5a9 9 0 0 0 0 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M30.5 7.5a9 9 0 0 1 0 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M13 4a13 13 0 0 0 0 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M35 4a13 13 0 0 1 0 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)
