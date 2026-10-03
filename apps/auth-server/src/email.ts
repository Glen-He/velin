import nodemailer from 'nodemailer'
import { config } from './config.js'

type AuthenticationEmail = {
  to: string
  subject: string
  text: string
}

// 本地开发没有真实邮件投递，验证码只打进终端。这里额外记住每个收件地址
// 最近一次的明文码，让页面可以直接取用；生产环境两个函数都是空操作，
// 且 config 已禁止 production 使用 console 传输。
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
    console.info(
      `[Velin 开发邮件] 收件人：${message.to}\n主题：${message.subject}\n${message.text}`,
    )
    return
  }

  await smtpTransport.sendMail({
    from: config.email.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
  })
}
