import { describe, expect, it, vi } from 'vitest';
import type { AppController } from '../app-controller';
import { createIpcRouter, IpcRouteError, registerIpcHandlers } from './router';

function controllerStub(): AppController {
  return {
    getAppSnapshot: vi.fn(() => ({ catalog: {}, projects: [] })),
    updatePreferences: vi.fn(),
    selectProject: vi.fn(),
    registerProject: vi.fn(),
    listCodexProjects: vi.fn(),
    importCodexProjects: vi.fn(),
    updateProject: vi.fn(),
    relocateProject: vi.fn(),
    unregisterProject: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    removeGroup: vi.fn(),
    rescanProject: vi.fn(),
    listRevisions: vi.fn(),
    listActivity: vi.fn(),
    compareRevisions: vi.fn(),
    clearHistory: vi.fn(),
    getRetention: vi.fn(),
    setRetention: vi.fn(),
    revealArtifact: vi.fn(),
    revealUserData: vi.fn(),
    openExternal: vi.fn(),
  } as unknown as AppController;
}

describe('IpcRouter', () => {
  it('rejects unknown channels, malformed payloads, traversal, and unsafe schemes', async () => {
    const router = createIpcRouter(controllerStub());
    await expect(router.dispatch('unknown:channel', {})).rejects.toBeInstanceOf(IpcRouteError);
    await expect(router.dispatch('catalog:get-snapshot', { extra: true })).rejects.toThrow();
    await expect(
      router.dispatch('catalog:unregister-project', { projectId: '../other' }),
    ).rejects.toThrow();
    await expect(
      router.dispatch('system:reveal-artifact', {
        projectId: 'project-1',
        sourcePath: '../secret.md',
      }),
    ).rejects.toThrow();
    await expect(
      router.dispatch('system:open-external', { url: 'javascript:alert(1)' }),
    ).rejects.toThrow();
  });

  it('blocks invocations from closed renderer windows', async () => {
    const listeners = new Map<
      string,
      (event: { sender: { isDestroyed(): boolean } }, payload: unknown) => Promise<unknown>
    >();
    const ipcMain = {
      removeHandler: vi.fn(),
      handle: vi.fn(
        (
          channel: string,
          listener: (
            event: { sender: { isDestroyed(): boolean } },
            payload: unknown,
          ) => Promise<unknown>,
        ) => {
          listeners.set(channel, listener);
        },
      ),
    };
    const cleanup = registerIpcHandlers(ipcMain, createIpcRouter(controllerStub()));
    const listener = listeners.get('catalog:get-snapshot');
    expect(listener).toBeDefined();
    await expect(listener!({ sender: { isDestroyed: () => true } }, {})).rejects.toThrow(
      '调用窗口已经关闭',
    );
    cleanup();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('catalog:get-snapshot');
  });

  it('validates preference and retention requests at the IPC boundary', async () => {
    const controller = controllerStub();
    const router = createIpcRouter(controller);
    const preferences = {
      selectedProjectId: 'project-1',
      selectedChangeId: null,
      showArchived: true,
    };
    const retention = {
      projectId: 'project-1',
      retention: { revisionsPerArtifact: 25, activityPerProject: 500 },
    };
    await router.dispatch('catalog:update-preferences', preferences);
    await router.dispatch('history:set-retention', retention);
    await expect(
      router.dispatch('history:set-retention', {
        projectId: 'project-1',
        retention: { revisionsPerArtifact: 0, activityPerProject: 500 },
      }),
    ).rejects.toThrow();
    expect(controller.updatePreferences).toHaveBeenCalledWith(preferences);
    expect(controller.setRetention).toHaveBeenCalledWith(retention);
  });

  it('validates and forwards bounded Codex import requests', async () => {
    const controller = controllerStub();
    const router = createIpcRouter(controller);
    const request = { projects: [{ rootPath: 'C:/Projects/demo', displayName: 'Demo' }] };
    await router.dispatch('codex:list-projects', {});
    await router.dispatch('codex:import-projects', request);
    await expect(router.dispatch('codex:import-projects', { projects: [] })).rejects.toThrow();
    await expect(
      router.dispatch('codex:import-projects', {
        projects: [{ rootPath: 'C:/Projects/demo', displayName: 'x'.repeat(161) }],
      }),
    ).rejects.toThrow();
    expect(controller.listCodexProjects).toHaveBeenCalledOnce();
    expect(controller.importCodexProjects).toHaveBeenCalledWith(request);
  });
});
