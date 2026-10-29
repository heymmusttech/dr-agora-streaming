import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { Toaster } from 'sonner'
import { cn } from '@/lib/utils'
import './globals.css'

// Same local fonts as drlive-frontend `src/app/(frontend)/layout.tsx`.
const manrope = localFont({
  src: [
    { path: '../fonts/manrope-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/manrope-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/manrope-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/manrope-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-manrope',
  display: 'swap',
  adjustFontFallback: 'Arial',
})

const roboto = localFont({
  src: [
    { path: '../fonts/roboto-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/roboto-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/roboto-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/roboto-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-roboto',
  display: 'swap',
  adjustFontFallback: 'Arial',
})

export const metadata: Metadata = {
  title: 'duPont REGISTRY Live — Live streaming',
  description: 'Live streaming for dR Live and dR Garage: Keycloak hosts, multi-host, live chat and reactions, embeddable plugin.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

// Applies the saved theme before paint, so dark mode doesn't flash light.
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark'}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(manrope.variable, roboto.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans bg-background text-foreground overflow-x-hidden antialiased min-h-svh">
        {children}
        <Toaster position="bottom-center" richColors closeButton />
      </body>
    </html>
  )
}
