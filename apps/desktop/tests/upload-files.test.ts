import assert from 'node:assert/strict'
import { test } from 'node:test'
import { uploadFiles } from '../src/renderer/features/chat/upload-files'
import type { MessageAttachment } from '@velin/contracts/chat'

const attachment = { id: 'uploaded' } as MessageAttachment
const file = () => ({
  name: 'context.txt',
  size: 3,
  arrayBuffer: async () => new TextEncoder().encode('abc').buffer,
})

test('switching account while reading a file prevents its upload', async () => {
  const controller = new AbortController()
  let uploads = 0
  let callbacks = 0
  await uploadFiles(
    [
      {
        file: {
          ...file(),
          arrayBuffer: async () => {
            controller.abort()
            return new ArrayBuffer(3)
          },
        },
        isImage: false,
      },
    ],
    {
      accountId: 'account-a',
      signal: controller.signal,
      upload: async () => {
        uploads++
        return attachment
      },
      onUploaded: () => callbacks++,
      onError: () => callbacks++,
      onSettled: () => callbacks++,
    },
  )
  assert.equal(uploads, 0)
  assert.equal(callbacks, 0)
})

test('unmount during upload ignores its result and does not submit remaining files', async () => {
  const controller = new AbortController()
  let uploads = 0
  let callbacks = 0
  await uploadFiles(
    [1, 2, 3].map(() => ({ file: file(), isImage: false })),
    {
      accountId: 'account-a',
      signal: controller.signal,
      upload: async () => {
        uploads++
        controller.abort()
        return attachment
      },
      onUploaded: () => callbacks++,
      onError: () => callbacks++,
      onSettled: () => callbacks++,
    },
  )
  assert.equal(uploads, 1)
  assert.equal(callbacks, 0)
})

test('partial upload failure keeps successes and continues within the same scope', async () => {
  let uploads = 0
  let successes = 0
  let errors = 0
  let settled = 0
  await uploadFiles(
    [1, 2, 3].map(() => ({ file: file(), isImage: false })),
    {
      accountId: 'account-a',
      signal: new AbortController().signal,
      upload: async () => {
        if (++uploads === 2) throw new Error('Failed')
        return attachment
      },
      onUploaded: () => successes++,
      onError: () => errors++,
      onSettled: () => settled++,
    },
  )
  assert.equal(uploads, 3)
  assert.equal(successes, 2)
  assert.equal(errors, 1)
  assert.equal(settled, 3)
})
