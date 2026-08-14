import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Archive,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clipboard,
  FileWarning,
  ListTodo,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import type {
  ActionCenterActionType,
  ActionCenterItem,
  ActionCenterSnapshot,
  CodexHandoff,
} from '@shared/contracts';
import type { DesktopApi } from '@shared/desktop-api';

export type ActionCenterViewScope = 'all' | 'project';

export interface ActionCenterViewProps {
  snapshot: ActionCenterSnapshot | undefined;
  loading: boolean;
  fetching: boolean;
  error: unknown;
  scope: ActionCenterViewScope;
  currentProjectName: string | undefined;
  selectedActionKey: string | null;
  desktop: DesktopApi | undefined;
  onScopeChange: (scope: ActionCenterViewScope) => void;
  onSelectAction: (actionKey: string) => void;
  onRefresh: () => void;
  onOpenAction: (projectId: string, changeId?: string, archived?: boolean) => void;
}

const actionIcons: Record<ActionCenterActionType, typeof Wrench> = {
  'project-health': Wrench,
  'complete-artifact': FileWarning,
  'continue-implementation': ListTodo,
  'run-validation': ShieldCheck,
  'fix-validation': ShieldAlert,
  archive: Archive,
  'archive-integrity': CircleAlert,
};

const actionTypeLabels: Record<ActionCenterActionType, string> = {
  'project-health': '项目健康',
  'complete-artifact': '规划工件',
  'continue-implementation': '继续实施',
  'run-validation': '严格验证',
  'fix-validation': '修复验证',
  archive: '归档确认',
  'archive-integrity': '归档异常',
};

const evidenceSourceLabels: Record<ActionCenterItem['evidence'][number]['source'], string> = {
  'openspec-cli': 'OpenSpec CLI',
  structural: '本地结构',
  'local-work-state': '本地轮次',
  'local-comparison': '本地比较',
  'validation-cache': '验证记录',
  directory: '目录状态',
};

const reopenedReasonLabels = {
  'tasks-added': '新增任务',
  'tasks-unchecked': '任务取消勾选',
  'task-set-changed': '任务集合变化',
} as const;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : '行动证据暂时不可用';
}

function actionTone(action: ActionCenterItem): string {
  if (action.actionType === 'project-health' || action.actionType === 'archive-integrity') {
    return 'danger';
  }
  if (action.actionType === 'complete-artifact' || action.actionType === 'fix-validation') {
    return 'warning';
  }
  if (action.actionType === 'archive' || action.actionType === 'run-validation') return 'info';
  return 'neutral';
}

function ActionBadges({ action }: { action: ActionCenterItem }): React.JSX.Element {
  return (
    <span className="action-badges">
      {action.workState?.phase === 'reopened' && (
        <span className="action-tag action-tag-reopened">
          <RotateCcw size={11} aria-hidden="true" />
          再次实施 · 第 {action.workState.iteration} 轮
        </span>
      )}
      {(action.evolution?.status === 'iteration' || action.evolution?.status === 'mixed') && (
        <span className="action-tag action-tag-evolution">能力迭代</span>
      )}
      {action.workState?.archiveIntegrity?.status === 'changed' && (
        <span className="action-tag action-tag-danger">归档内容异常</span>
      )}
    </span>
  );
}

