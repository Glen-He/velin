import nodemailer from 'nodemailer'
import { config } from './config'
import { logger } from './logging'

type AuthenticationEmail = {
  to: string
  subject: string
  text: string
  purpose: 'sign-in' | 'forget-password' | 'email-verification' | 'change-email'
}

// 显式开发传输把最近验证码提供给本地页面；日志只记录投递事件。
// 生产不保存开发回码，且 config 禁止 production 使用 console 传输。
const devCodes = new Map<string, { otp: string; expiresAt: number }>()
const devCodeTtlMs = 5 * 60 * 1000

function tracksDevCodes() {
  return !config.isProduction && config.email.transport === 'console'
}

export function rememberDevCode(email: string, otp: string) {
  if (!tracksDevCodes()) {
    return
  }

  devCodes.set(email, { otp, expiresAt: Date.now() + devCodeTtlMs })
}

export function readDevCode(email: string) {
  if (!tracksDevCodes()) {
    return null
  }

  const stored = devCodes.get(email)

  if (!stored) {
    return null
  }

  if (stored.expiresAt < Date.now()) {
    devCodes.delete(email)
    return null
  }

  return stored.otp
}

const smtpTransport =
  config.email.transport === 'smtp'
    ? nodemailer.createTransport({
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        secure: config.email.smtp.secure,
        auth: {
          user: config.email.smtp.user,
          pass: config.email.smtp.password,
        },
      })
    : null

export async function sendAuthenticationEmail(message: AuthenticationEmail) {
  if (!smtpTransport) {
    logger.info('auth.email_preview', {
      recipient: message.to,
      purpose: message.purpose,
    })
    return
  }

  await smtpTransport.sendMail({
    from: config.email.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
  })
}
