import type { BetterAuthPlugin } from 'better-auth'

// Better Auth 1.7.6 即使等待 runInBackgroundOrAwait 也会吞掉失败。
// 邮件投递是必要任务，失败必须传递，不能报告“已发送”。
// 使用公开插件上下文扩展，不修改库内部实现。
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
