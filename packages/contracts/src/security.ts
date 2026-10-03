import { z } from 'zod'

// Method describes the evidence, not a standards-based assurance level.
export const verificationMethods = [
  'emailOtp',
  'totp',
  'backupCode',
  'passkey',
] as const
export type VerificationMethod = (typeof verificationMethods)[number]
export const securityOperations = [
  'changeEmail',
  'addPasskey',
  'removePasskey',
  'enableTwoFactor',
  'disableTwoFactor',
  'changePasswordVerified',
] as const
export type SecurityOperation = (typeof securityOperations)[number]
export const operationSchema = z.enum(securityOperations)
export const verificationIntentSchema = z
  .object({
    operation: operationSchema,
    target: z.string().max(256).default(''),
  })
  .strict()
  .refine(
    (value) => value.operation !== 'removePasskey' || value.target.length > 0,
  )
export type VerificationIntent = z.infer<typeof verificationIntentSchema>
export const operationGrantHeader = 'x-velin-operation-grant'
export const operationGrantValidityMs = 5 * 60 * 1000
export const operationGrantSchema = z.object({
  id: z.uuid(),
  expiresAt: z.number(),
  operation: operationSchema,
})
export type OperationGrant = z.infer<typeof operationGrantSchema>
export const operationRequirementsSchema = z.object({
  allowed: z.array(z.enum(verificationMethods)),
})
export const securityStateSchema = z.object({
  requirements: z.record(operationSchema, operationRequirementsSchema),
})
export type SecurityState = z.infer<typeof securityStateSchema>
