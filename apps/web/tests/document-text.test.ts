import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachmentLimits } from '@velin/contracts/attachments'
import { isValidStorageText } from '@velin/contracts/policy'
import { extractAttachmentText } from '../src/lib/documents/extract'
import { normalizeDocumentText } from '../src/lib/chat/text'

test('document extraction safely truncates an emoji at the text budget boundary', async () => {
  const prefix = 'a'.repeat(attachmentLimits.characters - 1)
  const extracted = await extractAttachmentText(
    'text/plain',
    new TextEncoder().encode(`${prefix}😀tail`),
  )
  assert.equal(extracted, `${prefix}\n\n[内容过长，已截断]`)
  assert.equal(isValidStorageText(extracted), true)
  assert.equal(
    normalizeDocumentText('  \n中文😀\u0000\uD800\uDC01\uDC00\r\n'),
    '中文😀�𐀁�',
  )
})
