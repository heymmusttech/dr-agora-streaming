import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

/*
  Summary: Replace variant set to only the requested styles and embed theme-aware
  Tailwind classes directly in the component so the styling is controlled here.
*/
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 text-sm lg:text-base',
  {
    variants: {
      variant: {
        // 1) Default: transparent with visible border (same in both themes)
        // light: black border; dark: white border
        default: 'bg-transparent border border-foreground text-foreground hover:bg-foreground/5',

        // 2) Secondary: CTA button using secondary color
        secondary: 'border border-transparent bg-secondary text-on-secondary hover:opacity-95',

        // 3) Outline: solid white with black text
        outline: 'border border-outline bg-transparent text-on-surface-variant hover:opacity-95',

        // 4) Ghost: no border, transparent background (text-only), no padding
        ghost:
          'bg-transparent border-none text-secondary hover:bg-transparent hover:opacity-90 hover:underline hover:text-secondary !p-0 !px-0 !py-0',

        // 5) Link: same as ghost but underlined, no padding
        link: 'bg-transparent border-none text-secondary underline underline-offset-4 hover:opacity-90 !p-0 !px-0 !py-0 m-0',

        // 6) Red: solid red brand color with matching border
        red: 'bg-dr-live-container border border-dr-live-container text-white hover:bg-dr-live-container-hover hover:border-dr-live-container-hover',

        // 6b) Neutral: solid grey pill, same in light and dark, overridable per skin
        neutral:
          'bg-surface-neutral border border-transparent text-on-surface-neutral hover:bg-surface-neutral/80',

        // 7) Destructive: transparent with red text
        destructive: 'bg-transparent border border-outline text-error',

        // 8) Auction Primary: solid auction primary color with matching border
        'dr-live-container':
          'border !bg-dr-live-container !border-dr-live-container !text-white hover:!bg-dr-live-container-glow hover:!border-dr-live-container-glow',
      },
      size: {
        default: 'h-10 px-4 py-0', // 40px — every control in the app is 40px tall
        sm: 'h-10 px-3 py-0', // compact padding, same 40px height
        lg: 'px-8 py-3', // larger button
        xl: 'px-10 py-4', // extra large / hero button
        wide: 'px-16 md:px-20 lg:px-24 py-3', // wide button with extra horizontal padding
        icon: 'w-10 h-10 p-0 rounded-full', // square icon button (40x40)
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, asChild = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'

    // For link and ghost variants, don't apply size padding
    const sizeToApply = variant === 'link' || variant === 'ghost' ? undefined : size

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size: sizeToApply, className }),
          loading && 'cursor-wait',
        )}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
