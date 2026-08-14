import { useQuery } from '@tanstack/react-query';
import type { ActionCenterSnapshot } from '@shared/contracts';
import type { DesktopApi } from '@shared/desktop-api';

export function actionCenterQueryKey(projectId?: string): readonly string[] {
  return ['action-center', projectId ?? 'all'];
}

export function useActionCenter(desktop: DesktopApi | undefined, projectId?: string) {
  return useQuery<ActionCenterSnapshot>({
    queryKey: actionCenterQueryKey(projectId),
    queryFn: () => desktop!.getActionCenter(projectId ? { projectId } : {}),
    enabled: Boolean(desktop),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}
