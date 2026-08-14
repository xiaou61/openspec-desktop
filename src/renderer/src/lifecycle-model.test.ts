import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import type {
  ChangeLifecycleAssessment,
  ChangeProjection,
  LifecycleBlocker,
} from '@shared/contracts';
import type { DesktopApi } from '@shared/desktop-api';
import {
  lifecycleStagePresentation,
  useChangeValidation,
  validationActionPresentation,
} from './lifecycle-model';

const change = { archived: false } as ChangeProjection;

function blocker(code: LifecycleBlocker['code']): LifecycleBlocker {
  return {
    code,
    node: 'archive',
    title: code,
    detail: '阻塞原因',
    evidence: [],
  };
}

function assessment(
  overrides: Partial<ChangeLifecycleAssessment> = {},
): ChangeLifecycleAssessment {
  return {
    archived: false,
    projectAvailable: true,
    taskGate: { status: 'complete' },
    validation: { status: 'passed' },
    archiveReadiness: { status: 'not-ready', gates: [] },
    sync: { status: 'pending', summary: { pendingCount: 1 } },
    blockers: [],
    ...overrides,
  } as ChangeLifecycleAssessment;
}

describe('lifecycleStagePresentation retained blocker priority', () => {
  const blockerCases: Array<[LifecycleBlocker['code'], string, string]> = [
    ['artifact-incomplete', '缺少文档', 'amber'],
    ['artifact-unknown', '缺少文档', 'amber'],
    ['validation-required', '待验证', 'amber'],
    ['validation-failed', '验证失败', 'red'],
    ['validation-stale', '验证过期', 'amber'],
    ['validation-unavailable', '待确认', 'neutral'],
  ];

  it.each(blockerCases)(
    'maps %s through the authoritative blocker',
    (code, label, tone) => {
      const result = lifecycleStagePresentation(
        assessment({ blockers: [blocker(code)] }),
        change,
      );
      expect(result.label).toBe(label);
      expect(result.tone).toBe(tone);
    },
  );

  it('keeps incomplete tasks as an amber/blue in-progress state', () => {
    const result = lifecycleStagePresentation(
      assessment({
        taskGate: {
          applicable: true,
          status: 'incomplete',
          completed: 0,
          total: 3,
          remaining: 3,
        },
        blockers: [blocker('tasks-incomplete')],
      }),
      change,
    );
    expect(result.label).toBe('实施中');
    expect(result.tone).toBe('blue');
    expect(result.detail).toContain('3 项任务');
  });

  it('shows green 可归档 when the retained gates are ready', () => {
    const result = lifecycleStagePresentation(
      assessment({
        archiveReadiness: { status: 'ready', gates: [] },
      }),
      change,
    );
    expect(result.label).toBe('可归档');
    expect(result.tone).toBe('green');
    expect(result.detail).toContain('1 个能力');
  });

  it('falls back to neutral detail when validation is unavailable', () => {
    const result = lifecycleStagePresentation(
      assessment({
        taskGate: {
          applicable: true,
          status: 'complete',
          completed: 1,
          total: 1,
          remaining: 0,
        },
        validation: {
          status: 'unavailable',
          source: 'openspec-cli',
          diagnostics: [],
        },
      }),
      change,
    );
    expect(result.label).toBe('待确认');
    expect(result.tone).toBe('neutral');
  });

  it('shows running validation in the title status before retained validation blockers', () => {
    const result = lifecycleStagePresentation(
      assessment({
        validation: {
          status: 'running',
          source: 'validation-cache',
          diagnostics: [],
        },
        blockers: [blocker('validation-failed')],
      }),
      change,
    );
    expect(result).toMatchObject({
      label: '验证中',
      detail: '正在调用 OpenSpec 严格验证',
      tone: 'blue',
    });
  });
});

describe('validationActionPresentation', () => {
  it('shows the first-run action for an unverified Change', () => {
    const action = validationActionPresentation({ status: 'not-run', archived: false });
    expect(action).toMatchObject({
      visible: true,
      label: '运行严格验证',
      accessibleLabel: '运行严格验证',
      disabled: false,
    });
  });

  it.each(['stale', 'failed', 'unavailable'] as const)(
    'shows retry semantics for %s validation',
    (status) => {
      const action = validationActionPresentation({ status, archived: false });
      expect(action).toMatchObject({
        visible: true,
        label: '重新验证',
        accessibleLabel: '重新验证',
        disabled: false,
      });
    },
  );

  it('keeps the running action visible but prevents duplicate submission', () => {
    const action = validationActionPresentation({ status: 'running', archived: false });
    expect(action).toMatchObject({
      visible: true,
      label: '验证中',
      accessibleLabel: '正在运行严格验证',
      disabled: true,
    });
  });

  it('hides the primary action after a pass and for archived Changes', () => {
    expect(validationActionPresentation({ status: 'passed', archived: false }).visible).toBe(false);
    expect(validationActionPresentation({ status: 'failed', archived: true }).visible).toBe(false);
  });
});

describe('useChangeValidation identity scoping', () => {
  afterEach(() => cleanup());

  it('does not share pending mutation state between active and archived Changes with the same id', async () => {
    const queryClient = new QueryClient();
    const activeChange = { id: 'demo', archived: false } as ChangeProjection;
    const archivedChange = { id: 'demo', archived: true } as ChangeProjection;
    const runChangeValidation = vi
      .fn()
      .mockReturnValue(new Promise<ChangeLifecycleAssessment>(() => undefined));
    const desktop = { runChangeValidation } as unknown as DesktopApi;
    const wrapper = ({ children }: { children: ReactNode }) => (
      createElement(QueryClientProvider, { client: queryClient, children })
    );
    const { result, rerender } = renderHook(
      ({ change }: { change: ChangeProjection }) =>
        useChangeValidation('project-1', change, desktop),
      {
        initialProps: { change: activeChange },
        wrapper,
      },
    );

    result.current.mutate();
    await waitFor(() => expect(result.current.isPending).toBe(true));

    rerender({ change: archivedChange });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(runChangeValidation).toHaveBeenCalledTimes(1);
  });
});
