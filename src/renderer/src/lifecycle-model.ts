import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChangeLifecycleAssessment, ChangeProjection, ValidationStatus } from '@shared/contracts';
import type { DesktopApi } from '@shared/desktop-api';

type StatusTone = 'neutral' | 'green' | 'amber' | 'red' | 'blue';

export interface ValidationActionPresentation {
  visible: boolean;
  label: string;
  accessibleLabel: string;
  disabled: boolean;
  status: ValidationStatus;
}

export function validationActionPresentation(input: {
  status: ValidationStatus;
  archived: boolean;
}): ValidationActionPresentation {
  if (input.archived) {
    return {
      visible: false,
      label: '',
      accessibleLabel: '',
      disabled: true,
      status: input.status,
    };
  }
  switch (input.status) {
    case 'passed':
      return {
        visible: false,
        label: '',
        accessibleLabel: '',
        disabled: true,
        status: input.status,
      };
    case 'running':
      return {
        visible: true,
        label: '验证中',
        accessibleLabel: '正在运行严格验证',
        disabled: true,
        status: input.status,
      };
    case 'not-run':
      return {
        visible: true,
        label: '运行严格验证',
        accessibleLabel: '运行严格验证',
        disabled: false,
        status: input.status,
      };
    case 'stale':
    case 'failed':
    case 'unavailable':
      return {
        visible: true,
        label: '重新验证',
        accessibleLabel: '重新验证',
        disabled: false,
        status: input.status,
      };
  }
}

export function lifecycleQueryKey(
  projectId: string,
  changeId: string,
  archived: boolean,
): readonly [string, string, string, string] {
  return ['change-lifecycle', projectId, archived ? 'archive' : 'active', changeId] as const;
}

export function useChangeLifecycle(
  projectId: string | null,
  change: ChangeProjection | null,
  desktop: DesktopApi | undefined,
) {
  const canQuery = Boolean(
    projectId && change && desktop && typeof desktop.getChangeLifecycle === 'function',
  );
  return useQuery({
    queryKey: lifecycleQueryKey(
      projectId ?? 'no-project',
      change?.id ?? 'no-change',
      change?.archived ?? false,
    ),
    queryFn: () =>
      desktop!.getChangeLifecycle({
        projectId: projectId!,
        changeId: change!.id,
        archived: change!.archived,
      }),
    enabled: canQuery,
    staleTime: 2_000,
  });
}

export function useChangeValidation(
  projectId: string | null,
  change: ChangeProjection | null,
  desktop: DesktopApi | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [
      'run-change-validation',
      projectId ?? 'no-project',
      change?.archived ? 'archive' : 'active',
      change?.id ?? 'no-change',
    ],
    mutationFn: async () => {
      if (!projectId || !change || change.archived) {
        throw new Error('当前 Change 不允许重新验证');
      }
      if (!desktop || typeof desktop.runChangeValidation !== 'function') {
        throw new Error('严格验证在当前环境不可用');
      }
      const next = await desktop.runChangeValidation({
        projectId,
        changeId: change.id,
      });
      queryClient.setQueryData(lifecycleQueryKey(projectId, change.id, change.archived), next);
      void queryClient.invalidateQueries({ queryKey: ['action-center'] });
      return next;
    },
  });
}

export function lifecycleStagePresentation(
  assessment: ChangeLifecycleAssessment | undefined,
  change: ChangeProjection,
  effectiveValidationStatus: ValidationStatus = assessment?.validation.status ?? 'not-run',
): { label: string; detail: string; tone: StatusTone } {
  if (!assessment) {
    return {
      label: change.archived ? '已归档' : '状态加载中',
      detail: change.archived ? '归档记录' : '正在读取生命周期证据',
      tone: 'neutral',
    };
  }
  if (assessment.archived) {
    return { label: '已归档', detail: '生命周期证据只读', tone: 'neutral' };
  }
  if (effectiveValidationStatus === 'running') {
    return {
      label: '验证中',
      detail: '正在调用 OpenSpec 严格验证',
      tone: 'blue',
    };
  }
  if (!assessment.projectAvailable) {
    return { label: '待确认', detail: '项目证据不可用', tone: 'neutral' };
  }

  const readiness = assessment.archiveReadiness;
  if (readiness.status === 'ready') {
    return {
      label: '可归档',
      detail:
        assessment.sync.status === 'pending'
          ? `归档时将更新 ${assessment.sync.summary.pendingCount} 个能力`
          : '全部归档门槛已通过',
      tone: 'green',
    };
  }

  const blocker = assessment.blockers[0];
  if (blocker) {
    switch (blocker.code) {
      case 'project-unavailable':
        return { label: '待确认', detail: blocker.detail, tone: 'neutral' };
      case 'artifact-incomplete':
      case 'artifact-unknown':
        return { label: '缺少文档', detail: blocker.detail, tone: 'amber' };
      case 'tasks-incomplete':
        return {
          label: '实施中',
          detail:
            assessment.taskGate.status === 'incomplete'
              ? `还剩 ${assessment.taskGate.remaining} 项任务`
              : blocker.detail,
          tone: 'blue',
        };
      case 'tasks-unknown':
        return { label: '任务状态未知', detail: blocker.detail, tone: 'amber' };
      case 'validation-failed':
        return { label: '验证失败', detail: blocker.detail, tone: 'red' };
      case 'validation-stale':
        return { label: '验证过期', detail: blocker.detail, tone: 'amber' };
      case 'validation-required':
        return { label: '待验证', detail: blocker.detail, tone: 'amber' };
      case 'validation-unavailable':
        return { label: '待确认', detail: blocker.detail, tone: 'neutral' };
      default:
        return { label: '待确认', detail: blocker.detail, tone: 'neutral' };
    }
  }

  if (assessment.taskGate.status === 'incomplete') {
    return {
      label: '实施中',
      detail: `还剩 ${assessment.taskGate.remaining} 项任务`,
      tone: 'blue',
    };
  }
  if (assessment.validation.status === 'failed') {
    return { label: '验证失败', detail: '需要处理验证诊断', tone: 'red' };
  }
  if (assessment.validation.status === 'stale') {
    return { label: '验证过期', detail: '内容已变化，请重新验证', tone: 'amber' };
  }
  if (assessment.validation.status === 'not-run') {
    return { label: '待验证', detail: '尚无当前内容的严格验证', tone: 'amber' };
  }
  if (assessment.validation.status === 'unavailable') {
    return { label: '待确认', detail: '严格验证当前不可用', tone: 'neutral' };
  }
  return { label: '待确认', detail: '打开就绪证据查看详情', tone: 'neutral' };
}
