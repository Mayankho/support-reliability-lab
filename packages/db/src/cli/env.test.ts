import { describe, expect, it } from 'vitest';
import { databaseUrlSchema, redactDatabaseUrl } from '../client.ts';

describe('database URL handling', () => {
  it('accepts postgres URLs and rejects anything else', () => {
    expect(
      databaseUrlSchema.safeParse('postgresql://app:app@localhost:5432/support_reliability')
        .success,
    ).toBe(true);
    expect(databaseUrlSchema.safeParse('mysql://app:app@localhost/db').success).toBe(false);
    expect(
      databaseUrlSchema.safeParse('postgresql://app:app@localhost:5432/db; drop table x').success,
    ).toBe(false);
  });

  it('redacts the password before a URL is logged', () => {
    expect(redactDatabaseUrl('postgresql://app:s3cret@localhost:5432/support_reliability')).toBe(
      'postgresql://app:***@localhost:5432/support_reliability',
    );
  });
});
