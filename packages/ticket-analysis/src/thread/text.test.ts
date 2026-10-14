import { describe, expect, it } from 'vitest';
import { detectSecrets, normalizeText, redactForDisplay, stripQuotedHistory } from './text.ts';

describe('stripQuotedHistory', () => {
  it('drops quoted lines and everything after a reply header', () => {
    const body = [
      'The login code never arrives.',
      '> Earlier: please refund my renewal',
      'On Mon, 2 Mar 2026, Support wrote:',
      'We sent the refund for review.',
    ].join('\n');
    expect(stripQuotedHistory(body)).toEqual({
      current: 'The login code never arrives.',
      removedHistory: true,
    });
  });

  it.each([
    'El lun, 2 mar 2026, Soporte escribió:',
    'Le lun. 2 mars 2026, Support a écrit :',
    'Am Mo., 2. März 2026 schrieb Support <support@example.com>:',
    '-----Original Message-----',
  ])('recognizes the reply header %s', (header) => {
    expect(stripQuotedHistory(`Still stuck.\n${header}\nOld text`).current).toBe('Still stuck.');
  });

  it('drops a signature without marking history', () => {
    expect(stripQuotedHistory('Export fails.\n--\nAvery\nSent from my phone')).toEqual({
      current: 'Export fails.',
      removedHistory: false,
    });
  });
});

describe('secrets', () => {
  it.each([
    ['an invented live key', 'my key {} stopped working', 'srl_live_9fQ2xLmP4tR7vB1nZ8', 'api_key'],
    ['a labeled token', 'token: {}', 'AbC123xyz789QwErTy', 'api_key'],
    ['a bearer token', 'Authorization: Bearer {}', 'abcdefghijklmnop1234', 'access_token'],
    ['a password', 'my password is {}', 'Tr0ub4dor&3', 'password'],
    ['a Spanish password', 'mi contraseña es {}', 'gato1234', 'password'],
    ['a test card number', 'card {} was charged', '4111111111111111', 'payment_card'],
  ])('detects and redacts %s', (_label, template, secret, kind) => {
    const text = template.replace('{}', secret);
    expect(detectSecrets(text)).toEqual([kind]);
    const redacted = redactForDisplay(text);
    expect(redacted).toBe(template.replace('{}', `[redacted:${kind}]`));
    expect(redacted).not.toContain(secret);
  });

  it('does not flag ordinary numbers, error codes, or IDs that fail the card checksum', () => {
    expect(detectSecrets('Error 401 after 3 retries on job 1234567890123 at 10:42')).toEqual([]);
    expect(detectSecrets('my password reset email never came')).toEqual([]);
  });

  it('redacts email addresses for display', () => {
    expect(redactForDisplay('reach me at avery@example.com')).toBe('reach me at [redacted:email]');
  });
});

describe('normalizeText', () => {
  it('folds case, curly quotes, and whitespace', () => {
    expect(normalizeText('  I DON\u2019T\n\tlike it ')).toBe("i don't like it");
  });
});
