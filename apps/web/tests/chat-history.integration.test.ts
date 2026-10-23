import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { hashPassword } from 'better-auth/crypto'

// 仅显式启用一次性测试数据库，不能把测试数据写入用户数据库。
const enabled = Boolean(process.env.VELIN_TEST_DATABASE_URL)
if (enabled) {
  const url = new URL(process.env.VELIN_TEST_DATABASE_URL!)
  assert.match(url.pathname, /^\/velin_.*test$/)
  process.env.DATABASE_URL = url.href
  process.env.BETTER_AUTH_SECRET =
    'velin-integration-secret-with-at-least-32-characters'
  process.env.APP_URL = 'http://localhost:3000'
  process.env.PASSKEY_RP_ID = 'localhost'
  process.env.NODE_ENV = 'test'
  process.env.EMAIL_TRANSPORT = 'console'
}

test(
  'chat history persists prompts, ownership, pagination and deletion',
  { skip: !enabled, timeout: 120_000 },
  async () => {
    const { createApiFixture } = await import('./request-api')
    const { auth } = await import('../src/lib/auth/server')
    const { databasePool: db } = await import('../src/lib/database/connection')
    const {
      beginChatTurn: persistChatTurn,
      finalizeAssistantMessage,
      persistAssistantSnapshot,
    } = await import('../src/lib/chat/turn')
    const { prepareConversationContext } = await import(
      '../src/lib/chat/context'
    )
    async function beginChatTurn(input: Parameters<typeof persistChatTurn>[0]) {
      const turn = await persistChatTurn(input)
      const prepared = await prepareConversationContext({
        ...input,
        assistantMessageId: turn.assistantMessageId,
        signal: new AbortController().signal,
      })
      return {
        ...turn,
        promptMessages: prepared.messages.filter(
          (message) => message.role !== 'system',
        ),
        context: prepared.metadata,
      }
    }
    const {
      listConversations,
      loadConversation,
      renameConversation,
      reorderConversations,
    } = await import('../src/lib/chat/history')
    const { saveGeneratedTitle } = await import('../src/lib/chat/title')
    const { loadAttachmentStatus } = await import('../src/lib/chat/attachments')
    const { processPdfAttachment } = await import('../src/lib/ocr/process')
    const { prunePdfPageCache } = await import('../src/lib/ocr/cache')
    const { stopOcrQueue } = await import('../src/lib/ocr/queue')
    const app = await createApiFixture()
    const password = 'Velin-testing-94728!'
    const userIds: string[] = []
    type Identity = { userId: string; cookie: string }
    async function login(email: string): Promise<Identity> {
      const response = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      })
      assert.equal(response.status, 200)
      const cookie = response.headers
        .getSetCookie()
        .map((item) => item.split(';', 1)[0])
        .join('; ')
      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      })
      assert.ok(session)
      return { userId: session.user.id, cookie }
    }
    async function fixture(email: string) {
      const context = await auth.$context
      const user = await context.internalAdapter.createUser(
        { name: email, email, emailVerified: true },
        { method: 'email-password' },
      )
      userIds.push(user.id)
      await context.internalAdapter.createAccount({
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: await hashPassword(password),
      })
      return login(email)
    }
    async function createUser(email: string) {
      const context = await auth.$context
      const user = await context.internalAdapter.createUser(
        { name: email, email, emailVerified: true },
        { method: 'email-password' },
      )
      userIds.push(user.id)
      return user.id
    }
    const owner = await fixture(`history-${crypto.randomUUID()}@example.test`)
    async function generationOf(attachmentId: string) {
      const result = await db.query<{ ocr_generation: string }>(
        'select ocr_generation from chat_attachment where id = $1',
        [attachmentId],
      )
      return result.rows[0]!.ocr_generation
    }
    async function processPdf(attachmentId: string) {
      await processPdfAttachment(attachmentId, await generationOf(attachmentId))
      const attachment = await loadAttachmentStatus(owner.userId, attachmentId)
      assert.equal(attachment?.status, 'ready', attachment?.ocrError)
    }
    const otherUser = await fixture(
      `history-other-${crypto.randomUUID()}@example.test`,
    )

    try {
      async function historyRequest(
        path: string,
        cookie: string,
        init: RequestInit = {},
      ) {
        return app.request(path, {
          ...init,
          headers: {
            ...init.headers,
            cookie,
          },
        })
      }

      const unauthorized = await app.request('/api/chat/conversations')
      assert.equal(unauthorized.status, 401)

      const browserRequest = await historyRequest(
        '/api/chat/conversations',
        owner.cookie,
        { headers: { origin: 'http://localhost:3000' } },
      )
      assert.equal(browserRequest.status, 403)

      const conversationId = crypto.randomUUID()
      const firstMessageId = crypto.randomUUID()
      const firstRequestId = crypto.randomUUID()
      const firstTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId,
        userMessageId: firstMessageId,
        requestId: firstRequestId,
        content: 'first question',
        model: 'deepseek-flash',
      })
      assert.deepEqual(firstTurn.promptMessages, [
        { role: 'user', content: 'first question' },
      ])

      await persistAssistantSnapshot(
        conversationId,
        firstTurn.assistantMessageId,
        'first ',
        '先分析问题，',
      )
      await finalizeAssistantMessage({
        conversationId,
        messageId: firstTurn.assistantMessageId,
        content: 'first reply',
        reasoning: '先分析问题，再回答。',
        status: 'completed',
        inputTokens: 4,
        outputTokens: 3,
      })

      const listResponse = await historyRequest(
        '/api/chat/conversations',
        owner.cookie,
      )
      assert.equal(listResponse.status, 200)
      const list = await listResponse.json()
      assert.equal(list.conversations.length, 1)
      assert.equal(list.conversations[0].title, 'first question')

      const firstPageResponse = await historyRequest(
        `/api/chat/conversations/${conversationId}/messages`,
        owner.cookie,
      )
      assert.equal(firstPageResponse.status, 200)
      const firstPage = await firstPageResponse.json()
      assert.equal(firstPage.messages[1].reasoning, '先分析问题，再回答。')
      assert.deepEqual(
        firstPage.messages.map((message: { role: string; content: string }) => [
          message.role,
          message.content,
        ]),
        [
          ['user', 'first question'],
          ['assistant', 'first reply'],
        ],
      )

      const otherPage = await historyRequest(
        `/api/chat/conversations/${conversationId}/messages`,
        otherUser.cookie,
      )
      assert.equal(otherPage.status, 404)
      const otherDelete = await historyRequest(
        `/api/chat/conversations/${conversationId}`,
        otherUser.cookie,
        { method: 'DELETE' },
      )
      assert.equal(otherDelete.status, 404)

      assert.equal(
        await saveGeneratedTitle({
          requestId: firstRequestId,
          userId: owner.userId,
          conversationId,
          title: '生成标题',
        }),
        '生成标题',
      )
      assert.equal(
        await saveGeneratedTitle({
          requestId: firstRequestId,
          userId: owner.userId,
          conversationId,
          title: '重复标题',
        }),
        null,
      )

      const regeneratedTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId,
        userMessageId: firstMessageId,
        requestId: crypto.randomUUID(),
        content: 'first question',
        model: 'deepseek-flash',
      })
      assert.equal(regeneratedTurn.titleContent, null)
      assert.deepEqual(regeneratedTurn.promptMessages, [
        { role: 'user', content: 'first question' },
      ])
      await finalizeAssistantMessage({
        conversationId,
        messageId: regeneratedTurn.assistantMessageId,
        content: 'regenerated reply',
        reasoning: '',
        status: 'completed',
      })
      const regeneratedPage = await loadConversation(
        owner.userId,
        conversationId,
      )
      assert.equal(regeneratedPage?.conversation.title, '生成标题')
      assert.deepEqual(
        regeneratedPage?.messages.map((message) => [
          message.role,
          message.content,
        ]),
        [
          ['user', 'first question'],
          ['assistant', 'regenerated reply'],
        ],
      )

      const secondMessageId = crypto.randomUUID()
      const secondTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId,
        userMessageId: secondMessageId,
        requestId: crypto.randomUUID(),
        content: 'second question',
        model: 'deepseek-flash',
      })
      assert.equal(secondTurn.titleContent, null)
      assert.deepEqual(secondTurn.promptMessages, [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'regenerated reply' },
        { role: 'user', content: 'second question' },
      ])
      await finalizeAssistantMessage({
        conversationId,
        messageId: secondTurn.assistantMessageId,
        content: 'second reply',
        reasoning: '',
        status: 'completed',
      })

      const editedTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId,
        userMessageId: firstMessageId,
        requestId: crypto.randomUUID(),
        content: 'edited first',
        model: 'deepseek-flash',
      })
      assert.equal(editedTurn.titleContent, 'edited first')
      assert.deepEqual(editedTurn.promptMessages, [
        { role: 'user', content: 'edited first' },
      ])
      await finalizeAssistantMessage({
        conversationId,
        messageId: editedTurn.assistantMessageId,
        content: 'edited reply',
        reasoning: '',
        status: 'completed',
      })

      const editedPage = await loadConversation(owner.userId, conversationId)
      assert.ok(
        BigInt(editedPage!.revision) > BigInt(regeneratedPage!.revision),
      )
      assert.deepEqual(
        editedPage?.messages.map((message) => [message.role, message.content]),
        [
          ['user', 'edited first'],
          ['assistant', 'edited reply'],
        ],
      )
      assert.equal(editedPage?.conversation.title, 'edited first')

      assert.equal(
        await renameConversation(owner.userId, conversationId, '手动标题'),
        '手动标题',
      )
      assert.equal(
        await saveGeneratedTitle({
          requestId: firstRequestId,
          userId: owner.userId,
          conversationId,
          title: '不应覆盖',
        }),
        null,
      )
      const manuallyNamed = await loadConversation(owner.userId, conversationId)
      assert.equal(manuallyNamed?.conversation.title, '手动标题')

      const renameResponse = await historyRequest(
        `/api/chat/conversations/${conversationId}`,
        owner.cookie,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'HTTP 标题' }),
        },
      )
      assert.equal(renameResponse.status, 200)
      assert.deepEqual(await renameResponse.json(), { title: 'HTTP 标题' })

      const cancelledMessageId = crypto.randomUUID()
      const cancelledTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId,
        userMessageId: cancelledMessageId,
        requestId: crypto.randomUUID(),
        content: 'cancel me',
        model: 'deepseek-flash',
      })
      await persistAssistantSnapshot(
        conversationId,
        cancelledTurn.assistantMessageId,
        'partial',
        '取消前的思考',
      )
      await finalizeAssistantMessage({
        conversationId,
        messageId: cancelledTurn.assistantMessageId,
        content: 'partial',
        reasoning: '取消前的思考',
        status: 'cancelled',
      })
      const afterCancel = await loadConversation(owner.userId, conversationId)
      assert.equal(afterCancel?.messages.at(-1)?.status, 'cancelled')
      assert.equal(afterCancel?.messages.at(-1)?.content, 'partial')
      assert.equal(afterCancel?.messages.at(-1)?.reasoning, '取消前的思考')

      const failedMessageId = crypto.randomUUID()
      const failedTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId,
        userMessageId: failedMessageId,
        requestId: crypto.randomUUID(),
        content: 'fail me',
        model: 'deepseek-flash',
      })
      await finalizeAssistantMessage({
        conversationId,
        messageId: failedTurn.assistantMessageId,
        content: '',
        reasoning: '',
        status: 'failed',
      })
      const afterFailure = await loadConversation(owner.userId, conversationId)
      assert.equal(
        afterFailure?.messages.some(
          (message) => message.id === failedTurn.assistantMessageId,
        ),
        false,
      )

      await db.query(
        `insert into chat_message (id, conversation_id, role, content, status)
       select gen_random_uuid(), $1, 'user', 'older ' || value, 'completed'
       from generate_series(1, 55) as value`,
        [conversationId],
      )
      const latestPage = await loadConversation(owner.userId, conversationId)
      assert.ok(latestPage)
      assert.equal(latestPage.messages.length, 50)
      assert.equal(latestPage.hasMore, true)
      assert.ok(latestPage.nextBefore)

      const earlierPage = await loadConversation(
        owner.userId,
        conversationId,
        latestPage.nextBefore,
      )
      assert.ok(earlierPage)
      assert.ok(earlierPage.messages.length > 0)
      const latestIds = new Set(
        latestPage.messages.map((message) => message.id),
      )
      assert.equal(
        earlierPage.messages.some((message) => latestIds.has(message.id)),
        false,
      )

      const deleteResponse = await historyRequest(
        `/api/chat/conversations/${conversationId}`,
        owner.cookie,
        { method: 'DELETE' },
      )
      assert.equal(deleteResponse.status, 204)
      assert.equal(await loadConversation(owner.userId, conversationId), null)
      const finalList = await historyRequest(
        '/api/chat/conversations',
        owner.cookie,
      )
      assert.deepEqual((await finalList.json()).conversations, [])

      const firstOrderedId = crypto.randomUUID()
      const secondOrderedId = crypto.randomUUID()
      await beginChatTurn({
        userId: owner.userId,
        conversationId: firstOrderedId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'order first',
        model: 'deepseek-flash',
      })
      await beginChatTurn({
        userId: owner.userId,
        conversationId: secondOrderedId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'order second',
        model: 'deepseek-flash',
      })

      let ordered = (await listConversations(owner.userId)).conversations
      assert.deepEqual(
        ordered.map((conversation) => conversation.id),
        [secondOrderedId, firstOrderedId],
      )
      assert.equal(
        await reorderConversations(owner.userId, {
          sourceId: firstOrderedId,
          targetId: secondOrderedId,
          placement: 'before',
        }),
        true,
      )
      ordered = (await listConversations(owner.userId)).conversations
      assert.deepEqual(
        ordered.map((conversation) => conversation.id),
        [firstOrderedId, secondOrderedId],
      )
      assert.equal(
        await reorderConversations(owner.userId, {
          sourceId: firstOrderedId,
          targetId: crypto.randomUUID(),
          placement: 'before',
        }),
        false,
      )

      const orderResponse = await historyRequest(
        '/api/chat/conversations/order',
        owner.cookie,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sourceId: secondOrderedId,
            targetId: firstOrderedId,
            placement: 'before',
          }),
        },
      )
      assert.equal(orderResponse.status, 204)
      ordered = (await listConversations(owner.userId)).conversations
      assert.deepEqual(
        ordered.map((conversation) => conversation.id),
        [secondOrderedId, firstOrderedId],
      )

      const browserOrder = await historyRequest(
        '/api/chat/conversations/order',
        owner.cookie,
        {
          method: 'PUT',
          headers: {
            origin: 'http://localhost:3000',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sourceId: firstOrderedId,
            targetId: secondOrderedId,
            placement: 'before',
          }),
        },
      )
      assert.equal(browserOrder.status, 403)

      const uploadForm = new FormData()
      uploadForm.append('accountId', owner.userId)
      uploadForm.append(
        'file',
        new File(['Attachment text for the model.'], 'notes.txt', {
          type: 'text/plain',
        }),
      )
      const uploadResponse = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: uploadForm },
      )
      assert.equal(uploadResponse.status, 200)
      const uploaded = await uploadResponse.json()
      assert.equal(uploaded.attachment.name, 'notes.txt')
      const attachmentId = uploaded.attachment.id

      const switchedAccountUpload = await historyRequest(
        '/api/chat/attachments',
        otherUser.cookie,
        { method: 'POST', body: uploadForm },
      )
      assert.equal(switchedAccountUpload.status, 409)
      assert.match(
        (await switchedAccountUpload.json()).message,
        /登录状态已变化/,
      )

      const attachmentConversationId = crypto.randomUUID()
      const attachmentTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: attachmentConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'summarize the notes',
        model: 'deepseek-flash',
        attachmentIds: [attachmentId],
      })
      assert.match(
        attachmentTurn.promptMessages.at(-1)?.content ?? '',
        /资料1：notes\.txt/,
      )
      assert.match(
        attachmentTurn.promptMessages.at(-1)?.content ?? '',
        /Attachment text for the model\./,
      )
      await finalizeAssistantMessage({
        conversationId: attachmentConversationId,
        messageId: attachmentTurn.assistantMessageId,
        content: 'summary',
        reasoning: '',
        status: 'completed',
      })
      const attachmentPage = await loadConversation(
        owner.userId,
        attachmentConversationId,
      )
      assert.equal(
        attachmentPage?.messages[0].attachments[0]?.name,
        'notes.txt',
      )
      assert.equal(attachmentPage?.messages[0].attachments[0]?.id, attachmentId)

      const secretForm = new FormData()
      secretForm.append('accountId', owner.userId)
      secretForm.append(
        'file',
        new File(['private notes'], 'secret.txt', { type: 'text/plain' }),
      )
      const secretUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: secretForm },
      )
      const secretId = (await secretUpload.json()).attachment.id
      await assert.rejects(
        beginChatTurn({
          userId: otherUser.userId,
          conversationId: crypto.randomUUID(),
          userMessageId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          content: 'use another user attachment',
          model: 'deepseek-flash',
          attachmentIds: [secretId],
        }),
        /附件不存在或已经发送/,
      )

      const unauthorizedUpload = await app.request('/api/chat/attachments', {
        method: 'POST',
        body: (() => {
          const form = new FormData()
          form.append('accountId', owner.userId)
          form.append(
            'file',
            new File(['no session'], 'nope.txt', { type: 'text/plain' }),
          )
          return form
        })(),
      })
      assert.equal(unauthorizedUpload.status, 401)

      const browserForm = new FormData()
      browserForm.append('accountId', owner.userId)
      browserForm.append(
        'file',
        new File(['blocked'], 'blocked.txt', { type: 'text/plain' }),
      )
      const browserUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        {
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
          body: browserForm,
        },
      )
      assert.equal(browserUpload.status, 403)

      const unsupportedForm = new FormData()
      unsupportedForm.append('accountId', owner.userId)
      unsupportedForm.append(
        'file',
        new File(['binary'], 'malware.exe', {
          type: 'application/octet-stream',
        }),
      )
      const unsupported = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: unsupportedForm },
      )
      assert.equal(unsupported.status, 400)

      const deleteSecretResponse = await historyRequest(
        `/api/chat/attachments/${secretId}`,
        owner.cookie,
        { method: 'DELETE' },
      )
      assert.equal(deleteSecretResponse.status, 204)
      const deleteBoundResponse = await historyRequest(
        `/api/chat/attachments/${attachmentId}`,
        owner.cookie,
        { method: 'DELETE' },
      )
      assert.equal(deleteBoundResponse.status, 404)

      const pdfBytes = await readFile(
        new URL('./fixtures/sample.pdf', import.meta.url),
      )
      const pdfForm = new FormData()
      pdfForm.append('accountId', owner.userId)
      pdfForm.append(
        'file',
        new File([pdfBytes], 'sample.pdf', { type: 'application/pdf' }),
      )
      const pdfUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: pdfForm },
      )
      assert.equal(pdfUpload.status, 200)
      const pdfAttachment = (await pdfUpload.json()).attachment
      assert.equal(pdfAttachment.status, 'processing')
      const pdfId = pdfAttachment.id
      await processPdf(pdfId)
      const pdfConversationId = crypto.randomUUID()
      const pdfTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: pdfConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'summarize the pdf',
        model: 'deepseek-flash',
        attachmentIds: [pdfId],
      })
      assert.match(
        pdfTurn.promptMessages.at(-1)?.content ?? '',
        /资料1：sample\.pdf/,
      )
      assert.match(
        pdfTurn.promptMessages.at(-1)?.content ?? '',
        /Velin PDF attachment test\./,
      )
      await finalizeAssistantMessage({
        conversationId: pdfConversationId,
        messageId: pdfTurn.assistantMessageId,
        content: 'pdf summary',
        reasoning: '',
        status: 'completed',
      })
      const pdfPage = await loadConversation(owner.userId, pdfConversationId)
      assert.equal(pdfPage?.messages[0].attachments[0]?.name, 'sample.pdf')

      const mixedBytes = await readFile(
        new URL('./fixtures/sample-mixed.pdf', import.meta.url),
      )
      const mixedForm = new FormData()
      mixedForm.append('accountId', owner.userId)
      mixedForm.append(
        'file',
        new File([mixedBytes], 'sample-mixed.pdf', {
          type: 'application/pdf',
        }),
      )
      const mixedUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: mixedForm },
      )
      assert.equal(mixedUpload.status, 200)
      const mixedId = (await mixedUpload.json()).attachment.id
      await processPdf(mixedId)
      const mixedConversationId = crypto.randomUUID()
      const mixedTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: mixedConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'read the mixed pdf',
        model: 'deepseek-flash',
        attachmentIds: [mixedId],
      })
      const mixedPrompt = mixedTurn.promptMessages.at(-1)?.content ?? ''
      assert.match(mixedPrompt, /Velin mixed PDF text page\./)
      assert.match(mixedPrompt, /This page comes from the text layer\./)
      assert.match(mixedPrompt, /\[PDF 共 2 页；文本页 1；OCR 页 2\]/)
      assert.match(mixedPrompt, /\[第 1 页\]/)
      assert.match(mixedPrompt, /\[第 2 页｜OCR\]/)
      assert.match(mixedPrompt, /This text should be extracted by unpdf/)
      await finalizeAssistantMessage({
        conversationId: mixedConversationId,
        messageId: mixedTurn.assistantMessageId,
        content: 'mixed summary',
        reasoning: '',
        status: 'completed',
      })

      const scannedBytes = await readFile(
        new URL('./fixtures/sample-scan-3pages.pdf', import.meta.url),
      )
      const scannedForm = new FormData()
      scannedForm.append('accountId', owner.userId)
      scannedForm.append(
        'file',
        new File([scannedBytes], 'sample-scan-3pages.pdf', {
          type: 'application/pdf',
        }),
      )
      const scannedUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: scannedForm },
      )
      assert.equal(scannedUpload.status, 200)
      const scannedId = (await scannedUpload.json()).attachment.id
      await processPdf(scannedId)
      const scannedConversationId = crypto.randomUUID()
      const scannedTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: scannedConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'read the scanned report',
        model: 'deepseek-flash',
        attachmentIds: [scannedId],
      })
      const scannedPrompt = scannedTurn.promptMessages.at(-1)?.content ?? ''
      assert.match(scannedPrompt, /\[PDF 共 3 页；OCR 页 1–3/)
      assert.match(scannedPrompt, /Page one body: revenue grew\./)
      assert.match(scannedPrompt, /Page two body: costs fell\./)
      assert.match(scannedPrompt, /Page three body: margin improved\./)
      assert.match(scannedPrompt, /North {3,}120/)
      assert.doesNotMatch(scannedPrompt, /Velin Quarterly Report/)
      assert.doesNotMatch(scannedPrompt, /Confidential/)
      await finalizeAssistantMessage({
        conversationId: scannedConversationId,
        messageId: scannedTurn.assistantMessageId,
        content: 'scanned report summary',
        reasoning: '',
        status: 'completed',
      })

      const rangeForm = new FormData()
      rangeForm.append('accountId', owner.userId)
      rangeForm.append(
        'file',
        new File([scannedBytes], 'sample-scan-3pages.pdf', {
          type: 'application/pdf',
        }),
      )
      const rangeUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: rangeForm },
      )
      assert.equal(rangeUpload.status, 200)
      const rangeAttachment = (await rangeUpload.json()).attachment
      assert.equal(rangeAttachment.status, 'processing')
      const rangeId = rangeAttachment.id
      await assert.rejects(
        beginChatTurn({
          userId: owner.userId,
          conversationId: crypto.randomUUID(),
          userMessageId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          content: 'send while processing',
          model: 'deepseek-flash',
          attachmentIds: [rangeId],
        }),
        /仍在识别中/,
      )
      await processPdf(rangeId)
      const readyRange = await loadAttachmentStatus(owner.userId, rangeId)
      assert.equal(readyRange?.status, 'ready')
      assert.equal(readyRange?.pageCount, 3)
      const originalText = await db.query<{ text_content: string }>(
        'select text_content from chat_attachment where id = $1',
        [scannedId],
      )
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const repeat = await historyRequest(
          `/api/chat/attachments/${rangeId}/reprocess`,
          owner.cookie,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pageRange: '' }),
          },
        )
        assert.equal(repeat.status, 200)
        await processPdf(rangeId)
        const repeatedText = await db.query<{ text_content: string }>(
          'select text_content from chat_attachment where id = $1',
          [rangeId],
        )
        assert.equal(
          repeatedText.rows[0]?.text_content,
          originalText.rows[0]?.text_content,
        )
      }
      const rawPages = await db.query<{ text_content: string }>(
        `select text_content from chat_attachment_page
         where attachment_id = $1 order by page_number`,
        [rangeId],
      )
      assert.equal(rawPages.rowCount, 3)
      for (const page of rawPages.rows) {
        assert.match(page.text_content, /Velin Quarterly Report/)
        assert.match(page.text_content, /Confidential/)
      }

      for (const [value, pattern] of [
        ['1-301', /最多 300 页/],
        ['99', /超出 PDF 范围/],
        ['abc', /格式无效/],
      ] as const) {
        const invalidReprocess = await historyRequest(
          `/api/chat/attachments/${rangeId}/reprocess`,
          owner.cookie,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pageRange: value }),
          },
        )
        assert.equal(invalidReprocess.status, 400)
        assert.match((await invalidReprocess.json()).message, pattern)
      }

      const reprocess = await historyRequest(
        `/api/chat/attachments/${rangeId}/reprocess`,
        owner.cookie,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pageRange: '2' }),
        },
      )
      assert.equal(reprocess.status, 200)
      const reprocessed = (await reprocess.json()).attachment
      assert.equal(reprocessed.id, rangeId)
      assert.equal(reprocessed.status, 'processing')
      assert.equal(reprocessed.pageCount, 3)
      assert.equal(reprocessed.ocrPageRange, '2')
      await processPdf(rangeId)

      const cachedForm = new FormData()
      cachedForm.append('accountId', owner.userId)
      cachedForm.append(
        'file',
        new File([scannedBytes], 'sample-scan-3pages.pdf', {
          type: 'application/pdf',
        }),
      )
      cachedForm.append('pageRange', '2')
      const cachedUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: cachedForm },
      )
      assert.equal(cachedUpload.status, 200)
      const cachedAttachment = (await cachedUpload.json()).attachment
      assert.equal(cachedAttachment.status, 'processing')
      const cachedId = cachedAttachment.id
      await processPdf(cachedId)
      const textRows = await db.query<{ id: string; text_content: string }>(
        'select id, text_content from chat_attachment where id = any($1::uuid[])',
        [[rangeId, cachedId]],
      )
      const textById = new Map(
        textRows.rows.map((row) => [row.id, row.text_content]),
      )
      assert.equal(textById.get(rangeId), textById.get(cachedId))
      const cachedDelete = await historyRequest(
        `/api/chat/attachments/${cachedId}`,
        owner.cookie,
        { method: 'DELETE' },
      )
      assert.equal(cachedDelete.status, 204)

      const rangeConversationId = crypto.randomUUID()
      const rangeTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: rangeConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'read page two only',
        model: 'deepseek-flash',
        attachmentIds: [rangeId],
      })
      const rangePrompt = rangeTurn.promptMessages.at(-1)?.content ?? ''
      assert.match(
        rangePrompt,
        /\[PDF 共 3 页；所选 OCR 页码 2；OCR 页 2；第 1、3 页为扫描页，不在所选 OCR 页码内\]/,
      )
      assert.match(rangePrompt, /Page two body: costs fell\./)
      assert.doesNotMatch(rangePrompt, /Page one body|Page three body/)
      await finalizeAssistantMessage({
        conversationId: rangeConversationId,
        messageId: rangeTurn.assistantMessageId,
        content: 'page range summary',
        reasoning: '',
        status: 'completed',
      })

      const cancelForm = new FormData()
      cancelForm.append('accountId', owner.userId)
      cancelForm.append(
        'file',
        new File([scannedBytes], 'sample-scan-3pages.pdf', {
          type: 'application/pdf',
        }),
      )
      const cancelUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: cancelForm },
      )
      assert.equal(cancelUpload.status, 200)
      const cancelId = (await cancelUpload.json()).attachment.id
      const processingStatus = await historyRequest(
        `/api/chat/attachments/${cancelId}`,
        owner.cookie,
      )
      assert.equal(processingStatus.status, 200)
      assert.equal(
        (await processingStatus.json()).attachment.status,
        'processing',
      )
      const cancelResponse = await historyRequest(
        `/api/chat/attachments/${cancelId}/cancel`,
        owner.cookie,
        { method: 'POST' },
      )
      assert.equal(cancelResponse.status, 204)
      const canceledGeneration = await generationOf(cancelId)
      await processPdfAttachment(cancelId, canceledGeneration)
      const canceledStatus = await loadAttachmentStatus(owner.userId, cancelId)
      assert.equal(canceledStatus?.status, 'canceled')
      assert.equal(canceledStatus?.progress?.total, 0)
      const repeatCancel = await historyRequest(
        `/api/chat/attachments/${cancelId}/cancel`,
        owner.cookie,
        { method: 'POST' },
      )
      assert.equal(repeatCancel.status, 409)

      const resume = await historyRequest(
        `/api/chat/attachments/${cancelId}/reprocess`,
        owner.cookie,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pageRange: '' }),
        },
      )
      assert.equal(resume.status, 200)
      assert.equal((await resume.json()).attachment.status, 'processing')
      assert.notEqual(await generationOf(cancelId), canceledGeneration)
      await processPdfAttachment(cancelId, canceledGeneration)
      assert.equal(
        (await loadAttachmentStatus(owner.userId, cancelId))?.status,
        'processing',
      )
      await processPdf(cancelId)
      const resumedStatus = await loadAttachmentStatus(owner.userId, cancelId)
      assert.equal(resumedStatus?.status, 'ready')
      assert.equal(resumedStatus?.pageCount, 3)
      const resumedDelete = await historyRequest(
        `/api/chat/attachments/${cancelId}`,
        owner.cookie,
        { method: 'DELETE' },
      )
      assert.equal(resumedDelete.status, 204)

      const fakePdfForm = new FormData()
      fakePdfForm.append('accountId', owner.userId)
      fakePdfForm.append(
        'file',
        new File(['not a pdf'], 'fake.pdf', { type: 'application/pdf' }),
      )
      const fakePdf = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: fakePdfForm },
      )
      assert.equal(fakePdf.status, 400)

      const docxBytes = await readFile(
        new URL('./fixtures/sample.docx', import.meta.url),
      )
      const docxForm = new FormData()
      docxForm.append('accountId', owner.userId)
      docxForm.append(
        'file',
        new File([docxBytes], 'sample.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      )
      const docxUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: docxForm },
      )
      assert.equal(docxUpload.status, 200)
      const docxId = (await docxUpload.json()).attachment.id
      const docxConversationId = crypto.randomUUID()
      const docxTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: docxConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'summarize the docx',
        model: 'deepseek-flash',
        attachmentIds: [docxId],
      })
      assert.match(
        docxTurn.promptMessages.at(-1)?.content ?? '',
        /资料1：sample\.docx/,
      )
      assert.match(
        docxTurn.promptMessages.at(-1)?.content ?? '',
        /Velin DOCX attachment test\./,
      )
      assert.match(
        docxTurn.promptMessages.at(-1)?.content ?? '',
        /This text should be extracted by mammoth\./,
      )
      await finalizeAssistantMessage({
        conversationId: docxConversationId,
        messageId: docxTurn.assistantMessageId,
        content: 'docx summary',
        reasoning: '',
        status: 'completed',
      })
      const docxPage = await loadConversation(owner.userId, docxConversationId)
      assert.equal(docxPage?.messages[0].attachments[0]?.name, 'sample.docx')

      const fakeDocxForm = new FormData()
      fakeDocxForm.append('accountId', owner.userId)
      fakeDocxForm.append(
        'file',
        new File(['not a docx'], 'fake.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      )
      const fakeDocx = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: fakeDocxForm },
      )
      assert.equal(fakeDocx.status, 400)

      const xlsxBytes = await readFile(
        new URL('./fixtures/sample.xlsx', import.meta.url),
      )
      const xlsxForm = new FormData()
      xlsxForm.append('accountId', owner.userId)
      xlsxForm.append(
        'file',
        new File([xlsxBytes], 'sample.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      )
      const xlsxUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: xlsxForm },
      )
      assert.equal(xlsxUpload.status, 200)
      const xlsxId = (await xlsxUpload.json()).attachment.id
      const xlsxConversationId = crypto.randomUUID()
      const xlsxTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: xlsxConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'summarize the spreadsheet',
        model: 'deepseek-flash',
        attachmentIds: [xlsxId],
      })
      const xlsxPrompt = xlsxTurn.promptMessages.at(-1)?.content ?? ''
      assert.match(xlsxPrompt, /## Data/)
      assert.match(xlsxPrompt, /Name\\tScore\\tNote/)
      assert.match(xlsxPrompt, /Alpha\\t42\\tfirst row/)
      await finalizeAssistantMessage({
        conversationId: xlsxConversationId,
        messageId: xlsxTurn.assistantMessageId,
        content: 'xlsx summary',
        reasoning: '',
        status: 'completed',
      })
      const xlsxPage = await loadConversation(owner.userId, xlsxConversationId)
      assert.equal(xlsxPage?.messages[0].attachments[0]?.name, 'sample.xlsx')

      const fakeXlsxForm = new FormData()
      fakeXlsxForm.append('accountId', owner.userId)
      fakeXlsxForm.append(
        'file',
        new File(['not a xlsx'], 'fake.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      )
      const fakeXlsx = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: fakeXlsxForm },
      )
      assert.equal(fakeXlsx.status, 400)

      const pptxBytes = await readFile(
        new URL('./fixtures/sample.pptx', import.meta.url),
      )
      const pptxForm = new FormData()
      pptxForm.append('accountId', owner.userId)
      pptxForm.append(
        'file',
        new File([pptxBytes], 'sample.pptx', {
          type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        }),
      )
      const pptxUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: pptxForm },
      )
      assert.equal(pptxUpload.status, 200)
      const pptxId = (await pptxUpload.json()).attachment.id
      const pptxConversationId = crypto.randomUUID()
      const pptxTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: pptxConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'summarize the presentation',
        model: 'deepseek-flash',
        attachmentIds: [pptxId],
      })
      const pptxPrompt = pptxTurn.promptMessages.at(-1)?.content ?? ''
      assert.match(pptxPrompt, /Velin PPTX attachment test/)
      assert.match(
        pptxPrompt,
        /This text should be extracted by officeparser\./,
      )
      await finalizeAssistantMessage({
        conversationId: pptxConversationId,
        messageId: pptxTurn.assistantMessageId,
        content: 'pptx summary',
        reasoning: '',
        status: 'completed',
      })
      const pptxPage = await loadConversation(owner.userId, pptxConversationId)
      assert.equal(pptxPage?.messages[0].attachments[0]?.name, 'sample.pptx')

      const fakePptxForm = new FormData()
      fakePptxForm.append('accountId', owner.userId)
      fakePptxForm.append(
        'file',
        new File(['not a pptx'], 'fake.pptx', {
          type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        }),
      )
      const fakePptx = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: fakePptxForm },
      )
      assert.equal(fakePptx.status, 400)

      const rtfBytes = await readFile(
        new URL('./fixtures/sample.rtf', import.meta.url),
      )
      const rtfForm = new FormData()
      rtfForm.append('accountId', owner.userId)
      rtfForm.append(
        'file',
        new File([rtfBytes], 'sample.rtf', { type: 'application/rtf' }),
      )
      const rtfUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: rtfForm },
      )
      assert.equal(rtfUpload.status, 200)
      const rtfId = (await rtfUpload.json()).attachment.id
      const rtfConversationId = crypto.randomUUID()
      const rtfTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: rtfConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'summarize the rtf',
        model: 'deepseek-flash',
        attachmentIds: [rtfId],
      })
      assert.match(
        rtfTurn.promptMessages.at(-1)?.content ?? '',
        /Velin RTF attachment test\./,
      )
      await finalizeAssistantMessage({
        conversationId: rtfConversationId,
        messageId: rtfTurn.assistantMessageId,
        content: 'rtf summary',
        reasoning: '',
        status: 'completed',
      })

      const scanBytes = await readFile(
        new URL('./fixtures/sample-scan.pdf', import.meta.url),
      )
      const scanForm = new FormData()
      scanForm.append('accountId', owner.userId)
      scanForm.append(
        'file',
        new File([scanBytes], 'sample-scan.pdf', {
          type: 'application/pdf',
        }),
      )
      const scanUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: scanForm },
      )
      assert.equal(scanUpload.status, 200, await scanUpload.clone().text())
      const scanId = (await scanUpload.json()).attachment.id
      await processPdf(scanId)
      const scanConversationId = crypto.randomUUID()
      const scanTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: scanConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'read the scanned pdf',
        model: 'deepseek-flash',
        attachmentIds: [scanId],
      })
      const scanPrompt = scanTurn.promptMessages.at(-1)?.content ?? ''
      assert.match(scanPrompt, /Velin PDF attachment/)
      assert.match(scanPrompt, /This text should be extracted by unpdf/)
      await finalizeAssistantMessage({
        conversationId: scanConversationId,
        messageId: scanTurn.assistantMessageId,
        content: 'scan summary',
        reasoning: '',
        status: 'completed',
      })
      const scanPage = await loadConversation(owner.userId, scanConversationId)
      assert.equal(
        scanPage?.messages[0].attachments[0]?.name,
        'sample-scan.pdf',
      )

      const pngBytes = await readFile(
        new URL('./fixtures/sample.png', import.meta.url),
      )
      const thumbnail = `data:image/png;base64,${pngBytes.toString('base64')}`
      const imageForm = new FormData()
      imageForm.append('accountId', owner.userId)
      imageForm.append(
        'file',
        new File([pngBytes], 'sample.png', { type: 'image/png' }),
      )
      imageForm.append('thumbnail', thumbnail)
      const imageUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: imageForm },
      )
      assert.equal(imageUpload.status, 200)
      const imageAttachment = (await imageUpload.json()).attachment
      assert.equal(imageAttachment.kind, 'image')
      assert.match(imageAttachment.thumbnail, /^data:image\/jpeg;base64,/)
      assert.notEqual(imageAttachment.thumbnail, thumbnail)
      const imageId = imageAttachment.id

      await assert.rejects(
        beginChatTurn({
          userId: owner.userId,
          conversationId: crypto.randomUUID(),
          userMessageId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          content: 'describe the image',
          model: 'deepseek-v4-pro',
          attachmentIds: [imageId],
        }),
        /当前模型不支持图片附件/,
      )

      const imageConversationId = crypto.randomUUID()
      const imageTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: imageConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'describe the image',
        model: 'deepseek-flash',
        attachmentIds: [imageId],
      })
      const imagePrompt = imageTurn.promptMessages.at(-1)
      assert.equal(imagePrompt?.images?.length, 1)
      assert.match(imagePrompt?.images?.[0] ?? '', /^data:image\/png;base64,/)
      await finalizeAssistantMessage({
        conversationId: imageConversationId,
        messageId: imageTurn.assistantMessageId,
        content: 'image summary',
        reasoning: '',
        status: 'completed',
      })
      const imagePage = await loadConversation(
        owner.userId,
        imageConversationId,
      )
      assert.equal(imagePage?.messages[0].attachments[0]?.kind, 'image')
      assert.equal(
        imagePage?.messages[0].attachments[0]?.thumbnail,
        imageAttachment.thumbnail,
      )

      const fakeImageForm = new FormData()
      fakeImageForm.append('accountId', owner.userId)
      fakeImageForm.append(
        'file',
        new File(['not a png'], 'fake.png', { type: 'image/png' }),
      )
      fakeImageForm.append('thumbnail', thumbnail)
      const fakeImage = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: fakeImageForm },
      )
      assert.equal(fakeImage.status, 400)

      const unauthorizedList = await app.request('/api/chat/attachments')
      assert.equal(unauthorizedList.status, 401)
      const invalidScopeForm = new FormData()
      invalidScopeForm.append('accountId', owner.userId)
      invalidScopeForm.append(
        'file',
        new File(['invalid scope'], 'invalid-scope.txt', {
          type: 'text/plain',
        }),
      )
      invalidScopeForm.append('conversationId', 'not-a-uuid')
      const invalidScopeUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: invalidScopeForm },
      )
      assert.equal(invalidScopeUpload.status, 400)

      const draftTextForm = new FormData()
      draftTextForm.append('accountId', owner.userId)
      draftTextForm.append(
        'file',
        new File(['remember this note'], 'draft-note.txt', {
          type: 'text/plain',
        }),
      )
      draftTextForm.append('conversationId', imageConversationId)
      const draftUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: draftTextForm },
      )
      assert.equal(draftUpload.status, 200)
      const draftAttachment = (await draftUpload.json()).attachment
      const draftList = await historyRequest(
        `/api/chat/attachments?conversationId=${imageConversationId}`,
        owner.cookie,
      )
      assert.equal(draftList.status, 200)
      assert.deepEqual(
        (await draftList.json()).attachments.map(
          (attachment: { id: string }) => attachment.id,
        ),
        [draftAttachment.id],
      )
      const newScopeList = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
      )
      assert.equal(newScopeList.status, 200)
      assert.ok(
        !(await newScopeList.json()).attachments.some(
          (attachment: { id: string }) => attachment.id === draftAttachment.id,
        ),
      )
      const foreignScopeList = await historyRequest(
        `/api/chat/attachments?conversationId=${imageConversationId}`,
        otherUser.cookie,
      )
      assert.equal(foreignScopeList.status, 200)
      assert.equal((await foreignScopeList.json()).attachments.length, 0)

      const otherConversationId = crypto.randomUUID()
      await beginChatTurn({
        userId: otherUser.userId,
        conversationId: otherConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'other user conversation',
        model: 'deepseek-flash',
      })
      const foreignConversationForm = new FormData()
      foreignConversationForm.append('accountId', owner.userId)
      foreignConversationForm.append(
        'file',
        new File(['not mine'], 'foreign.txt', { type: 'text/plain' }),
      )
      foreignConversationForm.append('conversationId', otherConversationId)
      const foreignConversationUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: foreignConversationForm },
      )
      assert.equal(foreignConversationUpload.status, 404)

      await assert.rejects(
        beginChatTurn({
          userId: owner.userId,
          conversationId: scannedConversationId,
          userMessageId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          content: 'send the note elsewhere',
          model: 'deepseek-flash',
          attachmentIds: [draftAttachment.id],
        }),
        /其他对话草稿/,
      )

      const draftTurn = await beginChatTurn({
        userId: owner.userId,
        conversationId: imageConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'use the draft note',
        model: 'deepseek-flash',
        attachmentIds: [draftAttachment.id],
      })
      await finalizeAssistantMessage({
        conversationId: imageConversationId,
        messageId: draftTurn.assistantMessageId,
        content: 'draft note received',
        reasoning: '',
        status: 'completed',
      })
      const boundDraft = await db.query<{
        message_id: string | null
        draft_conversation_id: string | null
      }>(
        'select message_id, draft_conversation_id from chat_attachment where id = $1',
        [draftAttachment.id],
      )
      assert.ok(boundDraft.rows[0]?.message_id)
      assert.equal(boundDraft.rows[0]?.draft_conversation_id, null)
      const boundDraftList = await historyRequest(
        `/api/chat/attachments?conversationId=${imageConversationId}`,
        owner.cookie,
      )
      assert.equal((await boundDraftList.json()).attachments.length, 0)

      const disposableConversationId = crypto.randomUUID()
      await beginChatTurn({
        userId: owner.userId,
        conversationId: disposableConversationId,
        userMessageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        content: 'disposable conversation',
        model: 'deepseek-flash',
      })
      const disposableForm = new FormData()
      disposableForm.append('accountId', owner.userId)
      disposableForm.append(
        'file',
        new File(['disposable'], 'disposable.txt', { type: 'text/plain' }),
      )
      disposableForm.append('conversationId', disposableConversationId)
      const disposableUpload = await historyRequest(
        '/api/chat/attachments',
        owner.cookie,
        { method: 'POST', body: disposableForm },
      )
      assert.equal(disposableUpload.status, 200)
      const disposableAttachmentId = (await disposableUpload.json()).attachment
        .id
      const disposableDelete = await historyRequest(
        `/api/chat/conversations/${disposableConversationId}`,
        owner.cookie,
        { method: 'DELETE' },
      )
      assert.equal(disposableDelete.status, 204)
      const orphanedAttachment = await db.query(
        'select 1 from chat_attachment where id = $1',
        [disposableAttachmentId],
      )
      assert.equal(orphanedAttachment.rowCount, 0)

      const cacheOwnerId = await createUser(
        `cache-${crypto.randomUUID()}@example.test`,
      )
      const cacheOtherId = await createUser(
        `cache-other-${crypto.randomUUID()}@example.test`,
      )
      const cacheSha = `prune-${crypto.randomUUID()}`
      const cacheOtherSha = `prune-other-${crypto.randomUUID()}`
      const cacheStamp = Date.now()
      for (let page = 1; page <= 5; page += 1) {
        await db.query(
          `insert into chat_pdf_page_cache
             (user_id, sha256, engine_version, page_number, source,
              text_content, confidence, updated_at)
           values ($1, $2, 'prune-test', $3, 'ocr', $4, 90, $5)`,
          [
            cacheOwnerId,
            cacheSha,
            page,
            `cache ${page}`,
            new Date(cacheStamp + page * 1000),
          ],
        )
      }
      for (let page = 1; page <= 3; page += 1) {
        await db.query(
          `insert into chat_pdf_page_cache
             (user_id, sha256, engine_version, page_number, source,
              text_content, confidence, updated_at)
           values ($1, $2, 'prune-test', $3, 'ocr', $4, 90, $5)`,
          [
            cacheOtherId,
            cacheOtherSha,
            page,
            `other ${page}`,
            new Date(cacheStamp + page * 500),
          ],
        )
      }
      const perUserPrune = await prunePdfPageCache(cacheOwnerId, {
        totalRows: 1_000_000,
        userRows: 2,
      })
      assert.equal(perUserPrune.userDeleted, 3)
      const prunedPages = await db.query<{ page_number: number }>(
        `select page_number from chat_pdf_page_cache
         where user_id = $1 and sha256 = $2 order by page_number`,
        [cacheOwnerId, cacheSha],
      )
      assert.deepEqual(
        prunedPages.rows.map((row) => row.page_number),
        [4, 5],
      )
      const otherCacheCount = await db.query<{ count: number }>(
        `select count(*)::int as count from chat_pdf_page_cache
         where user_id = $1`,
        [cacheOtherId],
      )
      assert.equal(otherCacheCount.rows[0]?.count, 3)

      const totalCache = await db.query<{ count: number }>(
        'select count(*)::int as count from chat_pdf_page_cache',
      )
      const totalCacheCount = totalCache.rows[0]?.count ?? 0
      await prunePdfPageCache(cacheOwnerId, {
        totalRows: totalCacheCount - 1,
        userRows: 1_000_000,
      })
      const remainingCache = await db.query<{ count: number }>(
        'select count(*)::int as count from chat_pdf_page_cache',
      )
      assert.equal(remainingCache.rows[0]?.count, totalCacheCount - 1)
    } finally {
      await stopOcrQueue()
      await db.query(
        `delete from pgboss.job where data->>'attachmentId' in
           (select id::text from chat_attachment where user_id = any($1))`,
        [userIds],
      )
      await db.query('delete from "user" where id = ANY($1)', [userIds])
      await db.query('delete from "rateLimit" where key = $1', [
        '127.0.0.1|/sign-in/email',
      ])
      await db.end()
    }
  },
)
