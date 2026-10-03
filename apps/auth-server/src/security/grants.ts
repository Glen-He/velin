import { databasePool } from '../database.js'
import { createOperationGrants } from './operation-grants.js'

export const operationGrants = createOperationGrants(databasePool)
