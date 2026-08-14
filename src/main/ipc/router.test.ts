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
    refreshVersion: vi.fn(),
    getChangeLifecycle: vi.fn(),
    runChangeValidation: vi.fn(),
    getActionCenter: vi.fn(),
    refreshActionCenter: vi.fn(),
    buildCodexHandoff: vi.fn(),
    copyCodexHandoff: vi.fn(),
    listRevisions: vi.fn(),
    listActivity: vi.fn(),
    listVersionSummaries: vi.fn(),
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
    await expect(router.dispatch('insights:get-project', {})).rejects.toBeInstanceOf(IpcRouteError);
    await expect(router.dispatch('insights:get-workspace-summary', {})).rejects.toBeInstanceOf(
      IpcRouteError,
    );
    await expect(router.dispatch('insights:get-capability', {})).rejects.toBeInstanceOf(
      IpcRouteError,
    );
    await expect(router.dispatch('insights:generate-digest', {})).rejects.toBeInstanceOf(
      IpcRouteError,
    );
    await expect(router.dispatch('insights:copy-digest', {})).rejects.toBeInstanceOf(IpcRouteError);
    await expect(router.dispatch('insights:export-digest', {})).rejects.toBeInstanceOf(
      IpcRouteError,
    );
    await expect(router.dispatch('assurance:get', {})).rejects.toBeInstanceOf(IpcRouteError);
    await expect(router.dispatch('assurance:import-report', {})).rejects.toBeInstanceOf(
      IpcRouteError,
    );
    await expect(router.dispatch('assurance:set-mode', {})).rejects.toBeInstanceOf(IpcRouteError);
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
    const request = {
      projects: [
        {
          rootPath: 'C:/Projects/demo',
          displayName: 'Demo',
          workspace: {
            id: 'workspace-1',
            rootPath: 'C:/Projects',
            displayName: 'Projects',
          },
        },
      ],
    };
    await router.dispatch('codex:list-projects', {});
    await router.dispatch('codex:import-projects', request);
    await expect(router.dispatch('codex:import-projects', { projects: [] })).rejects.toThrow();
    await expect(
      router.dispatch('codex:import-projects', {
        projects: [{ rootPath: 'C:/Projects/demo', displayName: 'x'.repeat(161) }],
      }),
    ).rejects.toThrow();
    await expect(
      router.dispatch('codex:import-projects', {
        projects: [
          {
            rootPath: 'C:/Projects/demo',
            displayName: 'Demo',
            workspace: { id: 'workspace-1', rootPath: 'C:/Projects' },
          },
        ],
      }),
    ).rejects.toThrow();
    expect(controller.listCodexProjects).toHaveBeenCalledOnce();
    expect(controller.importCodexProjects).toHaveBeenCalledWith(request);
  });

  it('validates version refresh and history filters before dispatching', async () => {
    const controller = controllerStub();
    const router = createIpcRouter(controller);
    await router.dispatch('project:refresh-version', { projectId: 'project-1' });
    await router.dispatch('history:list-version-summaries', { projectId: 'project-1' });
    await router.dispatch('history:list-activity', {
      projectId: 'project-1',
      versionKey: 'workspace',
      limit: 20,
    });
    await expect(
      router.dispatch('history:list-activity', {
        projectId: 'project-1',
        versionKey: 'v'.repeat(129),
      }),
    ).rejects.toThrow();
    expect(controller.refreshVersion).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(controller.listVersionSummaries).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(controller.listActivity).toHaveBeenCalledWith(
      expect.objectContaining({ versionKey: 'workspace' }),
    );
  });

  it('validates lifecycle identity and rejects archived validation requests at the boundary', async () => {
    const controller = controllerStub();
    const router = createIpcRouter(controller);
    const request = { projectId: 'project-1', changeId: 'change-a', archived: false };
    await router.dispatch('lifecycle:get-change', request);
    await router.dispatch('lifecycle:run-validation', {
      projectId: 'project-1',
      changeId: 'change-a',
    });
    await expect(
      router.dispatch('lifecycle:run-validation', {
        projectId: 'project-1',
        changeId: 'change-a',
        projectRoot: 'C:/Projects/demo',
      }),
    ).rejects.toThrow();
    await expect(
      router.dispatch('lifecycle:get-change', {
        projectId: 'project-1',
        changeId: '../secret',
        archived: false,
      }),
    ).rejects.toThrow();
    await expect(
      router.dispatch('lifecycle:run-validation', {
        projectId: 'project-1',
        changeId: 'change-a',
        archived: true,
      }),
    ).rejects.toThrow();
    expect(controller.getChangeLifecycle).toHaveBeenCalledWith(request);
    expect(controller.runChangeValidation).toHaveBeenCalledWith({
      projectId: 'project-1',
      changeId: 'change-a',
    });
  });

  it('exposes only bounded action-center queries and handoff identities', async () => {
    const controller = controllerStub();
    vi.mocked(controller.getActionCenter).mockResolvedValue({ status: 'partial' } as never);
    const router = createIpcRouter(controller);
    const scoped = { projectId: 'project-1' };
    const handoff = {
      actionKey: `ac1:${'a'.repeat(64)}`,
      evidenceFingerprint: 'b'.repeat(64),
    };

    await expect(router.dispatch('action-center:get', {})).resolves.toEqual({ status: 'partial' });
    await router.dispatch('action-center:refresh', scoped);
    await router.dispatch('action-center:build-handoff', handoff);
    await router.dispatch('action-center:copy-handoff', handoff);

    await expect(router.dispatch('action-center:get', { projectId: '../other' })).rejects.toThrow();
    await expect(
      router.dispatch('action-center:build-handoff', {
        ...handoff,
        actionKey: 'project-1:change-a',
      }),
    ).rejects.toThrow();
    await expect(
      router.dispatch('action-center:copy-handoff', {
        ...handoff,
        evidenceFingerprint: 'b'.repeat(63),
      }),
    ).rejects.toThrow();
    await expect(
      router.dispatch('action-center:build-handoff', {
        ...handoff,
        evidenceFingerprint: 'b'.repeat(63),
      }),
    ).rejects.toThrow();
    await expect(
      router.dispatch('action-center:refresh', { ...scoped, force: true }),
    ).rejects.toThrow();

    expect(controller.getActionCenter).toHaveBeenCalledWith({});
    expect(controller.refreshActionCenter).toHaveBeenCalledWith(scoped);
    expect(controller.buildCodexHandoff).toHaveBeenCalledWith(handoff);
    expect(controller.copyCodexHandoff).toHaveBeenCalledWith(handoff);
  });

});
