import { writeFile } from 'node:fs/promises'
import { getMigrations } from 'better-auth/db/migration'
import { auth } from '../src/lib/auth/server'
import { databasePool } from '../src/lib/database/connection'

// 使用公开生成 API，不为 CLI 移除服务端保护，也不直接执行 SQL 草案。
try {
  const result = await getMigrations(auth.options, { throwOnUnsafe: false })
  const fileName = process.argv[2] ?? 'migrations/generated.sql'
  if (result.unsafeChanges?.length || result.schemaProblems?.length)
    throw new Error(
      [...(result.unsafeChanges ?? []), ...(result.schemaProblems ?? [])].join(
        '\n',
      ),
    )
  const code = (await result.compileMigrations()).trim()
  if (code && code !== ';') {
    await writeFile(fileName, code + '\n', { flag: 'wx' })
    process.stdout.write(
      `Authentication schema draft written to ${fileName}.\n`,
    )
  } else process.stdout.write('No authentication schema changes to generate.\n')
} finally {
  await databasePool.end()
}
