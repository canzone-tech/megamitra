import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Socket, connect as netConnect } from 'node:net';
import { TLSSocket, connect as tlsConnect } from 'node:tls';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import {
  AuthEmailTemplatePurposeDto,
} from './auth-email-template.dto';
import {
  AuthEmailTemplateService,
  type RenderedAuthEmail,
} from './auth-email-template.service';

type SmtpSocket = Socket | TLSSocket;
type LineIterator = AsyncIterator<string>;

type SmtpReply = {
  code: number;
  lines: string[];
};

@Injectable()
export class SmtpMailService {
  private readonly logger = new Logger(SmtpMailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly templates: AuthEmailTemplateService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('SMTP_HOST')?.trim() &&
      this.config.get<string>('SMTP_FROM_EMAIL')?.trim(),
    );
  }

  publicAppUrl(): string {
    return (this.config.get<string>('MEGAMITRA_PUBLIC_URL') ?? 'http://127.0.0.1:3102').replace(/\/$/, '');
  }

  async sendAuthEmail(
    purpose: AuthEmailTemplatePurposeDto,
    to: string,
    variables: Record<string, string>,
  ): Promise<{ templateVersionId: string }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('SMTP delivery is not configured');
    }
    const rendered = await this.templates.renderPublished(purpose, variables);
    await this.sendRendered(to, rendered);
    return { templateVersionId: rendered.templateVersionId };
  }

  private async sendRendered(to: string, message: RenderedAuthEmail): Promise<void> {
    const host = this.config.getOrThrow<string>('SMTP_HOST').trim();
    const port = Number(this.config.get<number>('SMTP_PORT') ?? 587);
    const secure = this.booleanConfig('SMTP_SECURE', false);
    const requireTls = this.booleanConfig('SMTP_REQUIRE_TLS', true);
    const username = this.config.get<string>('SMTP_USERNAME')?.trim() ?? '';
    const password = this.config.get<string>('SMTP_PASSWORD') ?? '';
    const fromEmail = this.cleanAddress(this.config.getOrThrow<string>('SMTP_FROM_EMAIL'));
    const fromName = this.cleanHeader(this.config.get<string>('SMTP_FROM_NAME') ?? 'MegaMitra');
    const recipient = this.cleanAddress(to);
    const timeoutMs = Number(this.config.get<number>('SMTP_TIMEOUT_MS') ?? 10000);

    let socket: SmtpSocket | null = null;
    let lines: ReadlineInterface | null = null;
    try {
      socket = secure
        ? await this.connectTls(host, port, timeoutMs)
        : await this.connectPlain(host, port, timeoutMs);
      ({ lines } = this.createLineReader(socket));
      let iterator = lines[Symbol.asyncIterator]();
      await this.expectReply(iterator, [220]);

      let ehlo = await this.command(socket, iterator, `EHLO ${this.cleanEhloHost(hostname())}`, [250]);
      if (!secure && requireTls) {
        if (!ehlo.lines.some((line) => /STARTTLS/i.test(line))) {
          throw new Error('SMTP server does not advertise STARTTLS');
        }
        await this.command(socket, iterator, 'STARTTLS', [220]);
        lines.close();
        socket = await this.upgradeTls(socket, host, timeoutMs);
        ({ lines } = this.createLineReader(socket));
        iterator = lines[Symbol.asyncIterator]();
        ehlo = await this.command(socket, iterator, `EHLO ${this.cleanEhloHost(hostname())}`, [250]);
      }

      if (username) {
        await this.authenticate(socket, iterator, ehlo, username, password);
      }

      await this.command(socket, iterator, `MAIL FROM:<${fromEmail}>`, [250]);
      await this.command(socket, iterator, `RCPT TO:<${recipient}>`, [250, 251]);
      await this.command(socket, iterator, 'DATA', [354]);
      const wireMessage = this.buildMessage(fromName, fromEmail, recipient, message);
      socket.write(`${this.dotStuff(wireMessage)}\r\n.\r\n`);
      await this.expectReply(iterator, [250]);
      await this.command(socket, iterator, 'QUIT', [221]);
    } catch (error) {
      this.logger.error(`SMTP delivery failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      throw new ServiceUnavailableException('Email delivery is temporarily unavailable');
    } finally {
      lines?.close();
      socket?.destroy();
    }
  }

  private async authenticate(
    socket: SmtpSocket,
    iterator: LineIterator,
    ehlo: SmtpReply,
    username: string,
    password: string,
  ): Promise<void> {
    const capabilities = ehlo.lines.join(' ').toUpperCase();
    if (/AUTH[^\r\n]*\bPLAIN\b/.test(capabilities)) {
      const token = Buffer.from(`\0${username}\0${password}`, 'utf8').toString('base64');
      await this.command(socket, iterator, `AUTH PLAIN ${token}`, [235]);
      return;
    }
    if (/AUTH[^\r\n]*\bLOGIN\b/.test(capabilities)) {
      await this.command(socket, iterator, 'AUTH LOGIN', [334]);
      await this.command(socket, iterator, Buffer.from(username).toString('base64'), [334]);
      await this.command(socket, iterator, Buffer.from(password).toString('base64'), [235]);
      return;
    }
    throw new Error('SMTP server does not advertise a supported authentication mechanism');
  }

  private buildMessage(
    fromName: string,
    fromEmail: string,
    to: string,
    message: RenderedAuthEmail,
  ): string {
    const subject = this.encodeHeader(this.cleanHeader(message.subject));
    const messageId = `<${randomUUID()}@megamitra.local>`;
    const headers = [
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
      `From: ${this.encodeHeader(fromName)} <${fromEmail}>`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
    ];

    if (!message.html) {
      return [
        ...headers,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        this.normalizeCrlf(message.text),
      ].join('\r\n');
    }

    const boundary = `megamitra-${randomUUID()}`;
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      this.normalizeCrlf(message.text),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      this.normalizeCrlf(message.html),
      `--${boundary}--`,
    ].join('\r\n');
  }

  private async connectPlain(host: string, port: number, timeoutMs: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = netConnect({ host, port });
      const onError = (error: Error) => reject(error);
      socket.once('error', onError);
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error('SMTP socket timeout')));
      socket.once('connect', () => {
        socket.off('error', onError);
        resolve(socket);
      });
    });
  }

  private async connectTls(host: string, port: number, timeoutMs: number): Promise<TLSSocket> {
    return new Promise((resolve, reject) => {
      const socket = tlsConnect({ host, port, servername: host });
      const onError = (error: Error) => reject(error);
      socket.once('error', onError);
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error('SMTP TLS socket timeout')));
      socket.once('secureConnect', () => {
        socket.off('error', onError);
        resolve(socket);
      });
    });
  }

  private async upgradeTls(socket: Socket | TLSSocket, host: string, timeoutMs: number): Promise<TLSSocket> {
    return new Promise((resolve, reject) => {
      const secureSocket = tlsConnect({ socket, servername: host });
      const onError = (error: Error) => reject(error);
      secureSocket.once('error', onError);
      secureSocket.setTimeout(timeoutMs, () => secureSocket.destroy(new Error('SMTP STARTTLS timeout')));
      secureSocket.once('secureConnect', () => {
        secureSocket.off('error', onError);
        resolve(secureSocket);
      });
    });
  }

  private createLineReader(socket: SmtpSocket): { lines: ReadlineInterface } {
    return { lines: createInterface({ input: socket, crlfDelay: Infinity }) };
  }

  private async command(
    socket: SmtpSocket,
    iterator: LineIterator,
    value: string,
    expected: number[],
  ): Promise<SmtpReply> {
    socket.write(`${value}\r\n`);
    return this.expectReply(iterator, expected);
  }

  private async expectReply(iterator: LineIterator, expected: number[]): Promise<SmtpReply> {
    const lines: string[] = [];
    let code = 0;
    for (;;) {
      const next = await iterator.next();
      if (next.done) throw new Error('SMTP connection closed unexpectedly');
      const line = String(next.value);
      lines.push(line);
      const match = /^(\d{3})([ -])/.exec(line);
      if (!match) continue;
      code = Number(match[1]);
      if (match[2] === ' ') break;
    }
    if (!expected.includes(code)) {
      throw new Error(`SMTP command failed with ${code}`);
    }
    return { code, lines };
  }

  private cleanAddress(value: string): string {
    const address = value.trim();
    if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(address)) {
      throw new Error('Invalid SMTP email address');
    }
    return address;
  }

  private cleanHeader(value: string): string {
    if (/[\r\n]/.test(value)) throw new Error('Invalid SMTP header value');
    return value.trim();
  }

  private cleanEhloHost(value: string): string {
    return value.replace(/[^a-zA-Z0-9.-]/g, '-') || 'megamitra.local';
  }

  private encodeHeader(value: string): string {
    return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  }

  private normalizeCrlf(value: string): string {
    return value.replace(/\r?\n/g, '\r\n');
  }

  private dotStuff(value: string): string {
    return this.normalizeCrlf(value)
      .split('\r\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
  }

  private booleanConfig(key: string, fallback: boolean): boolean {
    const value = this.config.get<string | boolean>(key);
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return value.toLowerCase() === 'true';
  }
}
