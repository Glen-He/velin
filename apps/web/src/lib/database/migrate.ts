import { resolve } from 'node:path'
import { runner } from 'node-pg-migrate'

if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required for migrations.')

const direction = process.argv[2]

if (direction !== 'up' && direction !== 'down') {
  throw new Error('Migration direction must be up or down.')
}

await runner({
  databaseUrl: process.env.DATABASE_URL,
  dir: resolve(import.meta.dirname, '../../../migrations'),
  direction,
  count: direction === 'down' ? 1 : undefined,
  migrationsTable: 'velin_migrations',
  migrationLoaderStrategies: [{ extensions: ['.sql'], loader: 'sql' }],
})
