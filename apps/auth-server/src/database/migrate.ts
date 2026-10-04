import { resolve } from 'node:path'
import { runner } from 'node-pg-migrate'
import { config } from '../config.js'

const direction = process.argv[2]

if (direction !== 'up' && direction !== 'down') {
  throw new Error('Migration direction must be up or down.')
}

await runner({
  databaseUrl: config.databaseUrl,
  dir: resolve(import.meta.dirname, '../../migrations'),
  direction,
  count: direction === 'down' ? 1 : undefined,
  migrationsTable: 'velin_migrations',
  migrationLoaderStrategies: [{ extensions: ['.sql'], loader: 'sql' }],
})
