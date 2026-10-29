import type { NextConfig } from 'next'
import { originPatterns } from './src/lib/auth/origins'

/**
 * Framing: only `/embed/*` may be framed, and only by the allowed host platforms
 * (`LIVESTREAM_ALLOWED_PARENT_ORIGINS`, e.g. https://*.dupontregistry.com). Everything else
 * (the host console) is same-origin only.
 */
const embedAncestors = ["'self'", ...originPatterns(process.env.LIVESTREAM_ALLOWED_PARENT_ORIGINS)].join(' ')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A second dev server (e.g. the e2e one with the dev auth bypass) must not share `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // This app has its own lockfile; don't let Next pick up one from a parent directory.
  outputFileTracingRoot: __dirname,
  poweredByHeader: false,
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ]
    return [
      {
        source: '/((?!embed|plugin|api).*)',
        headers: [
          ...common,
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // The host console needs the camera and mic.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), autoplay=(self), fullscreen=(self)' },
        ],
      },
      {
        source: '/embed/:path*',
        headers: [
          ...common,
          { key: 'Content-Security-Policy', value: `frame-ancestors ${embedAncestors}` },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), autoplay=*, fullscreen=*, picture-in-picture=*' },
        ],
      },
      {
        // The plugin is loaded cross-origin by host platforms.
        source: '/plugin/:file(dpr-live.js|dpr-live.css)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=3600' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ]
  },
}

export default nextConfig
