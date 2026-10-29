import * as React from 'react'

import { cn } from '@/lib/utils'

/** Same classes as drlive-frontend's Radix separator, as a plain decorative element. */
function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical' }) {
  return (
    <div
      role="none"
      className={cn(
        'shrink-0 bg-outline-variant',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
        className,
      )}
      {...props}
    />
  )
}

export { Separator }
