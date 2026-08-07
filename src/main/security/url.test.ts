import { describe, expect, it } from 'vitest';
import { assertAllowedExternalUrl } from './url';

describe('assertAllowedExternalUrl', () => {
  it('allows only credential-free HTTPS destinations', () => {
    expect(assertAllowedExternalUrl('https://example.com/docs')).toBe('https://example.com/docs');
    expect(() => assertAllowedExternalUrl('http://example.com')).toThrow();
    expect(() => assertAllowedExternalUrl('javascript:alert(1)')).toThrow();
    expect(() => assertAllowedExternalUrl('https://user:pass@example.com')).toThrow();
  });
});
