import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('renderer boundary assets', () => {
  it('ships a restrictive CSP without inline scripts or remote frames', async () => {
    const html = await readFile(resolve(process.cwd(), 'src/renderer/index.html'), 'utf8');
    const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('script-src *');
    expect(csp).not.toContain('frame-src http');
    expect(html).not.toMatch(/<script(?![^>]+src=)[^>]*>/i);
  });
});
