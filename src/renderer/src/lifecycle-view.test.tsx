import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChangeLifecycleAssessment,
  LifecycleNodeState,
  ValidationStatus,
} from '@shared/contracts';
import { validationActionPresentation } from './lifecycle-model';
import { LifecycleTrack, ReadinessPane, ValidationActionButton } from './lifecycle-view';

function assessment(taskState: LifecycleNodeState): ChangeLifecycleAssessment {
  return {
    nodes: [
      { id: 'proposal', label: '提案', state: 'complete' },
      { id: 'specs', label: '规格', state: 'complete' },
      { id: 'design', label: '设计', state: 'complete' },
      { id: 'tasks', label: '任务', state: taskState },
      { id: 'validation', label: '验证', state: 'pending' },
      { id: 'archive', label: '归档', state: 'pending' },
    ],
  } as ChangeLifecycleAssessment;
}

function readinessAssessment(): ChangeLifecycleAssessment {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    changeId: 'demo',
    archiveKey: 'active:demo',
    archived: false,
    projectAvailable: true,
    contentFingerprint: 'b'.repeat(64),
    evaluatedAt: '2026-08-10T08:00:00.000Z',
    nodes: [
      { id: 'proposal', label: '提案', state: 'complete', source: 'openspec-cli', evidence: [] },
      { id: 'specs', label: '规格', state: 'complete', source: 'openspec-cli', evidence: [] },
      { id: 'design', label: '设计', state: 'complete', source: 'openspec-cli', evidence: [] },
      { id: 'tasks', label: '任务', state: 'complete', source: 'openspec-cli', evidence: [] },
      { id: 'validation', label: '验证', state: 'complete', source: 'openspec-cli', evidence: [] },
      { id: 'archive', label: '归档', state: 'ready', source: 'directory', evidence: [] },
    ],
    artifactGraph: {
      schemaName: 'spec-driven',
      source: 'openspec-cli',
      authoritative: true,
      applyRequires: [],
      artifacts: [{ id: 'proposal', status: 'done', requires: [] }],
    },
    taskGate: {
      applicable: true,
      status: 'complete',
      completed: 1,
      total: 1,
      remaining: 0,
      message: '任务完成',
    },
    validation: {
      status: 'passed',
      source: 'openspec-cli',
      checkedAt: '2026-08-10T08:00:00.000Z',
      message: '严格验证通过',
      diagnostics: [],
    },
    sync: {
      status: 'pending',
      checkedAt: '2026-08-10T08:00:00.000Z',
      message: '',
      summary: { pendingCount: 1 },
      capabilities: [],
    },
    archiveReadiness: {
      status: 'ready',
      gates: [
        { id: 'artifacts', label: '工件', status: 'pass', evidence: [] },
        { id: 'tasks', label: '任务', status: 'pass', evidence: [] },
        { id: 'validation', label: '严格验证', status: 'pass', evidence: [] },
      ],
    },
    nextAction: {
      kind: 'archive',
      targetNode: 'archive',
      title: '确认归档',
      description: '工件、任务和严格验证均已满足。',
    },
    blockers: [],
  } as unknown as ChangeLifecycleAssessment;
}

describe('LifecycleTrack task semantics', () => {
  afterEach(() => cleanup());

  it('uses current rather than a completion check for 57/64 task evidence', () => {
    render(
      <LifecycleTrack
        assessment={assessment('current')}
        loading={false}
        error={null}
        onSelect={vi.fn()}
      />,
    );
    const tasks = screen.getByRole('button', { name: '任务：当前' });
    expect(tasks.querySelector('.lucide-loader-circle')).not.toBeNull();
    expect(tasks.querySelector('.lucide-check')).toBeNull();
  });

  it('uses the neutral ready state rather than a completion check for 0/0 tasks', () => {
    render(
      <LifecycleTrack
        assessment={assessment('ready')}
        loading={false}
        error={null}
        onSelect={vi.fn()}
      />,
    );
    const tasks = screen.getByRole('button', { name: '任务：已就绪' });
    expect(tasks.querySelector('.lucide-circle-dashed')).not.toBeNull();
    expect(tasks.querySelector('.lucide-check')).toBeNull();
  });
});

describe('ReadinessPane archive readiness semantics', () => {
  afterEach(() => cleanup());

  it('renders 可以归档 and the three retained gates without assurance UI', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReadinessPane
          assessment={readinessAssessment()}
          loading={false}
          error={null}
          artifacts={[
            {
              relativePath: 'changes/demo/spec.md',
              sourcePath: 'openspec/changes/demo/spec.md',
            },
          ]}
          focusSection={null}
          focusNonce={0}
          onNavigateArtifact={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('可以归档')).toBeVisible();
    const archiveRegion = screen.getByRole('region', { name: '归档门槛' });
    expect(within(archiveRegion).getByText('工件')).toBeVisible();
    expect(within(archiveRegion).getByText('任务')).toBeVisible();
    expect(within(archiveRegion).getByText('严格验证')).toBeVisible();
    expect(screen.queryByText('规格保障')).toBeNull();
    expect(screen.queryByRole('note', { name: '标准模式保障建议' })).toBeNull();
  });
});

describe('ValidationActionButton', () => {
  afterEach(() => cleanup());

  it('runs the first validation from the Change title area', async () => {
    const onActivate = vi.fn();
    render(
      <ValidationActionButton
        changeName="demo"
        presentation={validationActionPresentation({ status: 'not-run', archived: false })}
        canRun
        running={false}
        error={null}
        onActivate={onActivate}
      />,
    );
    const button = screen.getByRole('button', { name: 'demo，运行严格验证' });
    expect(button).not.toHaveAttribute('aria-disabled');
    await userEvent.click(button);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it.each(['stale', 'failed', 'unavailable'] as ValidationStatus[])(
    'offers retry semantics for %s validation',
    (status) => {
      render(
        <ValidationActionButton
          changeName="demo"
          presentation={validationActionPresentation({ status, archived: false })}
          canRun
          running={false}
          error={null}
          onActivate={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: 'demo，重新验证' })).toBeVisible();
    },
  );

  it('keeps focus and blocks duplicate activation while running', async () => {
    const onActivate = vi.fn();
    render(
      <ValidationActionButton
        changeName="demo"
        presentation={validationActionPresentation({ status: 'running', archived: false })}
        canRun
        running
        error={null}
        onActivate={onActivate}
      />,
    );
    const button = screen.getByRole('button', { name: 'demo，正在运行严格验证' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('正在调用 OpenSpec 严格验证');
  });

  it('surfaces failure text and allows retry', async () => {
    const onActivate = vi.fn();
    render(
      <ValidationActionButton
        changeName="demo"
        presentation={validationActionPresentation({ status: 'failed', archived: false })}
        canRun
        running={false}
        error={new Error('OpenSpec CLI 退出码 1')}
        onActivate={onActivate}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('OpenSpec CLI 退出码 1');
    await userEvent.click(screen.getByRole('button', { name: 'demo，重新验证' }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('hides the primary action for passed and archived Changes', () => {
    const { rerender } = render(
      <ValidationActionButton
        changeName="demo"
        presentation={validationActionPresentation({ status: 'passed', archived: false })}
        canRun
        running={false}
        error={null}
        onActivate={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      <ValidationActionButton
        changeName="demo"
        presentation={validationActionPresentation({ status: 'failed', archived: true })}
        canRun
        running={false}
        error={null}
        onActivate={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
