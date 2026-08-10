import type { z } from 'zod';
import {
  clearHistoryRequestSchema,
  codexImportProjectsRequestSchema,
  codexListProjectsRequestSchema,
  compareRevisionsRequestSchema,
  createGroupRequestSchema,
  emptyRequestSchema,
  groupMutationRequestSchema,
  historyListRequestSchema,
  historyRevisionListRequestSchema,
  refreshVersionRequestSchema,
  versionSummaryListRequestSchema,
  setRetentionRequestSchema,
  ipcChannelSchema,
  openExternalRequestSchema,
  projectIdRequestSchema,
  registerProjectRequestSchema,
  relocateProjectRequestSchema,
  selectRelocationRequestSchema,
  revealArtifactRequestSchema,
  scanRequestSchema,
  updateProjectRequestSchema,
  updatePreferencesRequestSchema,
  type IpcChannel,
} from '@shared/ipc-contracts';
import type { AppController } from '../app-controller';

type Route = (payload: unknown) => Promise<unknown>;

export class IpcRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcRouteError';
  }
}

export class IpcRouter {
  private readonly routes = new Map<IpcChannel, Route>();

  add<TSchema extends z.ZodType>(
    channel: IpcChannel,
    schema: TSchema,
    handler: (payload: z.infer<TSchema>) => Promise<unknown> | unknown,
  ): void {
    this.routes.set(channel, async (payload) => handler(schema.parse(payload ?? {})));
  }

  channels(): IpcChannel[] {
    return [...this.routes.keys()];
  }

  async dispatch(channel: string, payload: unknown): Promise<unknown> {
    const parsedChannel = ipcChannelSchema.safeParse(channel);
    if (!parsedChannel.success) throw new IpcRouteError('未知 IPC 通道');
    const route = this.routes.get(parsedChannel.data);
    if (!route) throw new IpcRouteError('IPC 通道未注册');
    return route(payload);
  }
}

export function createIpcRouter(controller: AppController): IpcRouter {
  const router = new IpcRouter();
  router.add('catalog:get-snapshot', emptyRequestSchema, () => controller.getAppSnapshot());
  router.add('catalog:update-preferences', updatePreferencesRequestSchema, (request) =>
    controller.updatePreferences(request),
  );
  router.add('catalog:select-project', emptyRequestSchema, () => controller.selectProject());
  router.add('catalog:register-project', registerProjectRequestSchema, (request) =>
    controller.registerProject(request),
  );
  router.add('catalog:update-project', updateProjectRequestSchema, (request) =>
    controller.updateProject(request),
  );
  router.add('catalog:relocate-project', relocateProjectRequestSchema, (request) =>
    controller.relocateProject(request),
  );
  router.add('catalog:select-relocation', selectRelocationRequestSchema, (request) =>
    controller.selectRelocation(request),
  );
  router.add('catalog:unregister-project', projectIdRequestSchema, (request) =>
    controller.unregisterProject(request.projectId),
  );
  router.add('catalog:create-group', createGroupRequestSchema, (request) =>
    controller.createGroup(request),
  );
  router.add('catalog:update-group', groupMutationRequestSchema, (request) =>
    controller.updateGroup(request),
  );
  router.add('catalog:remove-group', groupMutationRequestSchema, (request) =>
    controller.removeGroup(request.groupId),
  );
  router.add('codex:list-projects', codexListProjectsRequestSchema, () =>
    controller.listCodexProjects(),
  );
  router.add('codex:import-projects', codexImportProjectsRequestSchema, (request) =>
    controller.importCodexProjects(request),
  );
  router.add('project:scan', scanRequestSchema, (request) =>
    controller.rescanProject(request.projectId),
  );
  router.add('project:rescan', projectIdRequestSchema, (request) =>
    controller.rescanProject(request.projectId),
  );
  router.add('project:refresh-version', refreshVersionRequestSchema, (request) =>
    controller.refreshVersion(request),
  );
  router.add('project:get-snapshot', projectIdRequestSchema, (request) => {
    const project = controller
      .getAppSnapshot()
      .projects.find((entry) => entry.project.id === request.projectId);
    if (!project) throw new IpcRouteError('项目不存在');
    return project;
  });
  router.add('history:list-revisions', historyRevisionListRequestSchema, (request) =>
    controller.listRevisions(request),
  );
  router.add('history:list-activity', historyListRequestSchema, (request) =>
    controller.listActivity(request),
  );
  router.add('history:list-version-summaries', versionSummaryListRequestSchema, (request) =>
    controller.listVersionSummaries(request),
  );
  router.add('history:compare', compareRevisionsRequestSchema, (request) =>
    controller.compareRevisions(request),
  );
  router.add('history:clear', clearHistoryRequestSchema, (request) =>
    controller.clearHistory(request),
  );
  router.add('history:get-retention', projectIdRequestSchema, (request) =>
    controller.getRetention(request.projectId),
  );
  router.add('history:set-retention', setRetentionRequestSchema, (request) =>
    controller.setRetention(request),
  );
  router.add('system:reveal-artifact', revealArtifactRequestSchema, (request) =>
    controller.revealArtifact(request),
  );
  router.add('system:reveal-user-data', emptyRequestSchema, () => controller.revealUserData());
  router.add('system:get-user-data-path', emptyRequestSchema, () => controller.getUserDataPath());
  router.add('system:open-external', openExternalRequestSchema, (request) =>
    controller.openExternal(request.url),
  );
  return router;
}

export interface IpcMainLike {
  removeHandler(channel: string): void;
  handle(
    channel: string,
    listener: (event: { sender: { isDestroyed(): boolean } }, payload: unknown) => Promise<unknown>,
  ): void;
}

export function registerIpcHandlers(ipcMain: IpcMainLike, router: IpcRouter): () => void {
  for (const channel of router.channels()) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, payload) => {
      if (event.sender.isDestroyed()) throw new IpcRouteError('调用窗口已经关闭');
      return router.dispatch(channel, payload);
    });
  }
  return () => {
    for (const channel of router.channels()) ipcMain.removeHandler(channel);
  };
}
