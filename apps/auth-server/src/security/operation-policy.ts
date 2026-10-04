import {
  securityOperations,
  verificationMethods,
  type SecurityOperation,
} from '@velin/contracts/security'

// 按验证方法定义产品策略，不映射为标准化的数值保证等级。
export const operationRequirements = Object.fromEntries(
  securityOperations.map((operation) => [
    operation,
    { allowed: [...verificationMethods] },
  ]),
) as Record<
  SecurityOperation,
  { allowed: (typeof verificationMethods)[number][] }
>

// 保护最终写入端点，包括通行密钥注册。
export const operationByPath: Readonly<Record<string, SecurityOperation>> = {
  '/email-otp/change-email': 'changeEmail',
  '/passkey/verify-registration': 'addPasskey',
  '/passkey/delete-passkey': 'removePasskey',
  '/two-factor/enable': 'enableTwoFactor',
  '/two-factor/disable': 'disableTwoFactor',
  '/password/set': 'changePasswordVerified',
}
