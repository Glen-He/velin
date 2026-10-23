import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import {
  chatModels,
  defaultReasoningEffortForModel,
  findChatModel,
  isReasoningEffortSupported,
  normalizeReasoningEffort,
  reasoningEffortsForModel,
} from '@velin/contracts/chat'
import { createChatRequestSchema } from '@velin/contracts/chat-validation'

const baseModel = chatModels[0]

test('current models keep their full reasoning ladder', () => {
  for (const model of chatModels) {
    assert.deepEqual(
      reasoningEffortsForModel(model).map((effort) => effort.id),
      ['none', 'low', 'high', 'max'],
    )
    assert.equal(defaultReasoningEffortForModel(model), 'none')
    assert.equal(isReasoningEffortSupported(model, 'none'), true)
    assert.equal(normalizeReasoningEffort(model, 'max'), 'max')
  }
  assert.equal(findChatModel('deepseek-flash').supportsImages, true)
  assert.equal(findChatModel('deepseek-v4-pro').supportsImages, false)
  assert.equal(findChatModel('deepseek-v4-pro').name, 'DeepSeek-V4-Pro')
})

test('three-level models expose three steps and clamp unavailable values', () => {
  const model = {
    ...baseModel,
    supportedReasoningEfforts: ['low', 'high', 'max'] as const,
  }
  assert.deepEqual(
    reasoningEffortsForModel(model).map((effort) => effort.name),
    ['低', '高', '最大'],
  )
  assert.equal(defaultReasoningEffortForModel(model), 'low')
  assert.equal(isReasoningEffortSupported(model, 'none'), false)
  assert.equal(isReasoningEffortSupported(model, 'high'), true)
  assert.equal(normalizeReasoningEffort(model, 'none'), 'low')
  assert.equal(normalizeReasoningEffort(model, 'max'), 'max')
})

test('models without reasoning only use the off state', () => {
  const model = { ...baseModel, supportedReasoningEfforts: [] as const }
  assert.deepEqual(reasoningEffortsForModel(model), [])
  assert.equal(defaultReasoningEffortForModel(model), 'none')
  assert.equal(isReasoningEffortSupported(model, 'none'), true)
  assert.equal(isReasoningEffortSupported(model, 'low'), false)
  assert.equal(normalizeReasoningEffort(model, 'max'), 'none')
})

test('unavailable levels resolve to the nearest supported level', () => {
  const model = {
    ...baseModel,
    supportedReasoningEfforts: ['low', 'max'] as const,
  }
  // high is one step from both; the lower level wins.
  assert.equal(normalizeReasoningEffort(model, 'high'), 'low')
  assert.equal(normalizeReasoningEffort(model, 'none'), 'low')
  assert.equal(normalizeReasoningEffort(model, 'max'), 'max')
})

test('request validation follows the selected model capabilities', () => {
  const identity = {
    requestId: randomUUID(),
    conversationId: randomUUID(),
    userMessageId: randomUUID(),
    content: '你好',
  }
  const threeLevel = chatModels.map((model) =>
    model.id === 'deepseek-flash'
      ? {
          ...model,
          supportedReasoningEfforts: ['low', 'high', 'max'] as const,
        }
      : model,
  )
  const schema = createChatRequestSchema(threeLevel)
  assert.equal(
    schema.safeParse({
      ...identity,
      model: 'deepseek-flash',
      reasoningEffort: 'none',
    }).success,
    false,
  )
  assert.equal(
    schema.safeParse({
      ...identity,
      model: 'deepseek-flash',
      reasoningEffort: 'low',
    }).success,
    true,
  )
  const defaulted = schema.safeParse({ ...identity, model: 'deepseek-flash' })
  assert.equal(defaulted.success ? defaulted.data.reasoningEffort : '', 'low')

  const noReasoning = chatModels.map((model) =>
    model.id === 'deepseek-v4-pro'
      ? { ...model, supportedReasoningEfforts: [] as const }
      : model,
  )
  const noReasoningSchema = createChatRequestSchema(noReasoning)
  assert.equal(
    noReasoningSchema.safeParse({
      ...identity,
      model: 'deepseek-v4-pro',
      reasoningEffort: 'none',
    }).success,
    true,
  )
  assert.equal(
    noReasoningSchema.safeParse({
      ...identity,
      model: 'deepseek-v4-pro',
      reasoningEffort: 'low',
    }).success,
    false,
  )
  const off = noReasoningSchema.safeParse({
    ...identity,
    model: 'deepseek-v4-pro',
  })
  assert.equal(off.success ? off.data.reasoningEffort : '', 'none')
})
