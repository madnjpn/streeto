/**
 * Mail.
 *
 * The site speaks to its members through one Gmail account, over SMTP.
 * Gmail does not accept the account password for SMTP - it wants an App
 * Password (Google Account -> Security -> 2-Step Verification -> App
 * passwords). It goes into MAIL_PASS.
 *
 * When no password is set the site does not pretend: the reset form says
 * so instead of promising a letter that will never arrive. For a test on
 * a machine without the password, MAIL_CAPTURE=1 keeps every message in
 * a file under data/mail-capture/ instead of sending it.
 */
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import config, { ROOT } from '../config.js';

/** Messages kept in memory - the smoke test reads the link from here. */
export const outbox = [];

const CAPTURE_DIR = path.join(ROOT, 'data', 'mail-capture');

/** Whether the site can really send a letter. */
export const mailReady = () => Boolean(config.mail.user && config.mail.pass);

/** Whether a test run is holding the letters instead of sending them. */
export const mailCaptured = () => config.isTest || config.mail.capture;

/** Whether the reset flow can work at all: real post, or a capture run. */
export const mailUsable = () => mailReady() || mailCaptured();

let transport = null;

function transportFor() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: { user: config.mail.user, pass: config.mail.pass },
    pool: true,
    maxConnections: 2,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
  });
  return transport;
}

/** Keep a copy on disk so it can be looked at without an inbox. */
function capture(message) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = String(message.to || 'unknown').replace(/[^a-z0-9@._-]/gi, '_');
  try {
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CAPTURE_DIR, `${stamp}-${safe}.html`), message.html || '', 'utf8');
  } catch (error) {
    console.error('[mail] could not write the capture file:', error.message);
  }
  outbox.push({ ...message, sentAt: new Date().toISOString(), captured: true });
  console.log(`[mail] captured for ${message.to}: ${message.subject}`);
}

/**
 * Send one letter.
 * @returns {Promise<{ captured: boolean, id?: string }>}
 */
export async function sendMail({ to, subject, html, text }) {
  const message = { from: config.mail.from, to, subject, html, text };
  if (config.mail.replyTo) message.replyTo = config.mail.replyTo;

  if (config.isTest || config.mail.capture || !mailReady()) {
    capture(message);
    return { captured: true };
  }

  const info = await transportFor().sendMail(message);
  return { captured: false, id: info.messageId };
}

export default { sendMail, mailReady, mailCaptured, outbox };
