import { contextBridge, ipcRenderer } from 'electron';
import {
  codexImportResultSchema,
  codexProjectListSchema,
  projectionEventSchema,
} from '@shared/contracts';
import type { DesktopApi } from '@shared/desktop-api';
import {
  actionCenterRequestSchema,
  buildCodexHandoffRequestSchema,
  clearHistoryRequestSchema,
  changeLifecycleRequestSchema,
  codexImportProjectsRequestSchema,
  compareRevisionsRequestSchema,
  createGroupRequestSchema,
  emptyRequestSchema,
  groupMutationRequestSchema,
  historyListRequestSchema,
  historyRevisionListRequestSchema,
  refreshVersionRequestSchema,
  versionSummaryListRequestSchema,
  projectIdRequestSchema,
  openExternalRequestSchema,
  registerProjectRequestSchema,
  relocateProjectRequestSchema,
  selectRelocationRequestSchema,
  revealArtifactRequestSchema,
  runChangeValidationRequestSchema,
  setRetentionRequestSchema,
  updatePreferencesRequestSchema,
  updateProjectRequestSchema,
} from '@shared/ipc-contracts';

const projectionChannel = 'projection:updated';

const desktopApi: DesktopApi = {
  runtime: Object.freeze({ platform: process.platform }),
  getSnapshot: () => ipcRenderer.invoke('catalog:get-snapshot', emptyRequestSchema.parse({})),
  updatePreferences: (request) =>
    ipcRenderer.invoke('catalog:update-preferences', updatePreferencesRequestSchema.parse(request)),
  selectProject: () => ipcRenderer.invoke('catalog:select-project', emptyRequestSchema.parse({})),
  registerProject: (request) =>
    ipcRenderer.invoke('catalog:register-project', registerProjectRequestSchema.parse(request)),
  listCodexProjects: () =>
    ipcRenderer
      .invoke('codex:list-projects', emptyRequestSchema.parse({}))
      .then((response) => codexProjectListSchema.parse(response)),
  importCodexProjects: (request) =>
    ipcRenderer
      .invoke('codex:import-projects', codexImportProjectsRequestSchema.parse(request))
      .then((response) => codexImportResultSchema.parse(response)),
  updateProject: (request) =>
    ipcRenderer.invoke('catalog:update-project', updateProjectRequestSchema.parse(request)),
  relocateProject: (request) =>
    ipcRenderer.invoke('catalog:relocate-project', relocateProjectRequestSchema.parse(request)),
  selectRelocation: (request) =>
    ipcRenderer.invoke('catalog:select-relocation', selectRelocationRequestSchema.parse(request)),
  unregisterProject: (request) =>
    ipcRenderer.invoke('catalog:unregister-project', projectIdRequestSchema.parse(request)),
  createGroup: (request) =>
    ipcRenderer.invoke('catalog:create-group', createGroupRequestSchema.parse(request)),
  updateGroup: (request) =>
    ipcRenderer.invoke('catalog:update-group', groupMutationRequestSchema.parse(request)),
  removeGroup: (request) =>
    ipcRenderer.invoke('catalog:remove-group', groupMutationRequestSchema.parse(request)),
  rescanProject: (request) =>
    ipcRenderer.invoke('project:rescan', projectIdRequestSchema.parse(request)),
  refreshVersion: (request) =>
    ipcRenderer.invoke('project:refresh-version', refreshVersionRequestSchema.parse(request)),
  getChangeLifecycle: (request) =>
    ipcRenderer.invoke('lifecycle:get-change', changeLifecycleRequestSchema.parse(request)),
  runChangeValidation: (request) =>
    ipcRenderer.invoke('lifecycle:run-validation', runChangeValidationRequestSchema.parse(request)),
  getActionCenter: (request) =>
    ipcRenderer.invoke('action-center:get', actionCenterRequestSchema.parse(request)),
  refreshActionCenter: (request) =>
    ipcRenderer.invoke('action-center:refresh', actionCenterRequestSchema.parse(request)),
  buildCodexHandoff: (request) =>
    ipcRenderer.invoke(
      'action-center:build-handoff',
      buildCodexHandoffRequestSchema.parse(request),
    ),
  copyCodexHandoff: (request) =>
    ipcRenderer.invoke('action-center:copy-handoff', buildCodexHandoffRequestSchema.parse(request)),
  listRevisions: (request) =>
    ipcRenderer.invoke('history:list-revisions', historyRevisionListRequestSchema.parse(request)),
  listActivity: (request) =>
    ipcRenderer.invoke('history:list-activity', historyListRequestSchema.parse(request)),
  listVersionSummaries: (request) =>
    ipcRenderer.invoke(
      'history:list-version-summaries',
      versionSummaryListRequestSchema.parse(request),
    ),
  compareRevisions: (request) =>
    ipcRenderer.invoke('history:compare', compareRevisionsRequestSchema.parse(request)),
  clearHistory: (request) =>
    ipcRenderer.invoke('history:clear', clearHistoryRequestSchema.parse(request)),
  getRetention: (request) =>
    ipcRenderer.invoke('history:get-retention', projectIdRequestSchema.parse(request)),
  setRetention: (request) =>
    ipcRenderer.invoke('history:set-retention', setRetentionRequestSchema.parse(request)),
  revealArtifact: (request) =>
    ipcRenderer.invoke('system:reveal-artifact', revealArtifactRequestSchema.parse(request)),
  revealUserData: () => ipcRenderer.invoke('system:reveal-user-data', emptyRequestSchema.parse({})),
  getUserDataPath: () =>
    ipcRenderer.invoke('system:get-user-data-path', emptyRequestSchema.parse({})),
  openExternal: (url) =>
    ipcRenderer.invoke('system:open-external', openExternalRequestSchema.parse({ url })),
  onProjection: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = projectionEventSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(projectionChannel, handler);
    return () => ipcRenderer.removeListener(projectionChannel, handler);
  },
};

contextBridge.exposeInMainWorld('desktop', Object.freeze(desktopApi));
