import nodemailer from 'nodemailer';
import { getConfig } from '../config/env.js';
import { HttpError } from './http.js';

export async function sendOtpEmail(to: string, code: string, purpose: 'signup' | 'password-reset' | 'email-change') {
  const config = getConfig();
  if (!config.SMTP_HOST || !config.SMTP_FROM) {
    throw new HttpError(503, 'Email verification is unavailable until the mail provider is configured.', 'EMAIL_PROVIDER_NOT_CONFIGURED');
  }
  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE,
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } } : {}),
  });
  const subject = purpose === 'signup' ? 'AgriLink account verification' : purpose === 'email-change' ? 'AgriLink email change verification' : 'AgriLink password reset';
  await transporter.sendMail({
    from: config.SMTP_FROM, to, subject,
    text: 'Your AgriLink verification code is ' + code + '. It expires in 10 minutes. If you did not request this, ignore this message.',
  });
}

export async function sendSupportReplyEmail(to: string, originalSubject: string, reply: string) {
  const config = getConfig();
  if (!config.SMTP_HOST || !config.SMTP_FROM) throw new Error('SMTP is not configured.');
  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE,
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } } : {}),
  });
  const subject = originalSubject.trim() ? `Re: ${originalSubject.trim().slice(0, 180)}` : 'AgriLink support response';
  await transporter.sendMail({ from: config.SMTP_FROM, to, subject, text: reply });
}
