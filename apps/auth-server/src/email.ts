import nodemailer from 'nodemailer'
import { config } from './config.js'

type AuthenticationEmail = {
  to: string
  subject: string
  text: string
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
