import { describe, expect, it } from 'vitest';
import { scanText } from './scan.ts';

const kinds = (text: string) => scanText('file.txt', text).map((finding) => finding.kind);

describe('scanText', () => {
  it.each([
    ['-----BEGIN RSA PRIVATE KEY-----', 'private_key'],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'access_token'],
    ['AKIAABCDEFGHIJKLMNOP', 'access_token'],
    ['contact jane.doe@realmail.co for help', 'email'],
    ['call (415) 555-0134 today', 'phone'],
    ['card 4111 1111 1111 1111', 'payment_card'],
    ['postgresql://admin:hunter2@db.internal/prod', 'connection_password'],
  ])('flags %s', (text, kind) => {
    expect(kinds(text)).toEqual([kind]);
  });

  it.each([
    'person@example.com is a reserved example address',
    'postgresql://app:app@localhost:5432/support_reliability',
    'postgresql://app:***@localhost:5432/support_reliability',
    'sha256 e02ae60e86b80da3866098c0d731630d4e199cb11ebf40d78caa508f58e4cf1d',
    '"when": 1791950504677',
    'TEST_TOKEN_EXAMPLE is not token-shaped',
    'version 24.21.0 and date 2026-10-13',
  ])('allows %s', (text) => {
    expect(kinds(text)).toEqual([]);
  });

  it('reports the line number and never the matched value', () => {
    const findings = scanText('notes.md', 'first line\npostgresql://u:topsecret@h/db');
    expect(findings).toEqual([{ path: 'notes.md', line: 2, kind: 'connection_password' }]);
    expect(JSON.stringify(findings)).not.toContain('topsecret');
  });
});
