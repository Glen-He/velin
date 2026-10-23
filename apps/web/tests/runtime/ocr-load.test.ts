import assert from 'node:assert/strict'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execFileAsync = promisify(execFile)
const enabled = Boolean(process.env.VELIN_TEST_DATABASE_URL)
const loadEnabled = enabled && process.env.VELIN_OCR_LOAD_TEST === '1'

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

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await Promise.race([exited, delay(15_000)])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

test(
  '300 page scanned PDF completes through the OCR worker',
  { skip: !loadEnabled, timeout: 55 * 60_000 },
  async () => {
    const { auth } = await import('../../src/lib/auth/server')
    const { databasePool: db } = await import(
      '../../src/lib/database/connection'
    )
    const { storeAttachment, loadAttachmentStatus } = await import(
      '../../src/lib/chat/attachments'
    )
    const { stopOcrQueue, getOcrQueue, ocrQueueName } = await import(
      '../../src/lib/ocr/queue'
    )
    const { pdfOcrEngineVersion } = await import('../../src/lib/ocr/pdf')
    const { createScannedPdf } = await import('./pdf-fixture')
    const bytes = await createScannedPdf(300)
    const user = await (
      await auth.$context
    ).internalAdapter.createUser(
      {
        name: 'OCR load test',
        email: `ocr-load-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      },
      { method: 'email-password' },
    )
    let child: ChildProcess | null = null
    let output = ''
    try {
      const attachment = await storeAttachment(user.id, {
        name: 'load-300.pdf',
        bytes,
      })
      const source = await db.query<{ sha256: string }>(
        'select sha256 from chat_attachment_source where attachment_id = $1',
        [attachment.id],
      )
      const sha256 = source.rows[0]!.sha256
      const generation = await db.query<{ ocr_generation: string }>(
        'select ocr_generation from chat_attachment where id = $1',
        [attachment.id],
      )
      const boss = await getOcrQueue()
      child = spawn(
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
      const worker = child
      worker.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      worker.stderr?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })

      const startedAt = Date.now()
      let lastCompleted = 0
      let firstSampleAt: number | null = null
      let finishedAt = startedAt
      let peakRssKb = 0
      let nextRssSample = 0
      let status: Awaited<ReturnType<typeof loadAttachmentStatus>> = null
      while (true) {
        status = await loadAttachmentStatus(user.id, attachment.id)
        assert.ok(status, 'OCR attachment disappeared during load test.')
        if (status.status === 'ready') {
          finishedAt = Date.now()
          break
        }
        if (status.status === 'failed' || status.status === 'canceled') {
          assert.fail(
            `300 page OCR ended as ${status.status}: ${status.ocrError ?? 'unknown error'}\n${output.slice(-8_000)}`,
          )
        }
        const completed = status.progress?.completed ?? 0
        assert.ok(
          completed >= lastCompleted,
          `OCR progress regressed from ${lastCompleted} to ${completed}.`,
        )
        if (completed > 0 && firstSampleAt === null) firstSampleAt = Date.now()
        lastCompleted = completed
        if (worker.exitCode !== null || worker.signalCode !== null) {
          assert.fail(
            `OCR worker exited before completion (${worker.exitCode ?? worker.signalCode}).\n${output.slice(-8_000)}`,
          )
        }
        if (Date.now() >= nextRssSample) {
          nextRssSample = Date.now() + 30_000
          if (worker.pid) {
            try {
              const { stdout } = await execFileAsync('ps', [
                '-o',
                'rss=',
                '-p',
                String(worker.pid),
              ])
              peakRssKb = Math.max(peakRssKb, Number(stdout.trim()) || 0)
            } catch {
              // 进程结束时采样失败不影响识别结果。
            }
          }
        }
        assert.ok(
          Date.now() - startedAt < 50 * 60_000,
          `300 page OCR exceeded 50 minutes.\n${output.slice(-8_000)}`,
        )
        await delay(2_000)
      }

      const result = await db.query<{
        status: string
        page_count: number
        ocr_completed_pages: number
        ocr_total_pages: number
        text_content: string
      }>(
        `select status, page_count, ocr_completed_pages, ocr_total_pages,
                text_content
         from chat_attachment where id = $1`,
        [attachment.id],
      )
      const row = result.rows[0]
      assert.equal(row?.status, 'ready')
      assert.equal(row?.page_count, 300)
      assert.equal(row?.ocr_completed_pages, 300)
      assert.equal(row?.ocr_total_pages, 300)
      assert.match(
        row?.text_content ?? '',
        /Revenue grew steadily this quarter/,
      )
      const pages = await db.query<{ count: number }>(
        `select count(*)::int as count from chat_attachment_page
         where attachment_id = $1 and source = 'ocr'
           and text_content like '%Revenue grew steadily this quarter%'`,
        [attachment.id],
      )
      assert.equal(pages.rows[0]?.count, 300)
      const cache = await db.query<{ count: number }>(
        `select count(*)::int as count from chat_pdf_page_cache
         where user_id = $1 and sha256 = $2 and engine_version = $3`,
        [user.id, sha256, pdfOcrEngineVersion],
      )
      assert.equal(cache.rows[0]?.count, 300)
      let job = await boss.getJobById(
        ocrQueueName,
        generation.rows[0]!.ocr_generation,
      )
      for (
        let attempt = 0;
        attempt < 50 && job?.state !== 'completed';
        attempt += 1
      ) {
        await delay(200)
        job = await boss.getJobById(
          ocrQueueName,
          generation.rows[0]!.ocr_generation,
        )
      }
      assert.equal(job?.state, 'completed')

      const elapsedMs = finishedAt - startedAt
      const pageSeconds =
        firstSampleAt === null
          ? null
          : (300 - 1) / ((finishedAt - firstSampleAt) / 1000)
      process.stdout.write(
        `OCR_LOAD_TEST_RESULT ${JSON.stringify({
          pages: 300,
          elapsedMs,
          pagesPerSecond: pageSeconds,
          peakRssMb: Math.round((peakRssKb / 1024) * 10) / 10,
          cacheRows: cache.rows[0]?.count,
        })}\n`,
      )
    } finally {
      if (child) await stopChild(child)
      await stopOcrQueue()
      await db.query(
        `delete from pgboss.job where data->>'attachmentId' in
           (select id::text from chat_attachment where user_id = $1)`,
        [user.id],
      )
      await db.query('delete from "user" where id = $1', [user.id])
      await db.end()
    }
  },
)