function ActionQueue({
  items,
  selectedActionKey,
  onSelect,
}: {
  items: ActionCenterItem[];
  selectedActionKey: string | null;
  onSelect: (actionKey: string) => void;
}): React.JSX.Element {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.actionKey === selectedActionKey),
  );
  const moveSelection = (index: number): void => {
    const target = items[index];
    if (!target) return;
    onSelect(target.actionKey);
    rowRefs.current[index]?.focus();
  };

  if (items.length === 0) {
    return (
      <div className="action-empty">
        <CheckCircle2 size={22} aria-hidden="true" />
        <strong>当前范围没有待处理行动</strong>
      </div>
    );
  }

  return (
    <div className="action-queue" role="listbox" aria-label="行动队列">
      {items.map((item, index) => {
        const Icon = actionIcons[item.actionType];
        const selected = index === selectedIndex;
        return (
          <button
            key={item.actionKey}
            ref={(element) => {
              rowRefs.current[index] = element;
            }}
            type="button"
            role="option"
            aria-selected={selected}
            aria-label={`${item.projectName}，${item.title}，${item.changeId ?? '项目级行动'}`}
            tabIndex={selected ? 0 : -1}
            className={`action-row ${selected ? 'is-selected' : ''}`}
            data-tone={actionTone(item)}
            onClick={() => onSelect(item.actionKey)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === 'ArrowDown') next = Math.min(items.length - 1, index + 1);
              else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = items.length - 1;
              else return;
              event.preventDefault();
              moveSelection(next);
            }}
          >
            <span className="action-row-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span className="action-row-copy">
              <span className="action-row-context">
                <strong title={item.projectName}>{item.projectName}</strong>
                <span>{item.changeId ?? '项目'}</span>
              </span>
              <span className="action-row-title">{item.title}</span>
              <span className="action-row-meta">
                <span>{actionTypeLabels[item.actionType]}</span>
                {item.taskGate && (
                  <span>
                    {item.taskGate.completed}/{item.taskGate.total} · 剩余 {item.taskGate.remaining}
                  </span>
                )}
              </span>
              <ActionBadges action={item} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ActionEvidence({
  action,
  snapshot,
}: {
  action: ActionCenterItem;
  snapshot: ActionCenterSnapshot;
}): React.JSX.Element {
  const health = snapshot.projects.find((entry) => entry.projectId === action.projectId);
  const reopened = action.workState?.reopenedEvents.at(-1);
  return (
    <div className="action-detail-scroll">
      {action.workState?.archiveIntegrity?.status === 'changed' && (
        <div className="action-alert action-alert-danger" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <span>归档内容在本地基线建立后发生变化。后续工作应创建新的 Change。</span>
        </div>
      )}

      <section className="action-evidence-section" aria-labelledby="action-root-heading">
        <header>
          <span className="eyebrow">项目根</span>
          <span className={`root-health root-health-${health?.status ?? 'unavailable'}`}>
            {health?.status === 'healthy'
              ? '健康'
              : health?.status === 'degraded'
                ? '证据降级'
                : '不可用'}
          </span>
        </header>
        <h2 id="action-root-heading">{action.projectName}</h2>
        <code title={action.projectRoot}>{action.projectRoot}</code>
        {health?.rootRole && <p>OpenSpec root：{health.rootRole}</p>}
        {health?.diagnostics.length ? (
          <ul className="action-diagnostic-list">
            {health.diagnostics.map((diagnostic) => (
              <li key={diagnostic}>
                <CircleAlert size={13} aria-hidden="true" />
                <span>{diagnostic}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {(action.taskGate || action.workState || action.evolution) && (
        <section className="action-evidence-section" aria-labelledby="action-progress-heading">
          <span className="eyebrow">实施状态</span>
          <h2 id="action-progress-heading">任务与轮次</h2>
          <ActionBadges action={action} />
          {action.taskGate && (
            <div className="action-task-counts" aria-label="任务计数">
              <strong>
                {action.taskGate.completed} / {action.taskGate.total}
              </strong>
              <span>剩余 {action.taskGate.remaining} 项</span>
            </div>
          )}
          {reopened && (
            <dl className="action-facts">
              <div>
                <dt>再次打开</dt>
                <dd>{formatDate(reopened.reopenedAt)}</dd>
              </div>
              <div>
                <dt>原因</dt>
                <dd>{reopenedReasonLabels[reopened.reason]}</dd>
              </div>
              <div>
                <dt>计数变化</dt>
                <dd>
                  {reopened.before.completed}/{reopened.before.total} → {reopened.after.completed}/
                  {reopened.after.total}
                </dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd>{reopened.projectVersion.label || '当前工作区'}</dd>
              </div>
            </dl>
          )}
        </section>
      )}

      <section className="action-evidence-section" aria-labelledby="action-evidence-heading">
        <span className="eyebrow">当前证据</span>
        <h2 id="action-evidence-heading">{action.title}</h2>
        <p>{action.description}</p>
        <ul className="action-evidence-list">
          {action.evidence.map((evidence, index) => (
            <li key={`${evidence.source}-${evidence.relativePath ?? index}`}>
              <span className="evidence-source-label">{evidenceSourceLabels[evidence.source]}</span>
              <strong>{evidence.summary}</strong>
              <small>
                {formatDate(evidence.checkedAt)}
                {evidence.relativePath ? ` · ${evidence.relativePath}` : ''}
              </small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function HandoffPane({
  action,
  desktop,
}: {
  action: ActionCenterItem;
  desktop: DesktopApi | undefined;
}): React.JSX.Element {
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copiedHandoff, setCopiedHandoff] = useState<CodexHandoff | undefined>();
  const mutation = useMutation({
    mutationFn: () =>
      desktop!.buildCodexHandoff({
        actionKey: action.actionKey,
        evidenceFingerprint: action.evidenceFingerprint,
      }),
  });
  const handoff: CodexHandoff | undefined =
    copiedHandoff?.actionKey === action.actionKey
      ? copiedHandoff
      : mutation.data?.actionKey === action.actionKey
        ? mutation.data
        : undefined;
  const build = (): void => {
    setCopyError(null);
    setCopied(false);
    setCopiedHandoff(undefined);
    mutation.mutate();
  };
  const copy = async (): Promise<void> => {
    setCopyError(null);
    setCopied(false);
    setCopying(true);
    try {
      const current = await desktop!.copyCodexHandoff({
        actionKey: action.actionKey,
        evidenceFingerprint: action.evidenceFingerprint,
      });
      setCopiedHandoff(current);
      if (current.stale) throw new Error('行动证据已更新，请重新审阅后生成交接');
      setCopied(true);
    } catch (error) {
      setCopyError(readableError(error));
    } finally {
      setCopying(false);
    }
  };

  return (
    <section className="handoff-pane" aria-labelledby="handoff-heading">
      <header>
        <div>
          <span className="eyebrow">Codex</span>
          <h2 id="handoff-heading">交接内容</h2>
        </div>
        <div className="handoff-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="生成 Codex 交接"
            title="生成 Codex 交接"
            disabled={!desktop || mutation.isPending}
            onClick={build}
          >
            {mutation.isPending ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : (
              <RefreshCw size={16} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="command-button"
            disabled={!desktop || mutation.isPending || copying}
            onClick={() => void copy()}
          >
            {copying ? (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            ) : (
              <Clipboard size={15} aria-hidden="true" />
            )}
            复制 Codex 交接
          </button>
        </div>
      </header>
      {handoff && (
        <textarea
          className="handoff-preview"
          aria-label="Codex 交接内容"
          readOnly
          value={handoff.markdown}
        />
      )}
      {handoff?.stale && (
        <div className="action-alert action-alert-warning" role="status">
          <CircleAlert size={15} aria-hidden="true" />
          <span>行动证据已更新，请审阅当前行动。</span>
        </div>
      )}
      {mutation.isError && (
        <div className="action-alert action-alert-danger" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{readableError(mutation.error)}</span>
        </div>
      )}
      {copyError && (
        <div className="action-alert action-alert-warning" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{copyError}，可在上方文本区域手动选择。</span>
        </div>
      )}
      <span className="handoff-live" role="status" aria-live="polite">
        {copied ? 'Codex 交接已复制' : ''}
      </span>
    </section>
  );
}

export function ActionCenterView({
  snapshot,
  loading,
  fetching,
  error,
  scope,
  currentProjectName,
  selectedActionKey,
  desktop,
  onScopeChange,
  onSelectAction,
  onRefresh,
  onOpenAction,
}: ActionCenterViewProps): React.JSX.Element {
  const items = snapshot?.items ?? [];
  const selected = items.find((item) => item.actionKey === selectedActionKey) ?? items[0] ?? null;

  return (
    <>
      <section className="change-list-pane action-list-pane" aria-label="行动中心队列">
        <div className="pane-heading action-pane-heading">
          <div>
            <span className="eyebrow">跨项目</span>
            <h2>行动中心</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="刷新行动中心"
            title="刷新行动中心"
            disabled={fetching}
            onClick={onRefresh}
          >
            <RefreshCw className={fetching ? 'spin' : ''} size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="segmented-control" role="group" aria-label="行动中心范围">
          <button
            type="button"
            className={scope === 'all' ? 'is-active' : ''}
            aria-pressed={scope === 'all'}
            onClick={() => onScopeChange('all')}
          >
            全部项目
          </button>
          <button
            type="button"
            className={scope === 'project' ? 'is-active' : ''}
            aria-pressed={scope === 'project'}
            disabled={!currentProjectName}
            onClick={() => onScopeChange('project')}
          >
            当前项目
          </button>
        </div>
        {snapshot?.status === 'partial' && (
          <div className="action-partial" role="status">
            <CircleAlert size={14} aria-hidden="true" />
            <span>部分项目证据已降级</span>
          </div>
        )}
        {loading && !snapshot ? (
          <div className="action-loading" role="status">
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
            正在汇总行动
          </div>
        ) : error && !snapshot ? (
          <div className="action-error" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{readableError(error)}</span>
          </div>
        ) : (
          <ActionQueue
            items={items}
            selectedActionKey={selected?.actionKey ?? null}
            onSelect={onSelectAction}
          />
        )}
      </section>

      <main className="detail-pane action-detail-pane" aria-label="行动证据">
        {!selected || !snapshot ? (
          <div className="action-detail-empty">
            <CheckCircle2 size={24} aria-hidden="true" />
            <strong>当前范围没有待处理行动</strong>
          </div>
        ) : (
          <>
            <div className="detail-heading action-detail-heading">
              <div className="detail-heading-copy">
                <span className="eyebrow">{actionTypeLabels[selected.actionType]}</span>
                <h1>{selected.title}</h1>
                <div className="action-detail-context">
                  <span>{selected.projectName}</span>
                  {selected.changeId && <code>{selected.changeId}</code>}
                </div>
              </div>
              <button
                type="button"
                className="command-button command-primary"
                onClick={() =>
                  onOpenAction(selected.projectId, selected.changeId, selected.archived)
                }
              >
                <ArrowUpRight size={15} aria-hidden="true" />
                {selected.changeId ? '打开 Change' : '打开项目'}
              </button>
            </div>
            <ActionEvidence action={selected} snapshot={snapshot} />
            <HandoffPane key={selected.actionKey} action={selected} desktop={desktop} />
          </>
        )}
      </main>
    </>
  );
}
