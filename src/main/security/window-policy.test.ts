import { describe, expect, it, vi } from 'vitest';
import { denyPermissionCheck, denyPermissionRequest } from './permission-policy';
import { applyWindowSecurity } from './window-policy';

describe('Electron window policy', () => {
  it('denies navigation, webviews, and unexpected windows', () => {
    const listeners = new Map<string, (event: { preventDefault(): void }) => void>();
    const contents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: (value: { preventDefault(): void }) => void) =>
        listeners.set(event, listener),
      ),
    };
    applyWindowSecurity(contents);
    const decision = contents.setWindowOpenHandler.mock.calls[0]![0]() as { action: string };
    expect(decision).toEqual({ action: 'deny' });
    const preventDefault = vi.fn();
    listeners.get('will-navigate')!({ preventDefault });
    listeners.get('will-attach-webview')!({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });

  it('denies all permission requests and checks', () => {
    const callback = vi.fn();
    denyPermissionRequest({}, 'notifications', callback);
    expect(callback).toHaveBeenCalledWith(false);
    expect(denyPermissionCheck()).toBe(false);
  });
});
