import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'

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

async function waitUntil<T>(
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const value = await read()
    if (accepts(value)) return value
    await delay(25)
  }
  throw new Error('OCR runtime condition timed out.')
}

test(
  'OCR worker fences stale attempts and recovers durable jobs',
  {
    skip: !enabled,
    timeout: 240_000,
  },
  async (context) => {
    const { auth } = await import('../../src/lib/auth/server')
    const { databasePool: db } = await import(
      '../../src/lib/database/connection'
    )
    const {
      storeAttachment,
      reprocessAttachment,
      cancelAttachmentProcessing,
      loadAttachmentStatus,
    } = await import('../../src/lib/chat/attachments')
    const { processPdfAttachment } = await import('../../src/lib/ocr/process')
    const { PdfOcrSession } = await import('../../src/lib/ocr/pdf')
    const { getOcrQueue, ocrQueueName, stopOcrQueue } = await import(
      '../../src/lib/ocr/queue'
    )
    const { startOcrWorker } = await import('../../src/lib/ocr/worker-runtime')
    const bytes = await readFile(
      new URL('../fixtures/sample-scan-3pages.pdf', import.meta.url),
    )
    const users: string[] = []
    const children = new Set<ChildProcess>()

    async function fixture() {
      const adapter = (await auth.$context).internalAdapter
      const email = `ocr-runtime-${crypto.randomUUID()}@example.test`
      const user = await adapter.createUser(
        { name: 'OCR runtime', email, emailVerified: true },
        { method: 'email-password' },
      )
      users.push(user.id)
      const attachment = await storeAttachment(user.id, {
        name: 'scan.pdf',
        bytes,
      })
      const row = await db.query<{ ocr_generation: string }>(
        'select ocr_generation from chat_attachment where id = $1',
        [attachment.id],
      )
      return {
        userId: user.id,
        attachmentId: attachment.id,
        generation: row.rows[0]!.ocr_generation,
      }
    }

    async function stopChild(
      child: ChildProcess,
      signal: NodeJS.Signals = 'SIGTERM',
    ) {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, 'exit')
      child.kill(signal)
      await exited
      children.delete(child)
    }

    function startChild() {
      const child = spawn(
        process.execPath,
        [
          '--conditions=react-server',
          '--import',
          'tsx',
          'scripts/ocr-worker.ts',
        ],
        {
          cwd: fileURLToPath(new URL('../../', import.meta.url)),
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.on('error', (error) => {
        output += error.message
      })
      children.add(child)
      return { child, output: () => output }
    }

    try {
      await context.test(
        'cancel fences an in-flight page and stale generation',
        async (subtest) => {
          const item = await fixture()
          const entered = Promise.withResolvers<void>()
          const released = Promise.withResolvers<void>()
          const recognition = subtest.mock.method(
            PdfOcrSession.prototype,
            'recognize',
            async () => {
              entered.resolve()
              await released.promise
              return { text: 'Stale page must not be saved.', confidence: 99 }
            },
          )
          const processing = processPdfAttachment(
            item.attachmentId,
            item.generation,
          )
          try {
            await Promise.race([
              entered.promise,
              processing.then(() => {
                throw new Error('OCR did not enter recognition.')
              }),
            ])
            assert.equal(
              await cancelAttachmentProcessing(item.userId, item.attachmentId),
              true,
            )
            assert.equal(
              (await loadAttachmentStatus(item.userId, item.attachmentId))
                ?.status,
              'canceled',
            )
            const requests = await Promise.allSettled([
              reprocessAttachment(item.userId, item.attachmentId, '2'),
              reprocessAttachment(item.userId, item.attachmentId, '2'),
            ])
            assert.equal(
              requests.filter((request) => request.status === 'fulfilled')
                .length,
              1,
            )
            assert.equal(
              requests.filter((request) => request.status === 'rejected')
                .length,
              1,
            )
          } finally {
            released.resolve()
            await processing
            recognition.mock.restore()
          }
          const rows = await db.query(
            'select 1 from chat_attachment_page where attachment_id = $1',
            [item.attachmentId],
          )
          assert.equal(rows.rowCount, 0)
          await processPdfAttachment(item.attachmentId, item.generation)
          assert.equal(
            (await loadAttachmentStatus(item.userId, item.attachmentId))
              ?.status,
            'processing',
          )
          const current = await db.query<{ ocr_generation: string }>(
            'select ocr_generation from chat_attachment where id = $1',
            [item.attachmentId],
          )
          await processPdfAttachment(
            item.attachmentId,
            current.rows[0]!.ocr_generation,
          )
          assert.equal(
            (await loadAttachmentStatus(item.userId, item.attachmentId))
              ?.status,
            'ready',
          )
        },
      )

      await context.test(
        'killed worker resumes from committed raw pages',
        async () => {
          const item = await fixture()
          const boss = await getOcrQueue()
          await db.query(
            'update pgboss.job set retry_delay = 0 where name = $1 and id = $2',
            [ocrQueueName, item.generation],
          )
          const first = startChild()
          const checkpoint = await waitUntil(
            async () => {
              assert.equal(first.child.exitCode, null, first.output())
              return db.query<{
                page_number: number
                text_content: string
                updated_at: Date
              }>(
                'select page_number, text_content, updated_at from chat_attachment_page where attachment_id = $1 order by page_number',
                [item.attachmentId],
              )
            },
            (result) => (result.rowCount ?? 0) > 0,
          )
          await stopChild(first.child, 'SIGKILL')
          assert.equal(
            (await loadAttachmentStatus(item.userId, item.attachmentId))
              ?.status,
            'processing',
          )
          await db.query(
            "update pgboss.job set heartbeat_on = now() - interval '5 minutes' where name = $1 and id = $2",
            [ocrQueueName, item.generation],
          )
          await boss.supervise(ocrQueueName)
          const second = startChild()
          const ready = await waitUntil(
            async () => {
              assert.equal(second.child.exitCode, null, second.output())
              return loadAttachmentStatus(item.userId, item.attachmentId)
            },
            (attachment) =>
              attachment?.status === 'ready' || attachment?.status === 'failed',
          )
          assert.equal(ready?.status, 'ready', ready?.ocrError)
          assert.equal(ready.pageCount, 3)
          const resumedPages = await db.query<{
            page_number: number
            text_content: string
            updated_at: Date
          }>(
            'select page_number, text_content, updated_at from chat_attachment_page where attachment_id = $1 order by page_number',
            [item.attachmentId],
          )
          assert.equal(resumedPages.rowCount, 3)
          for (const page of checkpoint.rows) {
            assert.deepEqual(
              resumedPages.rows.find(
                (row) => row.page_number === page.page_number,
              ),
              page,
            )
          }
          const job = await waitUntil(
            () => boss.getJobById(ocrQueueName, item.generation),
            (value) => value?.state === 'completed',
          )
          assert.equal(job?.retryCount, 1)
          await stopChild(second.child)
        },
      )

      await context.test(
        'transient failures retry and exhausted jobs leave processing',
        async (subtest) => {
          const item = await fixture()
          const boss = await getOcrQueue()
          await db.query(
            'update pgboss.job set retry_delay = 0 where name = $1 and id = $2',
            [ocrQueueName, item.generation],
          )
          const createSession = PdfOcrSession.create.bind(PdfOcrSession)
          let calls = 0
          const creation = subtest.mock.method(
            PdfOcrSession,
            'create',
            async () => {
              calls += 1
              if (calls === 1)
                throw new Error('Simulated transient worker failure.')
              return createSession()
            },
          )
          await startOcrWorker()
          const ready = await waitUntil(
            () => loadAttachmentStatus(item.userId, item.attachmentId),
            (attachment) =>
              attachment?.status === 'ready' || attachment?.status === 'failed',
          )
          assert.equal(ready?.status, 'ready', ready?.ocrError)
          const job = await waitUntil(
            () => boss.getJobById(ocrQueueName, item.generation),
            (value) => value?.state === 'completed',
          )
          assert.equal(job?.retryCount, 1)
          creation.mock.restore()

          const failingCreation = subtest.mock.method(
            PdfOcrSession,
            'create',
            async () => {
              throw new Error('Simulated persistent worker failure.')
            },
          )
          const failedItem = await fixture()
          await db.query(
            'update pgboss.job set retry_delay = 0 where name = $1 and id = $2',
            [ocrQueueName, failedItem.generation],
          )
          const failed = await waitUntil(
            () =>
              loadAttachmentStatus(failedItem.userId, failedItem.attachmentId),
            (attachment) => attachment?.status === 'failed',
          )
          assert.match(failed?.ocrError ?? '', /重试/)
          assert.equal(
            (await boss.getJobById(ocrQueueName, failedItem.generation))
              ?.retryCount,
            1,
          )
          failingCreation.mock.restore()
        },
      )
    } finally {
      for (const child of children) await stopChild(child, 'SIGKILL')
      await stopOcrQueue()
      await db.query(
        `delete from pgboss.job where data->>'attachmentId' in (select id::text from chat_attachment where user_id = any($1))`,
        [users],
      )
      await db.query('delete from "user" where id = any($1)', [users])
      await db.end()
    }
  },
)
