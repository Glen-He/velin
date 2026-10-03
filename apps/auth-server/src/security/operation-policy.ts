import {
  securityOperations,
  verificationMethods,
  type SecurityOperation,
} from '@velin/contracts/security'

// Method-specific product policy, not a standards-based numeric assurance level.
export const operationRequirements = Object.fromEntries(
  securityOperations.map((operation) => [
    operation,
    { allowed: [...verificationMethods] },
  ]),
) as Record<
  SecurityOperation,
  { allowed: (typeof verificationMethods)[number][] }
>

// Protect the endpoint that commits the mutation, including passkey registration.
export const operationByPath: Readonly<Record<string, SecurityOperation>> = {
  '/email-otp/change-email': 'changeEmail',
  '/passkey/verify-registration': 'addPasskey',
  '/passkey/delete-passkey': 'removePasskey',
  '/two-factor/enable': 'enableTwoFactor',
  '/two-factor/disable': 'disableTwoFactor',
  '/password/set': 'changePasswordVerified',
}
