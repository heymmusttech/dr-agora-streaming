// Ported verbatim from drlive-frontend/tailwind.config.mjs (container-queries plugin dropped).
import tailwindcssAnimate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  plugins: [
    tailwindcssAnimate,
    function ({ addComponents }) {
      addComponents({
        '.container': {
          paddingTop: '1rem',
          paddingBottom: '1rem',
          '@media (min-width: 1024px)': {
            paddingTop: '1.5rem',
            paddingBottom: '1.5rem',
            paddingRight: '1.5rem',
            paddingLeft: '1.5rem',
          },
        },
      })
    },
  ],
  prefix: '',
  safelist: [
    'lg:col-span-4',
    'lg:col-span-6',
    'lg:col-span-8',
    'lg:col-span-12',
    'border-outline-variant',
    'bg-surface-1',
    'border-error',
    'bg-error/30',
    'border-tertiary',
    'bg-tertiary/30',
    'border-support-orange',
    'bg-support-orange/30',
    {
      pattern: /^bg-on-surface-variant\/(10|12|20|30)$/,
      variants: ['hover', 'active'],
    },
  ],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {},
    },
    extend: {
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        blink: 'blink 2s ease-in-out infinite',
        'indeterminate-bar': 'indeterminate-bar 1.1s ease-in-out infinite',
        'note-in': 'note-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        nudge: 'nudge 320ms cubic-bezier(0.36, 0.07, 0.19, 0.97)',
      },
      opacity: {
        12: '0.12',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        /* ============================================
           NEW COLOR SYSTEM TOKENS
           HSL format with alpha-value support
           Usage: bg-surface/50, text-on-surface-variant/12
           ============================================ */

        /* Surface Colors */
        surface: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          1: 'hsl(var(--surface-1) / <alpha-value>)',
          2: 'hsl(var(--surface-2) / <alpha-value>)',
          3: 'hsl(var(--surface-3) / <alpha-value>)',
          4: 'hsl(var(--surface-4) / <alpha-value>)',
          5: 'hsl(var(--surface-5) / <alpha-value>)',
          '1-85': 'hsl(var(--surface-1-85) / <alpha-value>)',
          container: 'hsl(var(--surface-container) / <alpha-value>)',
          neutral: 'hsl(var(--surface-neutral) / <alpha-value>)',
        },
        'on-surface-neutral': 'hsl(var(--on-surface-neutral) / <alpha-value>)',

        /* Primary Colors */
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          container: 'hsl(var(--primary-container) / <alpha-value>)',
        },
        'on-primary': {
          DEFAULT: 'hsl(var(--on-primary) / <alpha-value>)',
          container: 'hsl(var(--on-primary-container) / <alpha-value>)',
        },

        /* Secondary Colors */
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          container: 'hsl(var(--secondary-container) / <alpha-value>)',
          alt: 'hsl(var(--secondary-alt) / <alpha-value>)',
          'container-alt': 'hsl(var(--secondary-container-alt) / <alpha-value>)',
        },
        'on-secondary': {
          DEFAULT: 'hsl(var(--on-secondary) / <alpha-value>)',
          container: 'hsl(var(--on-secondary-container) / <alpha-value>)',
          alt: 'hsl(var(--on-secondary-alt) / <alpha-value>)',
          'container-alt': 'hsl(var(--on-secondary-container-alt) / <alpha-value>)',
        },

        /* Tertiary Colors */
        tertiary: {
          DEFAULT: 'hsl(var(--tertiary) / <alpha-value>)',
          container: 'hsl(var(--tertiary-container) / <alpha-value>)',
        },
        'on-tertiary': {
          DEFAULT: 'hsl(var(--on-tertiary) / <alpha-value>)',
          container: 'hsl(var(--on-tertiary-container) / <alpha-value>)',
        },

        /* Error Colors */
        error: {
          DEFAULT: 'hsl(var(--error) / <alpha-value>)',
          container: 'hsl(var(--error-container) / <alpha-value>)',
        },
        'on-error': {
          DEFAULT: 'hsl(var(--on-error) / <alpha-value>)',
          container: 'hsl(var(--on-error-container) / <alpha-value>)',
        },

        /* Won / leading marks (the design's green, same in both themes) */
        success: '#00874C',

        /* Background & Foreground */
        background: 'hsl(var(--background) / <alpha-value>)',
        'on-background': 'hsl(var(--on-background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',

        /* Outline & Borders */
        outline: {
          DEFAULT: 'hsl(var(--outline) / <alpha-value>)',
          variant: 'hsl(var(--outline-variant) / <alpha-value>)',
        },
        'border-alt': 'hsl(var(--border-alt) / <alpha-value>)',

        /* Surface Variants */
        'surface-variant': {
          DEFAULT: 'hsl(var(--surface-variant) / <alpha-value>)',
          custom: 'hsl(var(--surface-variant-custom) / <alpha-value>)',
        },
        'on-surface': 'hsl(var(--on-surface) / <alpha-value>)',
        'on-surface-variant': 'hsl(var(--on-surface-variant) / <alpha-value>)',

        /* Inverse Colors */
        'inverse-surface': 'hsl(var(--inverse-surface) / <alpha-value>)',
        'inverse-on-surface': 'hsl(var(--inverse-on-surface) / <alpha-value>)',
        'inverse-primary': 'hsl(var(--inverse-primary) / <alpha-value>)',

        /* Scrim (Overlays) - keep as-is, already has opacity */
        scrim: {
          DEFAULT: 'var(--scrim)',
          90: 'var(--scrim-variant-90)',
          75: 'var(--scrim-variant-75)',
        },

        /* Support Orange */
        'support-orange': {
          DEFAULT: 'hsl(var(--support-orange) / <alpha-value>)',
          container: 'hsl(var(--support-orange-container) / <alpha-value>)',
        },
        'on-support-orange': {
          DEFAULT: 'hsl(var(--on-support-orange) / <alpha-value>)',
          container: 'hsl(var(--on-support-orange-container) / <alpha-value>)',
        },

        /* Support Teal */
        'support-teal': {
          DEFAULT: 'hsl(var(--support-teal) / <alpha-value>)',
          container: 'hsl(var(--support-teal-container) / <alpha-value>)',
        },
        'on-support-teal': {
          DEFAULT: 'hsl(var(--on-support-teal) / <alpha-value>)',
          container: 'hsl(var(--on-support-teal-container) / <alpha-value>)',
        },

        /* Gold */
        gold: 'hsl(var(--gold) / <alpha-value>)',

        /* Sidebar */
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background) / <alpha-value>)',
          foreground: 'hsl(var(--sidebar-foreground) / <alpha-value>)',
          primary: 'hsl(var(--sidebar-primary) / <alpha-value>)',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground) / <alpha-value>)',
          accent: 'hsl(var(--sidebar-accent) / <alpha-value>)',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground) / <alpha-value>)',
          border: 'hsl(var(--sidebar-border) / <alpha-value>)',
          ring: 'hsl(var(--sidebar-ring) / <alpha-value>)',
        },

        /* Ring (focus) */
        ring: 'hsl(var(--secondary) / <alpha-value>)',

        /* Legacy mappings for compatibility during transition */
        input: 'hsl(var(--surface-2) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--surface-1) / <alpha-value>)',
          foreground: 'hsl(var(--foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          foreground: 'hsl(var(--foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--surface-2) / <alpha-value>)',
          foreground: 'hsl(var(--on-surface-variant) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--background) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--error) / <alpha-value>)',
          foreground: 'hsl(var(--background) / <alpha-value>)',
        },
        border: 'hsl(var(--outline-variant) / <alpha-value>)',

        /* ============================================
           Auction Theme Tokens
           Scoped under .auction-theme-container
           ============================================ */
        'dr-live-container': {
          DEFAULT: 'hsl(var(--dr-live-container) / <alpha-value>)',
          hover:   'hsl(var(--dr-live-container-hover) / <alpha-value>)',
          glow:    'hsl(var(--dr-live-container-glow) / <alpha-value>)',
        },
        'dr-live': 'hsl(var(--dr-live) / <alpha-value>)',
        auction: {
          draft: {
            DEFAULT: 'hsl(var(--auction-draft) / <alpha-value>)',
            hover:   'hsl(var(--auction-draft-hover) / <alpha-value>)',
          },
          scheduled: {
            DEFAULT: 'hsl(var(--auction-scheduled) / <alpha-value>)',
            hover:   'hsl(var(--auction-scheduled-hover) / <alpha-value>)',
          },
          closed: {
            DEFAULT: 'hsl(var(--auction-closed) / <alpha-value>)',
            hover:   'hsl(var(--auction-closed-hover) / <alpha-value>)',
          },
          deleted: {
            DEFAULT: 'hsl(var(--auction-deleted) / <alpha-value>)',
            hover:   'hsl(var(--auction-deleted-hover) / <alpha-value>)',
            fg:      'hsl(var(--auction-deleted-fg) / <alpha-value>)',
          },
          reopened: {
            DEFAULT: 'hsl(var(--auction-reopened) / <alpha-value>)',
            hover:   'hsl(var(--auction-reopened-hover) / <alpha-value>)',
          },
          picker: 'hsl(var(--auction-picker) / <alpha-value>)',
          preview: 'hsl(var(--auction-preview) / <alpha-value>)',
          running: 'hsl(var(--auction-running) / <alpha-value>)',
        },
      },
      fontFamily: {
        manrope: ['var(--font-manrope)', 'sans-serif'],
        roboto: ['var(--font-roboto)', 'sans-serif'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        /* A note arriving: it rises into place rather than appearing under the cursor. */
        'note-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /* The same message again — a small shake, so a repeat doesn't look like nothing happened. */
        nudge: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-3px)' },
          '40%, 80%': { transform: 'translateX(3px)' },
        },
        /* A bar that crosses its track while a table waits on the backend. */
        'indeterminate-bar': {
          '0%': { transform: 'translateX(-100%) scaleX(0.4)' },
          '50%': { transform: 'translateX(20%) scaleX(0.7)' },
          '100%': { transform: 'translateX(100%) scaleX(0.4)' },
        },
      },
      containers: {
        'car-narrow': '600px',
        'car-wide': '900px',
        'car-huge': '1200px',
      },
      height: {
        'fill-available': '-webkit-fill-available',
      },
      width: {
        'fill-available': '-webkit-fill-available',
      },
    },
  },
}

export default config
