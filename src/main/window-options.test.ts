import { describe, expect, it } from 'vitest';
import { createWindowOptions } from './window-options';

describe('createWindowOptions', () => {
  it('keeps the renderer isolated from privileged APIs', () => {
    const options = createWindowOptions('C:\\app\\preload.js');

    expect(options.webPreferences).toMatchObject({
      preload: 'C:\\app\\preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    });
    expect(options.minWidth).toBeGreaterThanOrEqual(900);
  });

  it('restores saved bounds without allowing an undersized window', () => {
    const options = createWindowOptions(
      'preload.js',
      { width: 320, height: 240, x: -80, y: 12 },
      false,
    );
    expect(options.width).toBe(920);
    expect(options.height).toBe(640);
    expect(options.x).toBe(-80);
    expect(options.y).toBe(12);
    expect(options.webPreferences?.devTools).toBe(false);
  });
});
