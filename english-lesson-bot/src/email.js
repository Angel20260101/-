import nodemailer from 'nodemailer';

export function createTransport(mailConfig) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: mailConfig.user, pass: mailConfig.appPassword },
  });
}

export async function sendLesson({ mailConfig, subject, html, text, audio }, { transport } = {}) {
  const mailer = transport ?? createTransport(mailConfig);

  const message = {
    from: `"${mailConfig.fromName}" <${mailConfig.user}>`,
    to: mailConfig.to,
    subject,
    text,
    html,
  };

  if (audio) {
    message.attachments = [{ filename: 'lesson.mp3', content: audio, contentType: 'audio/mpeg' }];
  }

  const info = await mailer.sendMail(message);
  return info;
}
