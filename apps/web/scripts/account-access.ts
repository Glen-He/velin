import { setAccountEnabled } from '../src/lib/auth/account-access'
import { databasePool } from '../src/lib/database/connection'

const [action, userId, ...extra] = process.argv.slice(2)
if (
  !['suspend', 'restore'].includes(action ?? '') ||
  !userId ||
  userId.length > 128 ||
  extra.length
) {
  throw new Error('Usage: account:access <suspend|restore> <userId>')
}
try {
  await setAccountEnabled(userId, action === 'restore')
  process.stdout.write(
    JSON.stringify({
      event: 'account.access_changed',
      userId,
      enabled: action === 'restore',
    }) + '\n',
  )
} finally {
  await databasePool.end()
}
