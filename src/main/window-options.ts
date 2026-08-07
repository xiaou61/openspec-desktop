import type { BrowserWindowConstructorOptions } from 'electron';
import type { CatalogState } from '@shared/contracts';

export function createWindowOptions(
  preloadPath: string,
  bounds?: CatalogState['preferences']['windowBounds'],
  devTools = true,
): BrowserWindowConstructorOptions {
  const options: BrowserWindowConstructorOptions = {
    width: Math.max(bounds?.width ?? 1440, 920),
    height: Math.max(bounds?.height ?? 900, 640),
    minWidth: 920,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f5f3',
    autoHideMenuBar: true,
    title: 'OpenSpec Desktop',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools,
    },
  };
  if (bounds?.x !== undefined) options.x = bounds.x;
  if (bounds?.y !== undefined) options.y = bounds.y;
  return options;
}
