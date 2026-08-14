/// <reference types="node" />
// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesRoot = resolve(process.cwd(), 'src/renderer/src/styles');
const lifecycle = readFileSync(resolve(stylesRoot, 'lifecycle.css'), 'utf8');
const motion = readFileSync(resolve(stylesRoot, 'motion.css'), 'utf8');
const responsive = readFileSync(resolve(stylesRoot, 'responsive.css'), 'utf8');

describe('refined motion contract', () => {
  it('uses property-specific transitions and the six-node lifecycle grid', () => {
    expect(motion).not.toMatch(/transition\s*:\s*all/);
    expect(lifecycle).toContain('grid-template-columns: repeat(6, minmax(0, 1fr))');
    expect(lifecycle).not.toContain('repeat(7');
  });

  it('removes motion while preserving non-animated state feedback for reduced motion', () => {
    expect(responsive).toContain('@media (prefers-reduced-motion: reduce)');
    expect(responsive).toMatch(/\.disclosure-panel,[\s\S]*transition: none !important/);
    expect(responsive).toMatch(/\.spin[\s\S]*animation: none !important/);
    expect(responsive).toMatch(/\.toast,[\s\S]*transform: none !important/);
  });
});
