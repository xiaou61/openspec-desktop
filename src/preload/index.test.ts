import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
}));

describe('preload bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.exposeInMainWorld.mockClear();
    mocks.invoke.mockClear();
    mocks.on.mockClear();
    mocks.removeListener.mockClear();
  });

  it('exposes only named operations and cleans projection subscriptions', async () => {
    await import('./index');
    expect(mocks.exposeInMainWorld).toHaveBeenCalledOnce();
    const [name, api] = mocks.exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('desktop');
    expect(api).not.toHaveProperty('ipcRenderer');
    expect(api).not.toHaveProperty('filesystem');
    expect(api).toHaveProperty('getSnapshot');
    expect(api).toHaveProperty('updatePreferences');
    expect(api).toHaveProperty('rescanProject');
    expect(api).toHaveProperty('listCodexProjects');
    expect(api).toHaveProperty('importCodexProjects');
    expect(api).toHaveProperty('getRetention');
    expect(api).toHaveProperty('setRetention');
    expect(api).toHaveProperty('onProjection');

    const unsubscribe = (api.onProjection as (listener: () => void) => () => void)(vi.fn());
    expect(mocks.on).toHaveBeenCalledWith('projection:updated', expect.any(Function));
    unsubscribe();
    expect(mocks.removeListener).toHaveBeenCalledWith('projection:updated', expect.any(Function));

    await (api.listCodexProjects as () => Promise<unknown>)();
    await (api.importCodexProjects as (request: unknown) => Promise<unknown>)({
      projects: [{ rootPath: 'C:/Projects/demo', displayName: 'Demo' }],
    });
    expect(mocks.invoke).toHaveBeenCalledWith('codex:list-projects', {});
    expect(mocks.invoke).toHaveBeenCalledWith('codex:import-projects', {
      projects: [{ rootPath: 'C:/Projects/demo', displayName: 'Demo' }],
    });
  });
});
