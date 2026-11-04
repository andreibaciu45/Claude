import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { ConsoleMailer, SmtpMailer, createMailerFromEnv } from '../../src/auth/mailer';

describe('mailer', () => {
  it('SmtpMailer parla SMTP con un server finto (senza TLS)', async () => {
    const received: string[] = [];
    const server = net.createServer((s) => {
      let data = false; let buf = '';
      s.write('220 test\r\n');
      s.on('data', (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (data) { if (line === '.') { data = false; s.write('250 ok\r\n'); } else received.push(line); continue; }
          if (line.startsWith('EHLO')) s.write('250-test\r\n250 8BITMIME\r\n');
          else if (line === 'DATA') { data = true; s.write('354 go\r\n'); }
          else if (line === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
          else s.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    await new SmtpMailer(`smtp://127.0.0.1:${port}`, 'no-reply@example.com').sendOtp('a@x.it', '123456');
    server.close();
    expect(received.join('\n')).toContain('123456');
    expect(received.join('\n')).toContain('To: <a@x.it>');
  });
  it('rifiuta indirizzi con CR/LF (header injection)', async () => {
    await expect(new SmtpMailer('smtp://127.0.0.1:1').sendOtp('a@x.it\r\nBcc: v@x.it', '1')).rejects.toThrow();
  });
  it('in produzione senza SMTP_URL il ConsoleMailer è vietato', () => {
    const env = { ...process.env };
    process.env.NODE_ENV = 'production'; delete process.env.SMTP_URL;
    try { expect(() => createMailerFromEnv()).toThrow(); } finally { process.env.NODE_ENV = env.NODE_ENV; }
    expect(createMailerFromEnv()).toBeInstanceOf(ConsoleMailer);
  });
});
