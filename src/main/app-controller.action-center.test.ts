import { describe, expect, it, vi } from 'vitest';
import type { ActionCenterSnapshot, CodexHandoff } from '@shared/contracts';
import { AppController } from './app-controller';
import type { ActionCenterService } from './action-center/action-center-service';
import type { CatalogService } from './catalog/catalog-service';
import type { WatcherManager } from './watcher/watcher-manager';

describe('AppController action center', () => {
  it('keeps regular queries cached, forces explicit refresh, and forwards bounded handoff identity', async () => {
    const snapshot = { status: 'complete' } as ActionCenterSnapshot;
    const handoff = { stale: false, markdown: '# Safe handoff' } as CodexHandoff;
    const getActionCenter = vi.fn().mockResolvedValue(snapshot);
    const buildCodexHandoff = vi.fn().mockResolvedValue(handoff);
    const writeText = vi.fn();
    const actionCenter = {
      getActionCenter,
      buildCodexHandoff,
      invalidate: vi.fn(),
    } as unknown as ActionCenterService;
    const controller = new AppController({
      userDataPath: 'C:/tmp/action-center-controller',
      catalog: {} as CatalogService,
      watchers: {} as WatcherManager,
      actionCenter,
      clipboardWriter: { writeText },
    });
    expect((controller as unknown as { projectInsights?: unknown }).projectInsights).toBeUndefined();
    const identity = {
      actionKey: `ac1:${'a'.repeat(64)}`,
      evidenceFingerprint: 'b'.repeat(64),
    };

    await expect(controller.getActionCenter({ projectId: 'project-1' })).resolves.toBe(snapshot);
    await expect(controller.refreshActionCenter({ projectId: 'project-1' })).resolves.toBe(
      snapshot,
    );
    await expect(controller.buildCodexHandoff(identity)).resolves.toBe(handoff);
    await expect(controller.copyCodexHandoff(identity)).resolves.toBe(handoff);
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('# Safe handoff');

    buildCodexHandoff.mockResolvedValueOnce({ ...handoff, stale: true });
    await expect(controller.copyCodexHandoff(identity)).resolves.toMatchObject({ stale: true });
    expect(writeText).toHaveBeenCalledOnce();

    expect(getActionCenter).toHaveBeenNthCalledWith(1, { projectId: 'project-1' });
    expect(getActionCenter).toHaveBeenNthCalledWith(2, {
      projectId: 'project-1',
      refresh: true,
    });
    expect(buildCodexHandoff).toHaveBeenCalledWith(identity);
  });
});
