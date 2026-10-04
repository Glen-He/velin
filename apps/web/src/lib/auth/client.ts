'use client'

import { electronProxyClient } from '@better-auth/electron/proxy'
import { passkeyClient } from '@better-auth/passkey/client'
import { createAuthClient } from 'better-auth/react'
import { emailOTPClient, twoFactorClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [
    electronProxyClient({
      clientID: 'velin-desktop',
      protocol: { scheme: 'com.velin.desktop' },
      cookiePrefix: 'velin-auth',
    }),
    emailOTPClient(),
    passkeyClient(),
    twoFactorClient(),
  ],
})
