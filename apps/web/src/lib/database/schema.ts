import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Pool } from 'pg'

export async function assertDatabaseSchema(database: Pick<Pool, 'query'>) {
  const files = await readdir(resolve(process.cwd(), 'migrations'))
  const expected = files
    .filter((file) => file.endsWith('.up.sql'))
    .map((file) => file.slice(0, -7))
  const result = await database.query<{ name: string }>(
    'select name from velin_migrations',
  )
  const applied = new Set(result.rows.map((row) => row.name))
  if (expected.some((name) => !applied.has(name)))
    throw new Error('Database migrations must run before starting the service.')
}
