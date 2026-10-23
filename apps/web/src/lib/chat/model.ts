import 'server-only'
import { createHash } from 'node:crypto'

import { chatTimeouts } from '@velin/contracts/policy'
import { defaultChatModel } from '@velin/contracts/chat'
import OpenAI from 'openai'
import { config } from '../config'

export const chatModel = defaultChatModel

export const deepseek = config.chat.deepseekApiKey
  ? new OpenAI({
      apiKey: config.chat.deepseekApiKey,
      baseURL: 'https://api.deepseek.com',
      maxRetries: 0,
      timeout: chatTimeouts.generationMs,
    })
  : null

export function providerUserId(userId: string) {
  return createHash('sha256').update('velin:').update(userId).digest('hex')
}
