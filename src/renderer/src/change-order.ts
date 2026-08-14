import type { ChangeProjection } from '@shared/contracts';

export const CHANGE_PAGE_SIZE = 10;

function changeActivityTime(change: ChangeProjection): number | null {
  if (!change.lastActivityAt) return null;
  const timestamp = Date.parse(change.lastActivityAt);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function sortChangesByRecentActivity(changes: ChangeProjection[]): ChangeProjection[] {
  return changes.slice().sort((left, right) => {
    const leftTime = changeActivityTime(left);
    const rightTime = changeActivityTime(right);
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    if (leftTime !== null && rightTime === null) return -1;
    if (leftTime === null && rightTime !== null) return 1;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  });
}
