import { join, resolve } from 'node:path';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { AppController } from './app-controller';
import { CatalogService } from './catalog/catalog-service';
import { CatalogStore } from './catalog/catalog-store';
import { createIpcRouter, registerIpcHandlers, type IpcMainLike } from './ipc/router';
import { WatcherManager } from './watcher/watcher-manager';
import { createWindowOptions } from './window-options';
import { denyPermissionCheck, denyPermissionRequest } from './security/permission-policy';
import { applyWindowSecurity } from './security/window-policy';

let mainWindow: BrowserWindow | null = null;
let watcherManager: WatcherManager | null = null;
let catalogService: CatalogService | null = null;
let appController: AppController | null = null;
let unregisterIpc: (() => void) | null = null;
let shuttingDown = false;
let shutdownComplete = false;
let boundsTimer: ReturnType<typeof setTimeout> | undefined;
let pendingBounds: { width: number; height: number; x?: number; y?: number } | undefined;
let boundsWrite: Promise<void> = Promise.resolve();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function enqueueBoundsWrite(bounds: {
  width: number;
  height: number;
  x?: number;
  y?: number;
}): void {
  boundsWrite = boundsWrite
    .catch(() => undefined)
    .then(async () => {
      await catalogService?.setPreferences({ windowBounds: bounds });
    })
    .catch(() => undefined);
}

async function createServices(): Promise<AppController> {
  const userDataOverride = process.env['OPENSPEC_DESKTOP_USER_DATA'];
  if (userDataOverride) app.setPath('userData', resolve(userDataOverride));
  const userDataPath = app.getPath('userData');
  let activeController: AppController | null = null;
  watcherManager = new WatcherManager({
    userDataPath,
    onProjection: (event) => activeController?.handleProjection(event),
    onState: (projectId, state, error) =>
      activeController?.handleWatcherState(projectId, state, error),
  });
  catalogService = new CatalogService(new CatalogStore(userDataPath), {
    startMonitoring: (project) => watcherManager?.startProject(project),
    stopMonitoring: (projectId) => watcherManager?.stopProject(projectId),
  });
  activeController = new AppController({
    userDataPath,
    userHome: app.getPath('home'),
    ...(process.env['CODEX_HOME'] ? { codexHome: process.env['CODEX_HOME'] } : {}),
    catalog: catalogService,
    watchers: watcherManager,
  });
  await activeController.initialize();
  appController = activeController;
  unregisterIpc = registerIpcHandlers(
    ipcMain as unknown as IpcMainLike,
    createIpcRouter(activeController),
  );
  return activeController;
}

function scheduleBoundsPersistence(window: BrowserWindow): void {
  if (!catalogService || window.isDestroyed() || window.isMinimized() || window.isMaximized())
    return;
  pendingBounds = window.getBounds();
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    boundsTimer = undefined;
    if (!catalogService || window.isDestroyed() || !pendingBounds) return;
    const bounds = pendingBounds;
    pendingBounds = undefined;
    enqueueBoundsWrite(bounds);
  }, 200);
}

async function flushBoundsPersistence(): Promise<void> {
  if (boundsTimer) {
    clearTimeout(boundsTimer);
    boundsTimer = undefined;
  }
  if (catalogService && pendingBounds) {
    const bounds = pendingBounds;
    pendingBounds = undefined;
    enqueueBoundsWrite(bounds);
  }
  await boundsWrite;
}

function createWindow(activeController: AppController): BrowserWindow {
  const bounds = catalogService?.snapshot().preferences.windowBounds;
  const window = new BrowserWindow(
    createWindowOptions(join(__dirname, '../preload/index.js'), bounds, !app.isPackaged),
  );
  const unsubscribe = activeController.subscribe(window);

  applyWindowSecurity(window.webContents);
  window.once('ready-to-show', () => window.show());
  window.on('resize', () => scheduleBoundsPersistence(window));
  window.on('move', () => scheduleBoundsPersistence(window));
  window.on('closed', () => {
    unsubscribe();
    if (mainWindow === window) mainWindow = null;
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) void window.loadURL(rendererUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}

async function shutdown(): Promise<void> {
  if (shutdownComplete) return;
  if (boundsTimer) clearTimeout(boundsTimer);
  unregisterIpc?.();
  unregisterIpc = null;
  appController?.disposeSubscribers();
  await flushBoundsPersistence();
  await watcherManager?.closeAll();
  await appController?.flush();
  shutdownComplete = true;
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler(denyPermissionRequest);
      session.defaultSession.setPermissionCheckHandler(denyPermissionCheck);
      app.on('web-contents-created', (_event, contents) => {
        applyWindowSecurity(contents);
      });
      const activeController = await createServices();
      mainWindow = createWindow(activeController);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(activeController);
      });
    })
    .catch((error: unknown) => {
      console.error('OpenSpec Desktop failed to start', error);
      app.quit();
    });
}

app.on('before-quit', (event) => {
  if (shutdownComplete || shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  void shutdown().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
