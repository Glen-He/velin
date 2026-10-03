import type { BetterAuthPlugin } from 'better-auth'

// Better Auth 1.7.6 catches failures even when runInBackgroundOrAwait awaits.
// Auth delivery is required work: propagate failure instead of reporting "sent".
// Use the supported plugin context extension, without patching library internals.
export const requiredDeliveryPlugin: BetterAuthPlugin = {
  id: 'velin-required-delivery',
  init: () => ({
    context: {
      async runInBackgroundOrAwait(task) {
        await task
      },
    },
  }),
}
