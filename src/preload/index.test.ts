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
    expect(api).not.toHaveProperty('getSpecAssurance');
    expect(api).not.toHaveProperty('refreshSpecAssurance');
    expect(api).not.toHaveProperty('previewAssuranceReport');
    expect(api).not.toHaveProperty('selectAssuranceReportFile');
    expect(api).not.toHaveProperty('importAssuranceReport');
    expect(api).not.toHaveProperty('updateAssuranceConflict');
    expect(api).not.toHaveProperty('setSpecAssuranceMode');
    expect(api).not.toHaveProperty('clearSpecAssuranceData');
    expect(api).not.toHaveProperty('getProjectInsights');
    expect(api).not.toHaveProperty('getProjectInsightsWorkspaceSummary');
    expect(api).not.toHaveProperty('getProjectInsightsCapability');
    expect(api).not.toHaveProperty('generateProjectInsightsDigest');
    expect(api).not.toHaveProperty('copyProjectInsightsDigest');
    expect(api).not.toHaveProperty('exportProjectInsightsDigest');
    expect(api).toHaveProperty('getSnapshot');
    expect(api).toHaveProperty('updatePreferences');
    expect(api).toHaveProperty('rescanProject');
    expect(api).toHaveProperty('listCodexProjects');
    expect(api).toHaveProperty('importCodexProjects');
    expect(api).toHaveProperty('getRetention');
    expect(api).toHaveProperty('setRetention');
    expect(api).toHaveProperty('onProjection');

    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'codex:list-projects') {
        return Promise.resolve({
          entries: [],
          summary: {
            source: 'primary',
            indexedRootCount: 0,
            workspaceCount: 0,
            repositoryCount: 0,
            openSpecProjectCount: 0,
            availableCount: 0,
            truncated: false,
            truncationReasons: [],
          },
          scannedAt: '2026-08-12T00:00:00.000Z',
        });
      }
      if (channel === 'codex:import-projects') {
        return Promise.resolve({
          snapshot: {
            catalog: {
              schemaVersion: 3,
              groups: [],
              projects: [],
              preferences: {
                selectedProjectId: null,
                selectedChangeId: null,
                showArchived: false,
                windowBounds: { width: 1440, height: 900 },
              },
            },
            projects: [],
          },
          items: [
            {
              rootPath: 'C:/Projects/demo',
              displayName: 'Demo',
              status: 'imported',
              projectId: 'project-1',
            },
          ],
        });
      }
      return Promise.resolve(undefined);
    });

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
