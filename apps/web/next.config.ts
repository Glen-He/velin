import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  transpilePackages: ['@velin/ui', '@velin/contracts'],
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Origin-Agent-Cluster', value: '?1' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'X-Download-Options', value: 'noopen' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          { key: 'X-XSS-Protection', value: '0' },
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=15552000; includeSubDomains',
                },
              ]
            : []),
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ]
  },
}
export default config
