// Invio email dietro interfaccia. ConsoleMailer = solo sviluppo. SmtpMailer = SMTP minimale senza dipendenze (SMTP_URL).
import net from 'node:net';
import tls from 'node:tls';

export interface Mailer { sendOtp(email: string, code: string): Promise<void> }

export class ConsoleMailer implements Mailer {
  async sendOtp(email: string, code: string): Promise<void> {
    // Solo sviluppo: il codice finisce nel log. In produzione createMailerFromEnv rifiuta questa implementazione.
    console.log(`[mail:console] codice di accesso per ${email}: ${code}`);
  }
}

interface Reply { code: number; text: string }

class SmtpConn {
  private buf = '';
  private replies: Reply[] = [];
  private waiters: ((r: Reply | Error) => void)[] = [];
  private err: Error | null = null;
  constructor(public sock: net.Socket) { this.attach(sock); }
  private attach(s: net.Socket) {
    s.setEncoding('utf8');
    s.on('data', (d: string) => { this.buf += d; this.parse(); });
    s.on('error', (e) => this.fail(e));
    s.on('close', () => this.fail(new Error('connessione SMTP chiusa')));
  }
  private fail(e: Error) { this.err = e; for (const w of this.waiters.splice(0)) w(e); }
  private parse() {
    for (;;) {
      const lines = this.buf.split('\r\n');
      let end = -1;
      for (let i = 0; i < lines.length - 1; i++) if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) { end = i; break; }
      if (end < 0) return;
      const used = lines.slice(0, end + 1);
      this.buf = lines.slice(end + 1).join('\r\n');
      const r = { code: Number(used[end].slice(0, 3)), text: used.map((l) => l.slice(4)).join('\n') };
      const w = this.waiters.shift();
      if (w) w(r); else this.replies.push(r);
    }
  }
  read(): Promise<Reply> {
    const r = this.replies.shift();
    if (r) return Promise.resolve(r);
    if (this.err) return Promise.reject(this.err);
    return new Promise((res, rej) => this.waiters.push((x) => (x instanceof Error ? rej(x) : res(x))));
  }
  async cmd(line: string, ok: number[]): Promise<Reply> {
    this.sock.write(line + '\r\n');
    const r = await this.read();
    if (!ok.includes(r.code)) throw new Error(`SMTP ${r.code}`);
    return r;
  }
  upgrade(host: string) {
    this.sock.removeAllListeners();
    this.buf = ''; this.replies = [];
    const t = tls.connect({ socket: this.sock, servername: host });
    this.sock = t; this.attach(t);
  }
}

export class SmtpMailer implements Mailer {
  private url: URL;
  private from: string;
  constructor(smtpUrl: string, from = process.env.SMTP_FROM || 'no-reply@localhost') {
    this.url = new URL(smtpUrl);
    if (!/[^\r\n<>]+/.test(from) || /[\r\n]/.test(from)) throw new Error('SMTP_FROM non valido');
    this.from = from;
  }
  async sendOtp(email: string, code: string): Promise<void> {
    if (/[\r\n<>]/.test(email)) throw new Error('indirizzo non valido');
    const secure = this.url.protocol === 'smtps:';
    const host = this.url.hostname;
    const port = Number(this.url.port || (secure ? 465 : 587));
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    const timer = setTimeout(() => sock.destroy(new Error('timeout SMTP')), 20_000);
    const c = new SmtpConn(sock);
    try {
      let r = await c.read();
      if (r.code !== 220) throw new Error('SMTP greeting');
      r = await c.cmd('EHLO vocepreventivo', [250]);
      if (!secure && /STARTTLS/i.test(r.text)) {
        await c.cmd('STARTTLS', [220]);
        c.upgrade(host);
        r = await c.cmd('EHLO vocepreventivo', [250]);
      } else if (!secure && (process.env.SMTP_REQUIRE_TLS ?? (process.env.NODE_ENV === 'production' ? '1' : '0')) === '1') {
        throw new Error('STARTTLS non disponibile');
      }
      if (this.url.username) {
        const u = decodeURIComponent(this.url.username), p = decodeURIComponent(this.url.password);
        await c.cmd('AUTH PLAIN ' + Buffer.from(`\0${u}\0${p}`).toString('base64'), [235]);
      }
      await c.cmd(`MAIL FROM:<${this.from}>`, [250]);
      await c.cmd(`RCPT TO:<${email}>`, [250, 251]);
      await c.cmd('DATA', [354]);
      const body = [
        `From: <${this.from}>`, `To: <${email}>`, 'Subject: Il tuo codice di accesso a VocePreventivo',
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '',
        `Il tuo codice di accesso e': ${code}`, 'Vale 10 minuti. Se non l\'hai richiesto, ignora questo messaggio.',
      ].join('\r\n');
      await c.cmd(body.replace(/^\./gm, '..') + '\r\n.', [250]);
      await c.cmd('QUIT', [221]).catch(() => undefined);
    } finally {
      clearTimeout(timer);
      c.sock.destroy();
    }
  }
}

export function createMailerFromEnv(): Mailer {
  if (process.env.SMTP_URL) return new SmtpMailer(process.env.SMTP_URL);
  if (process.env.NODE_ENV === 'production') throw new Error('SMTP_URL obbligatorio in produzione (ConsoleMailer vietato)');
  return new ConsoleMailer();
}

let current: Mailer | null = null;
export const getMailer = (): Mailer => (current ??= createMailerFromEnv());
export const setMailer = (m: Mailer | null): void => { current = m; };
