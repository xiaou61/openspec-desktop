import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionCenterSnapshot, CodexHandoff } from '@shared/contracts';
import type { DesktopApi } from '@shared/desktop-api';
import { ActionCenterView } from './action-center-view';

const now = '2026-08-10T08:00:00.000Z';
const key = (value: string): string => `ac1:${value.repeat(64)}`;

function snapshot(items = true): ActionCenterSnapshot {
  return {
    schemaVersion: 1,
    scope: { kind: 'all' },
    status: 'partial',
    generatedAt: now,
    projects: [
      {
        projectId: 'project-a',
        projectName: 'Alpha project with a very long local name',
        projectRoot: 'C:/workspace/alpha/a/very/long/project/root',
        status: 'healthy',
        source: 'openspec-cli',
        checkedAt: now,
        diagnostics: [],
      },
      {
        projectId: 'project-b',
        projectName: 'Beta',
        projectRoot: 'C:/workspace/beta',
        status: 'degraded',
        source: 'structural',
        checkedAt: now,
        diagnostics: ['doctor timeout'],
      },
    ],
    items: items
      ? [
          {
            actionKey: key('a'),
            evidenceFingerprint: '1'.repeat(64),
            projectId: 'project-a',
            projectName: 'Alpha project with a very long local name',
            projectRoot: 'C:/workspace/alpha/a/very/long/project/root',
            changeId: 'custom-change',
            archived: false,
            actionType: 'complete-artifact',
            priority: 1,
            title: '完成 deploy 工件',
            description: 'deploy 仍待完成。',
            targetNode: 'proposal',
            targetArtifactId: 'deploy',
            evidence: [
              {
                source: 'openspec-cli',
                summary: 'deploy pending',
                relativePath: 'openspec/changes/custom-change/deploy.md',
                checkedAt: now,
              },
            ],
            evolution: {
              status: 'iteration',
              assessedAt: now,
              capabilities: [
                {
                  capabilityPath: 'openspec/changes/custom-change/specs/auth/spec.md',
                  targetPath: 'openspec/specs/auth/spec.md',
                  status: 'existing',
                },
              ],
            },
          },
          {
            actionKey: key('b'),
            evidenceFingerprint: '2'.repeat(64),
            projectId: 'project-b',
            projectName: 'Beta',
            projectRoot: 'C:/workspace/beta',
            changeId: 'reopened-change',
            archived: false,
            actionType: 'continue-implementation',
            priority: 2,
            title: '继续实施剩余 7 项任务',
            description: '当前完成 57/64。',
            targetNode: 'tasks',
            evidence: [
              {
                source: 'structural',
                summary: '任务 57/64，剩余 7',
                relativePath: 'openspec/changes/reopened-change/tasks.md',
                checkedAt: now,
              },
            ],
            taskGate: {
              applicable: true,
              status: 'incomplete',
              completed: 57,
              total: 64,
              remaining: 7,
              message: '仍有 7 项任务未完成',
            },
          },
          {
            actionKey: key('c'),
            evidenceFingerprint: '3'.repeat(64),
            projectId: 'project-a',
            projectName: 'Alpha project with a very long local name',
            projectRoot: 'C:/workspace/alpha/a/very/long/project/root',
            changeId: 'standard-change',
            archived: false,
            actionType: 'archive',
            priority: 1,
            title: '确认归档 standard-change',
            description: '工件、任务和严格验证均已满足。',
            targetNode: 'archive',
            evidence: [
              {
                source: 'openspec-cli',
                summary: '归档门槛通过',
                checkedAt: now,
              },
            ],
          },
        ]
      : [],
    diagnostics: [{ projectId: 'project-b', message: 'doctor timeout' }],
    summary: {
      projectCount: 2,
      actionCount: items ? 3 : 0,
      degradedProjectCount: 1,
    },
  };
}

function Wrapper({
  data = snapshot(),
  desktop,
  onOpen = vi.fn(),
}: {
  data?: ActionCenterSnapshot;
  desktop?: DesktopApi;
  onOpen?: (projectId: string, changeId?: string, archived?: boolean) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(data.items[0]?.actionKey ?? null);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ActionCenterView
        snapshot={data}
        loading={false}
        fetching={false}
        error={null}
        scope="all"
        currentProjectName="Alpha"
        selectedActionKey={selected}
        desktop={desktop}
        onScopeChange={vi.fn()}
        onSelectAction={setSelected}
        onRefresh={vi.fn()}
        onOpenAction={onOpen}
      />
    </QueryClientProvider>
  );
}

describe('ActionCenterView', () => {
  afterEach(() => cleanup());

  it('renders cross-project actions, custom artifacts, partial evidence and empty state', () => {
    const { rerender } = render(<Wrapper />);
    expect(screen.getByText('部分项目证据已降级')).toBeVisible();
    expect(screen.getByRole('option', { name: /Alpha.*完成 deploy 工件/ })).toBeVisible();
    expect(screen.getAllByText('能力迭代').length).toBeGreaterThan(0);
    expect(screen.getByText('deploy pending')).toBeVisible();

    rerender(<Wrapper data={snapshot(false)} />);
    expect(screen.getAllByText('当前范围没有待处理行动')).toHaveLength(2);
  });

  it('supports segmented scope, keyboard selection, refresh, copy and opening a Change', async () => {
    const user = userEvent.setup();
    const handoff: CodexHandoff = {
      schemaVersion: 1,
      actionKey: key('b'),
      evidenceFingerprint: '2'.repeat(64),
      generatedAt: now,
      stale: false,
      title: '继续实施剩余 7 项任务',
      markdown: '# Continue\n\n57/64',
    };
    const writeText = vi.fn().mockRejectedValue(new Error('Write permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const desktop = {
      buildCodexHandoff: vi.fn().mockResolvedValue(handoff),
      copyCodexHandoff: vi.fn().mockResolvedValue(handoff),
    } as unknown as DesktopApi;
    const onOpen = vi.fn();
    render(<Wrapper desktop={desktop} onOpen={onOpen} />);

    await user.click(screen.getByRole('button', { name: '当前项目' }));
    const first = screen.getByRole('option', { name: /Alpha.*完成 deploy 工件/ });
    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Beta.*继续实施剩余 7 项任务/ })).toHaveFocus();
    expect(screen.getByText('57 / 64')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '复制 Codex 交接' }));
    expect(desktop.copyCodexHandoff).toHaveBeenCalledWith({
      actionKey: key('b'),
      evidenceFingerprint: '2'.repeat(64),
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Codex 交接内容' })).toHaveValue(
      '# Continue\n\n57/64',
    );

    await user.click(screen.getByRole('button', { name: '打开 Change' }));
    expect(onOpen).toHaveBeenCalledWith('project-b', 'reopened-change', false);
  });

  it('opens archive actions without any assurance UI', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);

    const archiveRow = screen.getByRole('option', {
      name: /Alpha.*确认归档 standard-change/,
    });
    await user.click(archiveRow);

    expect(
      screen.getByRole('heading', { level: 1, name: '确认归档 standard-change' }),
    ).toBeVisible();
    expect(screen.queryByText('保障模式与策略')).toBeNull();
    expect(screen.queryByRole('list', { name: '保障建议' })).toBeNull();
    expect(screen.getByText('归档门槛通过')).toBeVisible();
  });
});
