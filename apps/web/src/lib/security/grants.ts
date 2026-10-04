import { databasePool } from '../database/connection'
import { createOperationGrants } from './operation-grants'

export const operationGrants = createOperationGrants(databasePool)
