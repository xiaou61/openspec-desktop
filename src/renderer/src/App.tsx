import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tabs from '@radix-ui/react-tabs';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  FileCode2,
  FileText,
  Folder,
  FolderCog,
  FolderOpen,
  FolderPlus,
  GitCompareArrows,
  History,
  Laptop,
  ListTodo,
  LoaderCircle,
  Menu,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  SlidersHorizontal,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  ActivityEntry,
  ActivityPage,
  AppSnapshot,
  ArtifactProjection,
  ChangeProjection,
  CodexDirectProject,
  CodexImportResult,
  CodexProjectList,
  CodexWorkspaceMember,
  CodexWorkspaceReference,
  LifecycleNodeId,
  ProjectSnapshot,
  RevisionComparison,
  RevisionPage,
  ValidationStatus,
  VersionSummary,
  VersionSummaryList,
} from '@shared/contracts';
import type { DesktopApi } from '@shared/desktop-api';
import { CHANGE_PAGE_SIZE, sortChangesByRecentActivity } from './change-order';
import {
  LifecycleTrack,
  ReadinessPane,
  ValidationActionButton,
  type ReadinessSection,
} from './lifecycle-view';
import {
  lifecycleStagePresentation,
  useChangeLifecycle,
  useChangeValidation,
  validationActionPresentation,
} from './lifecycle-model';
import { ActionCenterView, type ActionCenterViewScope } from './action-center-view';
import { actionCenterQueryKey, useActionCenter } from './action-center-model';
import {
  codexRootKey,
  collectAvailableCodexLeaves,
  reconcileCodexSelection,
  toggleWorkspaceSelection,
  workspaceSelectionState,
  type WorkspaceSelectionState,
} from './codex-import-model';

type ChangeView = 'active' | 'archive';
type WorkspaceMode = 'changes' | 'actions';
type DetailTab = 'artifacts' | 'tasks' | 'readiness' | 'activity' | 'revisions';
type NoticeTone = 'success' | 'error';
type NoticePhase = 'entering' | 'open' | 'closing';

interface NoticeState {
  tone: NoticeTone;
  text: string;
  phase: NoticePhase;
}

const queryKey = ['app-snapshot'];
const codexQueryKey = ['codex-projects'];

function useTransientNotice(): {
  notice: NoticeState | null;
  showNotice: (notice: Omit<NoticeState, 'phase'>, duration?: number) => void;
  dismissNotice: () => void;
} {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const phaseTimer = useRef<number | null>(null);
  const dismissTimer = useRef<number | null>(null);
  const exitTimer = useRef<number | null>(null);

  const clearTimer = useCallback((timer: React.MutableRefObject<number | null>) => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const dismissNotice = useCallback(() => {
    clearTimer(phaseTimer);
    clearTimer(dismissTimer);
    clearTimer(exitTimer);
    setNotice((current) => (current ? { ...current, phase: 'closing' } : null));
    exitTimer.current = window.setTimeout(() => {
      setNotice(null);
      exitTimer.current = null;
    }, 160);
  }, [clearTimer]);

  const showNotice = useCallback(
    (next: Omit<NoticeState, 'phase'>, duration = 2600) => {
      clearTimer(phaseTimer);
      clearTimer(dismissTimer);
      clearTimer(exitTimer);
      setNotice({ ...next, phase: 'entering' });
      phaseTimer.current = window.setTimeout(() => {
        setNotice((current) => (current ? { ...current, phase: 'open' } : null));
        phaseTimer.current = null;
      }, 16);
      dismissTimer.current = window.setTimeout(() => {
        setNotice((current) => (current ? { ...current, phase: 'closing' } : null));
        exitTimer.current = window.setTimeout(() => {
          setNotice(null);
          exitTimer.current = null;
        }, 160);
        dismissTimer.current = null;
      }, duration);
    },
    [clearTimer],
  );

  useEffect(
    () => () => {
      clearTimer(phaseTimer);
      clearTimer(dismissTimer);
      clearTimer(exitTimer);
    },
    [clearTimer],
  );

  return { notice, showNotice, dismissNotice };
}

function displayVersion(versionLabel: string): string {
  return versionLabel.trim() || '当前工作区';
}

function versionSourceLabel(
  source: AppSnapshot['catalog']['projects'][number]['versionSource'],
): string {
  return {
    'git-tag': 'Git 标签',
    'package-json': 'package.json',
    manual: '手动设置',
    workspace: '当前工作区',
  }[source];
}

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function emptySnapshot(): AppSnapshot {
  return {
    catalog: {
      schemaVersion: 3,
      groups: [],
      projects: [],
      preferences: {
        selectedProjectId: null,
        selectedChangeId: null,
        showArchived: false,
        windowBounds: { width: 1440, height: 900 },
      },
    },
    projects: [],
  };
}

function formatDate(value: string | undefined): string {
  if (!value) return '尚无记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function watcherLabel(state: ProjectSnapshot['project']['watcherState']): string {
  return {
    scanning: '扫描中',
    watching: '实时监控',
    paused: '已暂停',
    unavailable: '路径不可用',
    error: '监听异常',
  }[state];
}

function readinessLabel(readiness: ChangeProjection['readiness']): string {
  return {
    ready: '结构完整',
    incomplete: '缺少文档',
    'parse-error': '解析异常',
    unavailable: '暂不可用',
  }[readiness];
}

const reopenedReasonLabels = {
  'tasks-added': '新增任务',
  'tasks-unchecked': '任务取消勾选',
  'task-set-changed': '任务集合变化',
} as const;

function isCapabilityIteration(change: ChangeProjection): boolean {
  return change.evolution?.status === 'iteration' || change.evolution?.status === 'mixed';
}

function ChangeAwarenessBadges({ change }: { change: ChangeProjection }): React.JSX.Element {
  return (
    <span className="change-awareness-badges">
      {change.workState?.phase === 'reopened' && (
        <span className="awareness-badge awareness-reopened">
          <RotateCcw size={11} aria-hidden="true" />
          再次实施 · 第 {change.workState.iteration} 轮
        </span>
      )}
      {isCapabilityIteration(change) && (
        <span className="awareness-badge awareness-evolution">
          <Sparkles size={11} aria-hidden="true" />
          能力迭代
        </span>
      )}
      {change.workState?.archiveIntegrity?.status === 'changed' && (
        <span className="awareness-badge awareness-archive-alert">
          <ShieldAlert size={11} aria-hidden="true" />
          归档内容异常
        </span>
      )}
    </span>
  );
}

function ChangeAwareness({ change }: { change: ChangeProjection }): React.JSX.Element | null {
  const reopened =
    change.workState?.phase === 'reopened' ? change.workState.reopenedEvents.at(-1) : undefined;
  const archiveChanged = change.workState?.archiveIntegrity?.status === 'changed';
  if (!reopened && !isCapabilityIteration(change) && !archiveChanged) return null;
  return (
    <section className="change-awareness" aria-label="Change 演进证据">
      {reopened && (
        <div className="change-awareness-entry awareness-reopened-detail">
          <RotateCcw size={16} aria-hidden="true" />
          <span>
            <strong>再次实施 · 第 {change.workState!.iteration} 轮</strong>
            <small>
              {formatDate(reopened.reopenedAt)} · {reopenedReasonLabels[reopened.reason]} ·{' '}
              {reopened.before.completed}/{reopened.before.total} → {reopened.after.completed}/
              {reopened.after.total} · {reopened.projectVersion.label || '当前工作区'}
            </small>
          </span>
        </div>
      )}
      {isCapabilityIteration(change) && (
        <div className="change-awareness-entry awareness-evolution-detail">
          <Sparkles size={16} aria-hidden="true" />
          <span>
            <strong>能力迭代</strong>
            <small>当前 delta 涉及既有主规格能力。</small>
          </span>
        </div>
      )}
      {archiveChanged && (
        <div className="change-awareness-entry awareness-archive-detail" role="alert">
          <ShieldAlert size={16} aria-hidden="true" />
          <span>
            <strong>归档内容异常</strong>
            <small>归档内容在本地基线后发生变化；后续工作应创建新的 Change。</small>
          </span>
        </div>
      )}
    </section>
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled = false,
  className = '',
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`icon-button ${className}`}
    >
      {children}
    </button>
  );
}

function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue';
}): React.JSX.Element {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

function ProgressBar({
  completed,
  total,
}: {
  completed: number;
  total: number;
}): React.JSX.Element {
  const ratio = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label="任务完成度"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(completed, total)}
      aria-valuetext={`${completed} / ${total} 项任务`}
    >
      <span className="progress-fill" style={{ transform: `scaleX(${ratio / 100})` }} />
    </div>
  );
}

function ProjectSidebar({
  snapshot,
  selectedProjectId,
  actionCount,
  actionSelected,
  onSelect,
  onSelectActions,
  onBrowse,
  onImportCodex,
  onCreateGroup,
  onRemoveGroup,
  onManage,
}: {
  snapshot: AppSnapshot;
  selectedProjectId: string | null;
  actionCount: number;
  actionSelected: boolean;
  onSelect: (projectId: string) => void;
  onSelectActions: () => void;
  onBrowse: () => void;
  onImportCodex: () => void;
  onCreateGroup: () => void;
  onRemoveGroup: (groupId: string) => void;
  onManage: () => void;
}): React.JSX.Element {
  const grouped = snapshot.catalog.groups
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((group) => ({
      group,
      projects: snapshot.catalog.projects
        .filter((project) => project.groupId === group.id)
        .sort((left, right) => left.order - right.order),
    }));
  const ungrouped = snapshot.catalog.projects
    .filter((project) => project.groupId === null)
    .sort((left, right) => left.order - right.order);

  return (
    <aside className="sidebar" aria-label="项目目录">
      <div className="sidebar-heading">
        <div className="brand-lockup">
          <span className="brand-mark">
            <PanelsTopLeft size={17} aria-hidden="true" />
          </span>
          <h1 className="brand-title">OpenSpec Desktop</h1>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="icon-button" aria-label="添加项目" title="添加项目">
              <Plus size={18} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="add-project-menu"
              side="bottom"
              align="end"
              sideOffset={6}
            >
              <DropdownMenu.Item className="menu-item" onSelect={() => onBrowse()}>
                <FolderPlus size={15} aria-hidden="true" />
                <span>选择文件夹</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => onImportCodex()}>
                <Laptop size={15} aria-hidden="true" />
                <span>从 Codex 导入</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div className="sidebar-toolbar">
        <span className="eyebrow">项目</span>
        <span className="count-label">{snapshot.catalog.projects.length}</span>
      </div>
      <button
        type="button"
        className={`action-center-entry ${actionSelected ? 'is-selected' : ''}`}
        aria-current={actionSelected ? 'page' : undefined}
        onClick={onSelectActions}
      >
        <ListTodo size={16} aria-hidden="true" />
        <span>行动中心</span>
        <span className="action-center-count" aria-label={`${actionCount} 个待处理行动`}>
          {actionCount}
        </span>
      </button>
      <div className="project-tree">
        {grouped.map(({ group, projects }) => (
          <section key={group.id} className="tree-group" aria-labelledby={`group-${group.id}`}>
            <div className="tree-group-heading">
              <span
                id={`group-${group.id}`}
                title={group.kind === 'codex-workspace' ? group.sourceRootPath : undefined}
              >
                {group.kind === 'codex-workspace' ? (
                  <FolderCog size={14} aria-hidden="true" />
                ) : (
                  <Folder size={14} aria-hidden="true" />
                )}
                <span className="tree-group-name">{group.name}</span>
                {group.kind === 'codex-workspace' && (
                  <span className="workspace-group-label">工作区</span>
                )}
              </span>
              <span className="tree-group-actions">
                <span className="count-label">{projects.length}</span>
                <IconButton
                  label={`移除分组 ${group.name}`}
                  onClick={() => onRemoveGroup(group.id)}
                  className="subtle-icon"
                >
                  <Trash2 size={13} />
                </IconButton>
              </span>
            </div>
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                selected={selectedProjectId === project.id}
                onClick={() => onSelect(project.id)}
              />
            ))}
          </section>
        ))}
        <section className="tree-group" aria-labelledby="ungrouped-heading">
          <div className="tree-group-heading">
            <span id="ungrouped-heading">
              <FolderOpen size={14} aria-hidden="true" />
              未分组
            </span>
            <span className="count-label">{ungrouped.length}</span>
          </div>
          {ungrouped.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              selected={selectedProjectId === project.id}
              onClick={() => onSelect(project.id)}
            />
          ))}
        </section>
        {snapshot.catalog.projects.length === 0 && (
          <button type="button" className="sidebar-empty" onClick={onBrowse}>
            <FolderPlus size={17} aria-hidden="true" />
            <span>添加本地项目</span>
          </button>
        )}
      </div>
      <div className="sidebar-footer">
        <button type="button" className="text-button" onClick={onCreateGroup}>
          <Plus size={15} aria-hidden="true" />
          新建分组
        </button>
        <IconButton label="项目设置" onClick={onManage}>
          <Settings2 size={17} />
        </IconButton>
      </div>
    </aside>
  );
}

function ProjectRow({
  project,
  selected,
  onClick,
}: {
  project: AppSnapshot['catalog']['projects'][number];
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`project-row ${selected ? 'is-selected' : ''}`}
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
    >
      <span className={`project-dot dot-${project.watcherState}`} aria-hidden="true" />
      <span className="project-row-content">
        <strong>{project.displayName}</strong>
        <small title={displayVersion(project.versionLabel)}>
          {displayVersion(project.versionLabel)}
        </small>
      </span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  );
}

function ChangeList({
  project,
  desktop,
  mode,
  onModeChange,
  selectedChangeId,
  onSelect,
  versionSummaries,
}: {
  project: ProjectSnapshot | null;
  desktop: DesktopApi | undefined;
  mode: ChangeView;
  onModeChange: (mode: ChangeView) => void;
  selectedChangeId: string | null;
  onSelect: (changeId: string) => void;
  versionSummaries: VersionSummary[];
}): React.JSX.Element {
  const [page, setPage] = useState(1);
  const changes = sortChangesByRecentActivity(
    project?.changes.filter((change) =>
      mode === 'archive' ? change.archived : !change.archived,
    ) ?? [],
  );
  const pageCount = Math.max(1, Math.ceil(changes.length / CHANGE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageChanges = changes.slice(
    (currentPage - 1) * CHANGE_PAGE_SIZE,
    currentPage * CHANGE_PAGE_SIZE,
  );
  return (
    <section className="change-list-pane" aria-label="Change 列表">
      <div className="pane-heading">
        <div>
          <span className="eyebrow">{project?.project.displayName ?? '工作区'}</span>
          <h2>变更</h2>
        </div>
        <StatusBadge tone={project?.project.watcherState === 'watching' ? 'green' : 'amber'}>
          {project ? watcherLabel(project.project.watcherState) : '未选择'}
        </StatusBadge>
      </div>
      <div className="segmented-control" role="group" aria-label="Change 范围">
        <button
          type="button"
          aria-pressed={mode === 'active'}
          className={mode === 'active' ? 'is-active' : ''}
          onClick={() => onModeChange('active')}
        >
          当前变更
        </button>
        <button
          type="button"
          aria-pressed={mode === 'archive'}
          className={mode === 'archive' ? 'is-active' : ''}
          onClick={() => onModeChange('archive')}
        >
          <Archive size={14} aria-hidden="true" />
          已归档
        </button>
      </div>
      <div className="change-list" role="list">
        {pageChanges.map((change) => (
          <ChangeRow
            key={`${change.archived ? 'archive-' : ''}${change.id}`}
            change={change}
            projectId={project!.project.id}
            desktop={desktop}
            selected={selectedChangeId === change.id}
            onClick={() => onSelect(change.id)}
            versions={versionSummaries.filter((summary) => summary.changeIds.includes(change.id))}
          />
        ))}
        {changes.length === 0 && (
          <EmptyState
            icon={mode === 'archive' ? <Archive size={20} /> : <FileCode2 size={20} />}
            title={mode === 'archive' ? '暂无已归档 Change' : '暂无当前变更'}
          />
        )}
      </div>
      {pageCount > 1 && (
        <nav className="change-pagination" aria-label="Change 分页">
          <IconButton
            label="上一页"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
            className="pagination-button"
          >
            <ChevronLeft size={15} />
          </IconButton>
          <span className="change-page-label" aria-live="polite">
            第 {currentPage} / {pageCount} 页
          </span>
          <IconButton
            label="下一页"
            disabled={currentPage === pageCount}
            onClick={() => setPage(currentPage + 1)}
            className="pagination-button"
          >
            <ChevronRight size={15} />
          </IconButton>
        </nav>
      )}
    </section>
  );
}

function ChangeRow({
  change,
  projectId,
  desktop,
  selected,
  onClick,
  versions,
}: {
  change: ChangeProjection;
  projectId: string;
  desktop: DesktopApi | undefined;
  selected: boolean;
  onClick: () => void;
  versions: VersionSummary[];
}): React.JSX.Element {
  const lifecycleQuery = useChangeLifecycle(projectId, change, desktop);
  const stage = lifecycleStagePresentation(lifecycleQuery.data, change);
  const associatedVersions = versions
    .slice()
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  const versionContext = associatedVersions[0]
    ? associatedVersions.length > 1
      ? `${associatedVersions[0].label} · 跨 ${associatedVersions.length} 个版本`
      : associatedVersions[0].label
    : '尚无版本活动';
  return (
    <button
      type="button"
      role="listitem"
      className={`change-row ${selected ? 'is-selected' : ''}`}
      aria-current={selected ? 'page' : undefined}
      title={change.name}
      onClick={onClick}
    >
      <span className="change-row-top">
        <strong>{change.name}</strong>
        <ChevronRight size={15} aria-hidden="true" />
      </span>
      <span className="change-row-meta">
        <StatusBadge tone={stage.tone}>{stage.label}</StatusBadge>
        <span className="change-task-count">
          {change.taskTotals.completed}/{change.taskTotals.total} 任务
        </span>
        <span className="change-version" title={versionContext}>
          <Tag size={11} aria-hidden="true" />
          <span>{versionContext}</span>
        </span>
      </span>
      <ChangeAwarenessBadges change={change} />
      <ProgressBar completed={change.taskTotals.completed} total={change.taskTotals.total} />
      <span className="change-row-foot">
        <span>{stage.detail}</span>
        <span>{formatDate(change.lastActivityAt)}</span>
      </span>
    </button>
  );
}

function EmptyState({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <strong>{title}</strong>
      {action}
    </div>
  );
}

function MarkdownPane({
  projectId,
  artifact,
  desktop,
}: {
  projectId: string;
  artifact: ArtifactProjection;
  desktop: DesktopApi | undefined;
}): React.JSX.Element {
  const [mode, setMode] = useState<'rendered' | 'raw'>('rendered');
  const [linkError, setLinkError] = useState<string | null>(null);
  return (
    <div className="artifact-pane">
      <div className="artifact-toolbar">
        <div className="artifact-name">
          <FileText size={16} aria-hidden="true" />
          <span>{artifact.relativePath}</span>
        </div>
        <div className="toolbar-actions">
          <div className="mini-segment" role="group" aria-label="Markdown 查看方式">
            <button
              type="button"
              aria-pressed={mode === 'rendered'}
              className={mode === 'rendered' ? 'is-active' : ''}
              onClick={() => setMode('rendered')}
            >
              渲染
            </button>
            <button
              type="button"
              aria-pressed={mode === 'raw'}
              className={mode === 'raw' ? 'is-active' : ''}
              onClick={() => setMode('raw')}
            >
              原文
            </button>
          </div>
          <IconButton
            label="在文件夹中显示"
            onClick={() => {
              if (desktop)
                void desktop
                  .revealArtifact({ projectId, sourcePath: artifact.sourcePath })
                  .catch((error: unknown) =>
                    setLinkError(error instanceof Error ? error.message : '无法打开文件'),
                  );
            }}
          >
            <FolderOpen size={16} />
          </IconButton>
        </div>
      </div>
      {artifact.parseHealth !== 'ok' && (
        <div className="inline-alert alert-warning">
          <CircleAlert size={16} aria-hidden="true" />
          <span>{artifact.error ?? '该文件暂时无法解析，仍保留原文。'}</span>
        </div>
      )}
      {linkError && (
        <div className="inline-alert alert-error">
          <CircleAlert size={16} aria-hidden="true" />
          <span>{linkError}</span>
        </div>
      )}
      {mode === 'raw' || artifact.parseHealth !== 'ok' ? (
        <pre className="raw-markdown">{artifact.rawContent ?? '无法读取文件内容。'}</pre>
      ) : (
        <article className="markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!href || !desktop) return;
                    void desktop
                      .openExternal(href)
                      .catch((error: unknown) =>
                        setLinkError(error instanceof Error ? error.message : '链接未打开'),
                      );
                  }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {artifact.rawContent ?? ''}
          </ReactMarkdown>
        </article>
      )}
    </div>
  );
}

function TasksPane({ change }: { change: ChangeProjection }): React.JSX.Element {
  const taskArtifacts = change.artifacts.filter(
    (artifact) => artifact.type === 'tasks' || artifact.tasks.length > 0,
  );
  const tasks = taskArtifacts.flatMap((artifact) =>
    artifact.tasks.map((task) => ({ ...task, path: artifact.relativePath })),
  );
  return (
    <div className="tasks-pane">
      <div className="tasks-summary">
        <div>
          <span className="eyebrow">任务进度</span>
          <strong>
            {change.taskTotals.completed} / {change.taskTotals.total}
          </strong>
        </div>
        <ProgressBar completed={change.taskTotals.completed} total={change.taskTotals.total} />
      </div>
      {tasks.length === 0 ? (
        <EmptyState icon={<Check size={20} />} title="没有可识别的任务" />
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={`${task.path}-${task.id}`}>
              <span className={`task-check ${task.checked ? 'is-checked' : ''}`}>
                {task.checked && <Check size={13} aria-hidden="true" />}
              </span>
              <span>{task.text}</span>
              <small>{task.path}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VersionFilter({
  summaries,
  value,
  onChange,
}: {
  summaries: VersionSummary[];
  value: string | null;
  onChange: (value: string | null) => void;
}): React.JSX.Element {
  return (
    <label className="version-filter">
      <span className="sr-only">筛选历史版本</span>
      <Tag size={14} aria-hidden="true" />
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">全部版本</option>
        {summaries.map((summary) => (
          <option key={summary.key} value={summary.key}>
            {summary.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActivityPane({
  projectId,
  changeId,
  desktop,
  versionSummaries,
  versionKey,
  onVersionChange,
}: {
  projectId: string;
  changeId: string;
  desktop: DesktopApi | undefined;
  versionSummaries: VersionSummary[];
  versionKey: string | null;
  onVersionChange: (value: string | null) => void;
}): React.JSX.Element {
  const query = useQuery({
    queryKey: ['activity', projectId, changeId, versionKey],
    queryFn: () =>
      desktop!.listActivity({
        projectId,
        changeId,
        limit: 50,
        ...(versionKey ? { versionKey } : {}),
      }),
    enabled: Boolean(desktop),
  });
  const page = query.data as ActivityPage | undefined;
  const groups = (page?.items ?? []).reduce<
    Array<{ key: string; label: string; items: ActivityEntry[] }>
  >((result, entry) => {
    const key = entry.projectVersion.trim() || 'workspace';
    const current = result.at(-1);
    if (current?.key === key) current.items.push(entry);
    else result.push({ key, label: displayVersion(entry.projectVersion), items: [entry] });
    return result;
  }, []);
  return (
    <div className="activity-pane">
      <div className="history-toolbar">
        <span>按记录创建时的版本分组</span>
        <VersionFilter summaries={versionSummaries} value={versionKey} onChange={onVersionChange} />
      </div>
      {query.isLoading ? (
        <LoadingState />
      ) : groups.length ? (
        <div className="activity-groups">
          {groups.map((group) => (
            <section key={`${group.key}-${group.items[0]?.id}`} className="activity-group">
              <header>
                <Tag size={13} aria-hidden="true" />
                <strong>{group.label}</strong>
                <span>{group.items.length} 条</span>
              </header>
              <ol className="activity-list">
                {group.items.map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Clock3 size={20} />}
          title={versionKey ? '当前版本筛选下暂无活动记录' : '暂无活动记录'}
          action={
            versionKey ? (
              <button
                type="button"
                className="command-button"
                onClick={() => onVersionChange(null)}
              >
                查看全部版本
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }): React.JSX.Element {
  const kindLabel = {
    'artifact-change': '工件变化',
    'task-progress': '任务进度',
    'archive-integrity': '归档异常',
    'watcher-state': '监听状态',
    recovery: '恢复',
    'project-registration': '项目登记',
    'project-settings': '项目设置',
  }[entry.kind];
  return (
    <li className={`activity-kind-${entry.kind}`}>
      <span className="activity-marker" aria-hidden="true" />
      <div>
        <span className="activity-kind-label">{kindLabel}</span>
        <strong>{entry.summary}</strong>
        <p className="activity-meta">
          <span>{formatDate(entry.createdAt)}</span>
          {entry.relativePath && <span title={entry.relativePath}>{entry.relativePath}</span>}
          {entry.taskDelta && (
            <span>
              任务变化：完成 {formatDelta(entry.taskDelta.completed)}，总数{' '}
              {formatDelta(entry.taskDelta.total)}
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

function RevisionsPane({
  projectId,
  artifact,
  desktop,
  versionSummaries,
  versionKey,
  onVersionChange,
}: {
  projectId: string;
  artifact: ArtifactProjection | undefined;
  desktop: DesktopApi | undefined;
  versionSummaries: VersionSummary[];
  versionKey: string | null;
  onVersionChange: (value: string | null) => void;
}): React.JSX.Element {
  const [leftId, setLeftId] = useState<string>('');
  const [rightId, setRightId] = useState<string>('');
  const [comparison, setComparison] = useState<RevisionComparison | null>(null);
  const query = useQuery({
    queryKey: ['revisions', projectId, artifact?.relativePath, versionKey],
    queryFn: () =>
      desktop!.listRevisions({
        projectId,
        relativePath: artifact!.relativePath,
        limit: 50,
        ...(versionKey ? { versionKey } : {}),
      }),
    enabled: Boolean(desktop && artifact),
  });
  const page = query.data as RevisionPage | undefined;
  const revisions = page?.items ?? [];
  const effectiveLeftId = revisions.some((revision) => revision.id === leftId)
    ? leftId
    : (revisions[1]?.id ?? '');
  const effectiveRightId = revisions.some((revision) => revision.id === rightId)
    ? rightId
    : (revisions[0]?.id ?? '');
  const visibleComparison =
    comparison && artifact && comparison.left.relativePath === artifact.relativePath
      ? comparison
      : null;
  const compare = async () => {
    if (
      !desktop ||
      !artifact ||
      !effectiveLeftId ||
      !effectiveRightId ||
      effectiveLeftId === effectiveRightId
    )
      return;
    try {
      setComparison(
        await desktop.compareRevisions({
          projectId,
          relativePath: artifact.relativePath,
          leftRevisionId: effectiveLeftId,
          rightRevisionId: effectiveRightId,
          maxLines: 1000,
        }),
      );
    } catch {
      setComparison(null);
    }
  };
  return (
    <div className="revisions-pane">
      <div className="revision-heading">
        <div>
          <span className="eyebrow">本地修订</span>
          <strong>{artifact?.relativePath ?? '选择一个文档'}</strong>
        </div>
        <button
          type="button"
          className="command-button"
          disabled={!effectiveLeftId || !effectiveRightId || effectiveLeftId === effectiveRightId}
          onClick={() => void compare()}
        >
          <GitCompareArrows size={16} aria-hidden="true" />
          比较
        </button>
      </div>
      <div className="history-toolbar revision-toolbar">
        <span>仅比较当前筛选范围内的修订</span>
        <VersionFilter summaries={versionSummaries} value={versionKey} onChange={onVersionChange} />
      </div>
      {query.isLoading ? (
        <LoadingState />
      ) : revisions.length === 0 ? (
        <EmptyState
          icon={<History size={20} />}
          title={versionKey ? '当前版本筛选下暂无保留修订' : '暂无保留修订'}
          action={
            versionKey ? (
              <button
                type="button"
                className="command-button"
                onClick={() => onVersionChange(null)}
              >
                查看全部版本
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="revision-grid">
            <label>
              较早版本
              <select value={effectiveLeftId} onChange={(event) => setLeftId(event.target.value)}>
                {revisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {formatDate(revision.createdAt)} · {displayVersion(revision.projectVersion)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              较新版本
              <select value={effectiveRightId} onChange={(event) => setRightId(event.target.value)}>
                {revisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {formatDate(revision.createdAt)} · {displayVersion(revision.projectVersion)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {visibleComparison && (
            <div className="diff-view">
              {visibleComparison.hunks.map((hunk, index) => (
                <div key={`${hunk.kind}-${index}`} className={`diff-line diff-${hunk.kind}`}>
                  <span>{hunk.kind === 'added' ? '+' : hunk.kind === 'removed' ? '-' : ' '}</span>
                  <code>{hunk.value}</code>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LoadingState(): React.JSX.Element {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={20} aria-hidden="true" />
      加载中
    </div>
  );
}

function directProjectStatus(
  candidate: CodexDirectProject,
  completed: boolean,
): {
  label: string;
  tone: 'green' | 'amber' | 'red' | 'neutral';
} {
  if (completed || candidate.status === 'already-added')
    return { label: '已添加', tone: 'neutral' };
  if (candidate.status === 'available') return { label: '可导入', tone: 'green' };
  if (candidate.status === 'unavailable') return { label: '目录不可读取', tone: 'red' };
  return { label: '未发现项目结构', tone: 'amber' };
}

function workspaceMemberStatus(
  member: CodexWorkspaceMember,
  completed: boolean,
): {
  label: string;
  tone: 'green' | 'amber' | 'red' | 'neutral';
} {
  if (completed || (member.kind === 'openspec-project' && member.status === 'already-added'))
    return { label: '已添加', tone: 'neutral' };
  if (member.kind === 'openspec-project') return { label: '可导入', tone: 'green' };
  return { label: '尚未配置 OpenSpec', tone: 'amber' };
}

function WorkspaceCheckbox({
  state,
  disabled,
  label,
  onChange,
}: {
  state: WorkspaceSelectionState;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'mixed';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === 'all'}
      disabled={disabled}
      aria-label={label}
      aria-checked={state === 'mixed' ? 'mixed' : state === 'all'}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

function truncationReasonLabel(reason: string): string {
  if (reason === 'max-depth') return '达到扫描深度上限';
  if (reason === 'max-directories') return '达到目录检查上限';
  if (reason === 'max-members') return '达到成员数量上限';
  if (reason === 'time-budget') return '达到扫描时间预算';
  return '达到候选数量上限';
}

function CodexImportDialog({
  open,
  desktop,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  desktop: DesktopApi | undefined;
  onOpenChange: (open: boolean) => void;
  onImported: (result: CodexImportResult) => void;
}): React.JSX.Element {
  const [selectedKeys, setSelectedKeys] = useState<Set<string> | null>(null);
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string> | null>(null);
  const [importResult, setImportResult] = useState<CodexImportResult | null>(null);
  const [completedRootKeys, setCompletedRootKeys] = useState<Set<string>>(() => new Set());
  const query = useQuery({
    queryKey: codexQueryKey,
    queryFn: () => desktop!.listCodexProjects(),
    enabled: open && Boolean(desktop),
    staleTime: 0,
  });
  const importMutation = useMutation({
    mutationFn: (
      projects: Array<{
        rootPath: string;
        displayName: string;
        workspace?: CodexWorkspaceReference;
      }>,
    ) => desktop!.importCodexProjects({ projects }),
    onSuccess: (result) => {
      const completed = result.items
        .filter((item) => item.status !== 'failed')
        .map((item) => codexRootKey(item.rootPath));
      setCompletedRootKeys((current) => new Set([...current, ...completed]));
      setSelectedKeys(new Set());
      onImported(result);
      if (result.items.every((item) => item.status !== 'failed')) {
        onOpenChange(false);
        return;
      }
      setImportResult(result);
    },
  });

  const data = query.data as CodexProjectList | undefined;
  const availableLeaves = useMemo(
    () => collectAvailableCodexLeaves(data?.entries ?? [], completedRootKeys),
    [completedRootKeys, data],
  );
  const workspaceIds = useMemo(
    () =>
      data?.entries.filter((entry) => entry.kind === 'workspace').map((entry) => entry.id) ?? [],
    [data],
  );
  const effectiveSelectedKeys = useMemo(
    () =>
      selectedKeys === null
        ? new Set(availableLeaves.map((candidate) => candidate.key))
        : reconcileCodexSelection(selectedKeys, availableLeaves),
    [availableLeaves, selectedKeys],
  );
  const effectiveExpandedWorkspaceIds = useMemo(() => {
    if (expandedWorkspaceIds === null) return new Set(workspaceIds);
    const validIds = new Set(workspaceIds);
    return new Set([...expandedWorkspaceIds].filter((workspaceId) => validIds.has(workspaceId)));
  }, [expandedWorkspaceIds, workspaceIds]);
  const selected = availableLeaves.filter((candidate) => effectiveSelectedKeys.has(candidate.key));
  const allSelected = availableLeaves.length > 0 && selected.length === availableLeaves.length;

  const toggleCandidate = (candidateKey: string, checked: boolean): void => {
    setSelectedKeys((current) => {
      const next = new Set(current ?? availableLeaves.map((candidate) => candidate.key));
      if (checked) next.add(candidateKey);
      else next.delete(candidateKey);
      return next;
    });
  };
  const toggleAll = (checked: boolean): void => {
    setSelectedKeys(
      checked ? new Set(availableLeaves.map((candidate) => candidate.key)) : new Set(),
    );
  };
  const toggleWorkspace = (workspaceId: string, checked: boolean): void => {
    setSelectedKeys((current) =>
      toggleWorkspaceSelection(
        workspaceId,
        checked,
        availableLeaves,
        current ?? new Set(availableLeaves.map((leaf) => leaf.key)),
      ),
    );
  };
  const toggleExpanded = (workspaceId: string): void => {
    setExpandedWorkspaceIds((current) => {
      const next = new Set(current ?? workspaceIds);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  };
  const refresh = async (): Promise<void> => {
    setImportResult(null);
    await query.refetch();
  };
  const submit = (): void => {
    if (selected.length === 0 || importMutation.isPending) return;
    importMutation.mutate(
      selected.map((candidate) => ({
        rootPath: candidate.rootPath,
        displayName: candidate.displayName,
        ...(candidate.workspace ? { workspace: candidate.workspace } : {}),
      })),
    );
  };
  const failedItems = importResult?.items.filter((item) => item.status === 'failed') ?? [];
  const successfulItems = importResult?.items.filter((item) => item.status !== 'failed') ?? [];
  const workspacesWithWarnings =
    data?.entries.filter(
      (entry) => entry.kind === 'workspace' && (entry.truncated || entry.diagnostics.length > 0),
    ) ?? [];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop codex-dialog-backdrop" />
        <Dialog.Content className="codex-import-dialog" aria-describedby="codex-import-description">
          <header className="dialog-heading codex-dialog-heading">
            <div>
              <span className="eyebrow">本机项目</span>
              <Dialog.Title className="dialog-title">从 Codex 导入</Dialog.Title>
              <Dialog.Description id="codex-import-description" className="sr-only">
                从本机 Codex 项目索引中选择有效的 OpenSpec 项目。
              </Dialog.Description>
            </div>
            <div className="dialog-heading-actions">
              <IconButton
                label="刷新 Codex 项目"
                disabled={query.isFetching || importMutation.isPending}
                onClick={() => void refresh()}
              >
                <RefreshCw className={query.isFetching ? 'spin' : ''} size={17} />
              </IconButton>
              <Dialog.Close asChild>
                <button type="button" className="icon-button" aria-label="关闭" title="关闭">
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>
          </header>

          {data && (
            <div className="codex-summary" aria-live="polite">
              <span>{data.summary.indexedRootCount} 个 Codex 根目录</span>
              <span className="summary-separator" aria-hidden="true" />
              <span>{data.summary.workspaceCount} 个工作区</span>
              <span className="summary-separator" aria-hidden="true" />
              <span>{data.summary.repositoryCount} 个代码仓库</span>
              <span className="summary-separator" aria-hidden="true" />
              <span>{data.summary.openSpecProjectCount} 个 OpenSpec 项目</span>
              <span className="summary-separator" aria-hidden="true" />
              <strong>{availableLeaves.length} 个可导入</strong>
              {data.summary.source === 'backup' && <StatusBadge tone="amber">备份索引</StatusBadge>}
            </div>
          )}
          {(data?.summary.truncated || data?.summary.message) && (
            <div className="inline-alert alert-warning">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{data.summary.message ?? '候选数量较多，仅显示索引中的前 500 项。'}</span>
            </div>
          )}
          {workspacesWithWarnings.length > 0 && (
            <div className="inline-alert alert-warning" role="status">
              <CircleAlert size={16} aria-hidden="true" />
              <span>
                {workspacesWithWarnings.length} 个工作区存在局部扫描提示，已发现项目仍可导入。
              </span>
            </div>
          )}
          {importMutation.isError && (
            <div className="inline-alert alert-error" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span>
                {importMutation.error instanceof Error
                  ? importMutation.error.message
                  : '导入失败，请重试。'}
              </span>
            </div>
          )}
          {importResult && (
            <div className="inline-alert alert-error" role="status" aria-live="polite">
              <CircleAlert size={16} aria-hidden="true" />
              <span>
                已导入 {successfulItems.length} 个，{failedItems.length} 个失败。
                {failedItems
                  .map((item) => `${item.displayName}：${item.error ?? '导入失败'}`)
                  .join('；')}
              </span>
            </div>
          )}

          <div className="codex-list-toolbar">
            <label className="master-check">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={availableLeaves.length === 0 || importMutation.isPending}
                onChange={(event) => toggleAll(event.target.checked)}
              />
              <span>全选可用项目</span>
            </label>
            <span aria-live="polite">{selected.length} 个已选</span>
          </div>

          <div className="codex-candidate-list" aria-label="Codex 项目候选">
            {query.isLoading ? (
              <LoadingState />
            ) : query.isError ? (
              <EmptyState
                icon={<CircleAlert size={20} />}
                title={query.error instanceof Error ? query.error.message : '无法读取 Codex 项目'}
                action={
                  <button type="button" className="command-button" onClick={() => void refresh()}>
                    <RefreshCw size={15} aria-hidden="true" />
                    重试
                  </button>
                }
              />
            ) : data?.entries.length ? (
              data.entries.map((entry) => {
                if (entry.kind === 'workspace') {
                  const expanded = effectiveExpandedWorkspaceIds.has(entry.id);
                  const selectionState = workspaceSelectionState(
                    entry.id,
                    availableLeaves,
                    effectiveSelectedKeys,
                  );
                  const selectable = selectionState !== 'disabled' && !importMutation.isPending;
                  return (
                    <section
                      key={entry.id}
                      className="codex-workspace-entry"
                      aria-labelledby={`codex-workspace-${entry.id}`}
                    >
                      <div className="codex-workspace-row" title={entry.rootPath}>
                        <button
                          type="button"
                          className="codex-expand-button"
                          aria-label={`${expanded ? '折叠' : '展开'}工作区 ${entry.displayName}`}
                          aria-expanded={expanded}
                          aria-controls={`codex-workspace-members-${entry.id}`}
                          onClick={() => toggleExpanded(entry.id)}
                        >
                          {expanded ? (
                            <ChevronDown size={15} aria-hidden="true" />
                          ) : (
                            <ChevronRight size={15} aria-hidden="true" />
                          )}
                        </button>
                        <WorkspaceCheckbox
                          state={selectionState}
                          disabled={!selectable}
                          label={`选择工作区 ${entry.displayName} 的可导入项目`}
                          onChange={(checked) => toggleWorkspace(entry.id, checked)}
                        />
                        <span className="candidate-copy" id={`codex-workspace-${entry.id}`}>
                          <strong>
                            <FolderCog size={14} aria-hidden="true" />
                            {entry.displayName}
                          </strong>
                          <small title={entry.rootPath}>{entry.rootPath}</small>
                        </span>
                        <span className="candidate-meta">
                          <StatusBadge tone={entry.availableCount > 0 ? 'green' : 'neutral'}>
                            {entry.availableCount > 0
                              ? `${entry.availableCount} 个可导入`
                              : '无可导入项目'}
                          </StatusBadge>
                          <small>
                            {entry.repositoryCount} 个代码仓库 · {entry.openSpecProjectCount} 个
                            OpenSpec 项目
                          </small>
                        </span>
                      </div>
                      {expanded && (
                        <div
                          id={`codex-workspace-members-${entry.id}`}
                          className="codex-workspace-members"
                          role="group"
                          aria-label={`${entry.displayName} 的项目成员`}
                        >
                          {entry.members.map((member) => {
                            const memberKey = codexRootKey(member.rootPath);
                            const completed = completedRootKeys.has(memberKey);
                            const status = workspaceMemberStatus(member, completed);
                            const memberSelectable =
                              member.kind === 'openspec-project' &&
                              member.status === 'available' &&
                              !completed;
                            return (
                              <label
                                key={member.id}
                                className={`codex-candidate codex-member ${memberSelectable ? '' : 'is-disabled'}`}
                                title={member.rootPath}
                              >
                                <input
                                  type="checkbox"
                                  checked={memberSelectable && effectiveSelectedKeys.has(memberKey)}
                                  disabled={!memberSelectable || importMutation.isPending}
                                  onChange={(event) =>
                                    toggleCandidate(memberKey, event.target.checked)
                                  }
                                />
                                <span className="candidate-copy">
                                  <strong>{member.displayName}</strong>
                                  <small title={member.rootPath}>{member.rootPath}</small>
                                </span>
                                <span className="candidate-meta">
                                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                                  <small>
                                    {member.kind === 'openspec-project'
                                      ? (member.reason ?? 'OpenSpec 项目')
                                      : member.reason}
                                  </small>
                                </span>
                              </label>
                            );
                          })}
                          {(entry.truncated || entry.diagnostics.length > 0) && (
                            <div className="codex-workspace-diagnostic" role="status">
                              <CircleAlert size={14} aria-hidden="true" />
                              <span>
                                {[
                                  ...entry.truncationReasons.map(truncationReasonLabel),
                                  ...entry.diagnostics.map((diagnostic) => diagnostic.message),
                                ]
                                  .slice(0, 3)
                                  .join('；')}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  );
                }
                const candidateKey = codexRootKey(entry.rootPath);
                const completed = completedRootKeys.has(candidateKey);
                const status = directProjectStatus(entry, completed);
                const selectable = entry.status === 'available' && !completed;
                return (
                  <label
                    key={entry.id}
                    className={`codex-candidate ${selectable ? '' : 'is-disabled'}`}
                    title={entry.rootPath}
                  >
                    <input
                      type="checkbox"
                      checked={selectable && effectiveSelectedKeys.has(candidateKey)}
                      disabled={!selectable || importMutation.isPending}
                      onChange={(event) => toggleCandidate(candidateKey, event.target.checked)}
                    />
                    <span className="candidate-copy">
                      <strong>{entry.displayName}</strong>
                      <small title={entry.rootPath}>{entry.rootPath}</small>
                    </span>
                    <span className="candidate-meta">
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      <small>
                        {entry.lastUsedAt
                          ? formatDate(entry.lastUsedAt)
                          : (entry.reason ?? 'OpenSpec 项目')}
                      </small>
                    </span>
                  </label>
                );
              })
            ) : (
              <EmptyState icon={<Laptop size={20} />} title="未发现 Codex 根目录" />
            )}
          </div>

          <footer className="codex-dialog-footer">
            <span className="privacy-note">项目索引仅在本机处理</span>
            <div className="dialog-footer-actions">
              <Dialog.Close asChild>
                <button type="button" className="command-button">
                  取消
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="command-button command-primary"
                disabled={selected.length === 0 || importMutation.isPending}
                onClick={submit}
              >
                {importMutation.isPending ? (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Download size={16} aria-hidden="true" />
                )}
                导入 {selected.length} 个项目
              </button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProjectVersionMenu({
  project,
  summaries,
  refreshing,
  onRefresh,
  onSelectVersion,
  onOpenSettings,
}: {
  project: AppSnapshot['catalog']['projects'][number];
  summaries: VersionSummary[];
  refreshing: boolean;
  onRefresh: () => void;
  onSelectVersion: (versionKey: string) => void;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const label = displayVersion(project.versionLabel);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="version-trigger"
          aria-label={`当前版本 ${label}，打开版本菜单`}
          title={label}
        >
          <Tag size={14} aria-hidden="true" />
          <span>{label}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="add-project-menu version-menu"
          side="bottom"
          align="end"
          sideOffset={7}
        >
          <DropdownMenu.Label className="version-menu-heading">
            <span>{project.versionMode === 'automatic' ? '自动识别' : '手动版本'}</span>
            <strong>{versionSourceLabel(project.versionSource)}</strong>
          </DropdownMenu.Label>
          <DropdownMenu.Item
            className="menu-item"
            disabled={project.versionMode === 'manual' || refreshing}
            onSelect={() => onRefresh()}
          >
            <RefreshCw className={refreshing ? 'spin' : ''} size={15} aria-hidden="true" />
            <span>
              {project.versionMode === 'manual' ? '手动版本无需刷新' : '重新识别本地版本'}
            </span>
          </DropdownMenu.Item>
          {summaries.length > 0 && (
            <>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Label className="menu-label">历史关联</DropdownMenu.Label>
              {summaries.slice(0, 8).map((summary) => (
                <DropdownMenu.Item
                  key={summary.key}
                  className="menu-item version-menu-item"
                  onSelect={() => onSelectVersion(summary.key)}
                >
                  <Tag size={14} aria-hidden="true" />
                  <span>{summary.label}</span>
                  <small>{summary.activityCount + summary.revisionCount}</small>
                </DropdownMenu.Item>
              ))}
            </>
          )}
          <DropdownMenu.Separator className="menu-separator" />
          <DropdownMenu.Item className="menu-item" onSelect={() => onOpenSettings()}>
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span>项目与版本设置</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ChangeVersionLinks({
  versions,
  onSelect,
}: {
  versions: VersionSummary[];
  onSelect: (versionKey: string) => void;
}): React.JSX.Element {
  if (versions.length === 0) return <span className="change-version-empty">尚无版本活动</span>;
  return (
    <div className="change-version-links" aria-label="Change 关联版本">
      <span>关联版本</span>
      {versions
        .slice()
        .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
        .map((summary) => (
          <button
            key={summary.key}
            type="button"
            className="version-chip"
            onClick={() => onSelect(summary.key)}
          >
            <Tag size={11} aria-hidden="true" />
            {summary.label}
          </button>
        ))}
    </div>
  );
}

function Workspace({ desktop }: { desktop: DesktopApi | undefined }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('changes');
  const [actionScope, setActionScope] = useState<ActionCenterViewScope>('all');
  const [selectedActionKey, setSelectedActionKey] = useState<string | null>(null);
  const [actionRefreshing, setActionRefreshing] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null);
  const [versionSelection, setVersionSelection] = useState<{
    projectId: string | null;
    key: string | null;
  }>({ projectId: null, key: null });
  const [changeView, setChangeView] = useState<ChangeView>('active');
  const [detailTab, setDetailTab] = useState<DetailTab>('artifacts');
  const [readinessFocus, setReadinessFocus] = useState<{
    section: ReadinessSection | null;
    nonce: number;
  }>({ section: null, nonce: 0 });
  const [artifactFocus, setArtifactFocus] = useState<{ path: string; nonce: number } | null>(null);
  const [mobileCatalogOpen, setMobileCatalogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [codexDialogOpen, setCodexDialogOpen] = useState(false);
  const [versionRefreshing, setVersionRefreshing] = useState(false);
  const { notice, showNotice, dismissNotice } = useTransientNotice();
  const preferencesHydrated = useRef(false);
  const handledArtifactFocus = useRef(0);
  const mobileCatalogTriggerRef = useRef<HTMLButtonElement>(null);
  const catalogLayerRef = useRef<HTMLDivElement>(null);

  const query = useQuery({
    queryKey,
    queryFn: () => desktop?.getSnapshot() ?? Promise.resolve(emptySnapshot()),
    staleTime: Infinity,
  });
  const snapshot = query.data ?? emptySnapshot();
  const allActionQuery = useActionCenter(desktop);
  useEffect(() => {
    if (!query.isSuccess || preferencesHydrated.current) return;
    const preferences = snapshot.catalog.preferences;
    const savedProjectId =
      preferences.selectedProjectId &&
      snapshot.projects.some((entry) => entry.project.id === preferences.selectedProjectId)
        ? preferences.selectedProjectId
        : null;
    setSelectedProjectId(savedProjectId);
    setSelectedChangeId(preferences.selectedChangeId);
    setChangeView(preferences.showArchived ? 'archive' : 'active');
    preferencesHydrated.current = true;
  }, [query.isSuccess, snapshot]);
  useEffect(() => {
    if (!desktop) return undefined;
    return desktop.onProjection((event) => {
      const domains = new Set(
        event.domains ?? [
          'snapshot',
          'history',
          'lifecycle',
          'action-center',
        ],
      );
      const affectedChanges = new Set(event.changeIds);
      const invalidateChangeDomain = (domain: 'change-lifecycle') => {
        const scopedKey = [domain, event.projectId];
        if (affectedChanges.size === 0) {
          return queryClient.invalidateQueries({ queryKey: scopedKey });
        }
        return queryClient.invalidateQueries({
          queryKey: scopedKey,
          predicate: (query) => affectedChanges.has(String(query.queryKey[3] ?? '')),
        });
      };
      if (domains.has('lifecycle')) void invalidateChangeDomain('change-lifecycle');
      if (domains.has('action-center')) {
        void queryClient.invalidateQueries({ queryKey: actionCenterQueryKey(), exact: true });
        void queryClient.invalidateQueries({
          queryKey: actionCenterQueryKey(event.projectId),
          exact: true,
        });
      }
      if (domains.has('snapshot')) {
        if (!event.snapshot) {
          void queryClient.invalidateQueries({ queryKey });
        } else {
          queryClient.setQueryData<AppSnapshot>(queryKey, (current) => {
            if (!current) return current;
            const projects = current.projects.map((entry) =>
              entry.project.id === event.projectId ? event.snapshot! : entry,
            );
            const catalogProjects = current.catalog.projects.map((entry) =>
              entry.id === event.projectId ? event.snapshot!.project : entry,
            );
            return {
              ...current,
              catalog: { ...current.catalog, projects: catalogProjects },
              projects,
            };
          });
        }
      }
      if (domains.has('history')) {
        void queryClient.invalidateQueries({ queryKey: ['activity', event.projectId] });
        void queryClient.invalidateQueries({ queryKey: ['revisions', event.projectId] });
        void queryClient.invalidateQueries({ queryKey: ['version-summaries', event.projectId] });
      }
    });
  }, [desktop, queryClient]);

  const project =
    snapshot.projects.find((entry) => entry.project.id === selectedProjectId) ??
    snapshot.projects[0] ??
    null;
  const effectiveActionScope = actionScope === 'project' && !project ? 'all' : actionScope;
  const actionProjectId = effectiveActionScope === 'project' ? project?.project.id : undefined;
  const actionQuery = useActionCenter(desktop, actionProjectId);
  const selectedAction =
    actionQuery.data?.items.find((item) => item.actionKey === selectedActionKey) ??
    actionQuery.data?.items[0] ??
    null;
  const versionQuery = useQuery({
    queryKey: ['version-summaries', project?.project.id],
    queryFn: () => desktop!.listVersionSummaries({ projectId: project!.project.id }),
    enabled: Boolean(desktop && project),
    staleTime: 5_000,
  });
  const versionSummaries = (versionQuery.data as VersionSummaryList | undefined)?.items ?? [];
  const visibleChanges = sortChangesByRecentActivity(
    project?.changes.filter((change) =>
      changeView === 'archive' ? change.archived : !change.archived,
    ) ?? [],
  );
  const change =
    project?.changes.find(
      (entry) => entry.id === selectedChangeId && entry.archived === (changeView === 'archive'),
    ) ??
    visibleChanges[0] ??
    null;
  const changeVersions = change
    ? versionSummaries.filter((summary) => summary.changeIds.includes(change.id))
    : [];
  const artifact =
    change?.artifacts.find((entry) => entry.relativePath === selectedArtifactPath) ??
    change?.artifacts.find((entry) => entry.type !== 'metadata') ??
    change?.artifacts[0];
  const lifecycleQuery = useChangeLifecycle(project?.project.id ?? null, change, desktop);
  const validationMutation = useChangeValidation(
    project?.project.id ?? null,
    change,
    desktop,
  );
  const validationStatus: ValidationStatus =
    change && !change.archived && validationMutation.isPending
      ? 'running'
      : (lifecycleQuery.data?.validation.status ?? 'not-run');
  const lifecycleStage = change
    ? lifecycleStagePresentation(lifecycleQuery.data, change, validationStatus)
    : null;
  const validationAction = validationActionPresentation({
    status: validationStatus,
    archived: change?.archived ?? false,
  });
  const validationIsRunning = Boolean(
    change && !change.archived && validationStatus === 'running',
  );
  const validationCanRun = Boolean(
    change &&
      !change.archived &&
      desktop &&
      typeof desktop.runChangeValidation === 'function',
  );

  useEffect(() => {
    if (!desktop || !preferencesHydrated.current) return;
    void desktop
      .updatePreferences({
        selectedProjectId: project?.project.id ?? null,
        selectedChangeId: change?.id ?? null,
        showArchived: changeView === 'archive',
      })
      .then((next) => queryClient.setQueryData(queryKey, next))
      .catch(() => undefined);
  }, [change?.id, changeView, desktop, project?.project.id, queryClient]);

  const selectedVersionKey =
    versionSelection.projectId === project?.project.id ? versionSelection.key : null;
  const selectVersion = (key: string | null) => {
    setVersionSelection({ projectId: project?.project.id ?? null, key });
  };

  const run = async (action: () => Promise<unknown>, success = '已更新') => {
    try {
      const next = await action();
      if (next && typeof next === 'object' && 'catalog' in next && 'projects' in next) {
        queryClient.setQueryData(queryKey, next as AppSnapshot);
      }
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
      void queryClient.invalidateQueries({ queryKey: ['revisions'] });
      void queryClient.invalidateQueries({ queryKey: ['version-summaries'] });
      void queryClient.invalidateQueries({ queryKey: ['change-lifecycle'] });
      void queryClient.invalidateQueries({ queryKey: ['action-center'] });
      showNotice({ tone: 'success', text: success });
      return true;
    } catch (error) {
      showNotice(
        { tone: 'error', text: error instanceof Error ? error.message : '操作失败' },
        4200,
      );
      return false;
    }
  };

  const closeMobileCatalog = useCallback((restoreFocus = true) => {
    setMobileCatalogOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => mobileCatalogTriggerRef.current?.focus(), 0);
    }
  }, []);

  useEffect(() => {
    if (!mobileCatalogOpen) return;
    window.setTimeout(() => {
      catalogLayerRef.current
        ?.querySelector<HTMLButtonElement>('.sidebar button:not(:disabled)')
        ?.focus();
    }, 0);
  }, [mobileCatalogOpen]);

  const browseProject = () => {
    if (desktop) void run(() => desktop.selectProject(), '项目已加入');
  };
  const handleCodexImported = useCallback(
    (result: CodexImportResult) => {
      queryClient.setQueryData(queryKey, result.snapshot);
      const latestProjectId = result.items
        .filter((item) => item.status === 'imported' && item.projectId)
        .at(-1)?.projectId;
      if (latestProjectId) {
        setSelectedProjectId(latestProjectId);
        setSelectedChangeId(null);
      }
      const importedCount = result.items.filter((item) => item.status !== 'failed').length;
      const failedCount = result.items.length - importedCount;
      showNotice(
        {
          tone: failedCount > 0 ? 'error' : 'success',
          text:
            failedCount > 0
              ? `已导入 ${importedCount} 个，${failedCount} 个失败`
              : `已导入 ${importedCount} 个 Codex 项目`,
        },
        failedCount > 0 ? 4200 : 3200,
      );
    },
    [queryClient, showNotice],
  );
  const createGroup = () => {
    const name = window.prompt('分组名称');
    if (name && desktop) void run(() => desktop.createGroup({ name }), '分组已创建');
  };
  const removeGroup = (groupId: string) => {
    if (!desktop || !window.confirm('移除分组后，项目会保留在未分组中。继续？')) return;
    void run(() => desktop.removeGroup({ groupId }), '分组已移除');
  };
  const closeProjectDialog = useCallback(() => setProjectDialogOpen(false), []);

  const navigateToArtifact = (requestedPath: string) => {
    const normalized = requestedPath.replaceAll('\\', '/').replace(/^\.\//, '');
    const target = change?.artifacts.find((entry) => {
      const relative = entry.relativePath.replaceAll('\\', '/');
      const source = entry.sourcePath.replaceAll('\\', '/');
      return (
        normalized === relative || normalized === source || normalized === `openspec/${relative}`
      );
    });
    if (!target || target.type === 'metadata') return;
    setSelectedArtifactPath(target.relativePath);
    setArtifactFocus((current) => ({
      path: target.relativePath,
      nonce: (current?.nonce ?? 0) + 1,
    }));
    setDetailTab('artifacts');
  };

  const selectLifecycleNode = (nodeId: LifecycleNodeId) => {
    const artifactTypeByNode: Partial<Record<LifecycleNodeId, ArtifactProjection['type']>> = {
      proposal: 'proposal',
      specs: 'spec',
      design: 'design',
      tasks: 'tasks',
    };
    const artifactType = artifactTypeByNode[nodeId];
    if (artifactType) {
      const target = change?.artifacts.find((entry) => entry.type === artifactType);
      if (target) navigateToArtifact(target.relativePath);
      else setDetailTab('artifacts');
      return;
    }
    const section: ReadinessSection = nodeId === 'validation' ? 'validation' : 'archive';
    setReadinessFocus((current) => ({ section, nonce: current.nonce + 1 }));
    setDetailTab('readiness');
  };

  const refreshActionCenter = async (): Promise<void> => {
    if (!desktop || actionRefreshing) return;
    setActionRefreshing(true);
    try {
      const request = actionProjectId ? { projectId: actionProjectId } : {};
      const next = await desktop.refreshActionCenter(request);
      queryClient.setQueryData(actionCenterQueryKey(actionProjectId), next);
      if (actionProjectId) {
        void queryClient.invalidateQueries({ queryKey: actionCenterQueryKey() });
      }
    } catch (error) {
      showNotice(
        { tone: 'error', text: error instanceof Error ? error.message : '行动中心刷新失败' },
        4200,
      );
    } finally {
      setActionRefreshing(false);
    }
  };

  const openAction = (projectId: string, changeId?: string, archived = false): void => {
    setSelectedProjectId(projectId);
    setSelectedChangeId(changeId ?? null);
    setChangeView(archived ? 'archive' : 'active');
    if (selectedAction?.targetNode === 'tasks') setDetailTab('tasks');
    else if (
      selectedAction?.targetNode === 'validation' ||
      selectedAction?.targetNode === 'archive'
    ) {
      setDetailTab('readiness');
    } else {
      setDetailTab('artifacts');
    }
    setWorkspaceMode('changes');
    if (mobileCatalogOpen) closeMobileCatalog();
  };

  return (
    <div className="app-shell" data-ui="refined">
      <header className="mobile-topbar">
        <button
          ref={mobileCatalogTriggerRef}
          type="button"
          className="icon-button"
          aria-label="打开项目目录"
          title="打开项目目录"
          aria-controls="project-catalog"
          aria-expanded={mobileCatalogOpen}
          onClick={() => setMobileCatalogOpen(true)}
        >
          <Menu size={19} />
        </button>
        <span className="mobile-title">OpenSpec Desktop</span>
        <span className="live-dot" aria-label="本地应用" />
      </header>
      <div className="workspace-grid">
        <div
          ref={catalogLayerRef}
          id="project-catalog"
          className={`catalog-layer ${mobileCatalogOpen ? 'is-open' : ''}`}
          role={mobileCatalogOpen ? 'dialog' : undefined}
          aria-label={mobileCatalogOpen ? '项目目录' : undefined}
          aria-modal={mobileCatalogOpen || undefined}
          onKeyDown={(event) => {
            if (!mobileCatalogOpen) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              closeMobileCatalog();
              return;
            }
            if (event.key === 'Tab') {
              const controls = Array.from(
                catalogLayerRef.current?.querySelectorAll<HTMLButtonElement>(
                  '.sidebar button:not(:disabled)',
                ) ?? [],
              );
              const first = controls[0];
              const last = controls.at(-1);
              if (event.shiftKey && first && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && last && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <ProjectSidebar
            snapshot={snapshot}
            selectedProjectId={project?.project.id ?? null}
            actionCount={allActionQuery.data?.summary.actionCount ?? 0}
            actionSelected={workspaceMode === 'actions'}
            onSelect={(id) => {
              setSelectedProjectId(id);
              setSelectedChangeId(null);
              setWorkspaceMode('changes');
              if (mobileCatalogOpen) closeMobileCatalog();
            }}
            onSelectActions={() => {
              setWorkspaceMode('actions');
              if (mobileCatalogOpen) closeMobileCatalog();
            }}
            onBrowse={browseProject}
            onImportCodex={() => setCodexDialogOpen(true)}
            onCreateGroup={createGroup}
            onRemoveGroup={removeGroup}
            onManage={() => setProjectDialogOpen(true)}
          />
          <button
            type="button"
            className="catalog-scrim"
            aria-label="关闭项目目录"
            onClick={() => closeMobileCatalog()}
          />
        </div>
        {workspaceMode === 'actions' ? (
          <ActionCenterView
            snapshot={actionQuery.data}
            loading={actionQuery.isLoading}
            fetching={actionQuery.isFetching || actionRefreshing}
            error={actionQuery.error}
            scope={effectiveActionScope}
            currentProjectName={project?.project.displayName}
            selectedActionKey={selectedAction?.actionKey ?? null}
            desktop={desktop}
            onScopeChange={setActionScope}
            onSelectAction={setSelectedActionKey}
            onRefresh={() => void refreshActionCenter()}
            onOpenAction={openAction}
          />
        ) : (
          <>
            <ChangeList
              key={`${project?.project.id ?? 'no-project'}:${changeView}`}
              project={project}
              desktop={desktop}
              mode={changeView}
              onModeChange={(mode) => {
                setChangeView(mode);
                setSelectedChangeId(null);
              }}
              selectedChangeId={change?.id ?? null}
              onSelect={setSelectedChangeId}
              versionSummaries={versionSummaries}
            />
            <main className="detail-pane" aria-label="Change 详情">
              {query.isLoading ? (
                <LoadingState />
              ) : !project || !change ? (
                <EmptyState
                  icon={<PanelsTopLeft size={22} />}
                  title={project ? '选择一个 Change 开始查看' : '选择一个项目开始查看'}
                  action={
                    !project ? (
                      <button type="button" className="command-button" onClick={browseProject}>
                        <FolderPlus size={16} aria-hidden="true" />
                        添加项目
                      </button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <div className="detail-heading">
                    <div className="detail-heading-copy">
                      <span className="eyebrow">{change.archived ? '已归档' : '当前变更'}</span>
                      <h1>{change.name}</h1>
                      <div className="detail-meta">
                        {lifecycleStage && (
                          <StatusBadge tone={lifecycleStage.tone}>
                            {lifecycleStage.label}
                          </StatusBadge>
                        )}
                        <ChangeAwarenessBadges change={change} />
                        {change.readiness !== 'ready' && (
                          <span className="detail-structure-warning">
                            <CircleAlert size={12} aria-hidden="true" />
                            {readinessLabel(change.readiness)}
                          </span>
                        )}
                        <span className="detail-timestamp">
                          <Clock3 size={12} aria-hidden="true" />
                          {formatDate(change.lastActivityAt)}
                        </span>
                      </div>
                      <ChangeVersionLinks
                        versions={changeVersions}
                        onSelect={(versionKey) => {
                          selectVersion(versionKey);
                          setDetailTab('activity');
                        }}
                      />
                    </div>
                    <div className="detail-actions">
                      {validationAction.visible && (
                        <ValidationActionButton
                          changeName={change.name}
                          presentation={validationAction}
                          canRun={validationCanRun}
                          running={validationIsRunning}
                          error={validationMutation.error}
                          onActivate={() => validationMutation.mutate()}
                        />
                      )}
                      <ProjectVersionMenu
                        project={project.project}
                        summaries={versionSummaries}
                        refreshing={versionRefreshing}
                        onRefresh={() => {
                          if (!desktop || versionRefreshing) return;
                          setVersionRefreshing(true);
                          void run(
                            () => desktop.refreshVersion({ projectId: project.project.id }),
                            '版本已刷新',
                          ).finally(() => setVersionRefreshing(false));
                        }}
                        onSelectVersion={(versionKey) => {
                          selectVersion(versionKey);
                          setDetailTab('activity');
                        }}
                        onOpenSettings={() => setProjectDialogOpen(true)}
                      />
                      <IconButton
                        label="重新扫描项目"
                        onClick={() => {
                          if (desktop && project)
                            void run(
                              () => desktop.rescanProject({ projectId: project.project.id }),
                              '项目已重新扫描',
                            );
                        }}
                      >
                        <RefreshCw size={17} />
                      </IconButton>
                      <IconButton label="项目设置" onClick={() => setProjectDialogOpen(true)}>
                        <SlidersHorizontal size={17} />
                      </IconButton>
                    </div>
                  </div>
                  <ChangeAwareness change={change} />
                  <LifecycleTrack
                    assessment={lifecycleQuery.data}
                    loading={lifecycleQuery.isLoading}
                    error={lifecycleQuery.error}
                    onSelect={selectLifecycleNode}
                  />
                  <Tabs.Root
                    value={detailTab}
                    onValueChange={(value) => setDetailTab(value as DetailTab)}
                    className="detail-tabs"
                  >
                    <Tabs.List className="detail-tab-list" aria-label="Change 详情视图">
                      <Tabs.Trigger value="artifacts" className="detail-tab">
                        <FileText size={15} aria-hidden="true" />
                        文档
                      </Tabs.Trigger>
                      <Tabs.Trigger value="tasks" className="detail-tab">
                        <Check size={15} aria-hidden="true" />
                        任务
                      </Tabs.Trigger>
                      <Tabs.Trigger value="readiness" className="detail-tab">
                        <ShieldCheck size={15} aria-hidden="true" />
                        就绪
                      </Tabs.Trigger>
                      <Tabs.Trigger value="activity" className="detail-tab">
                        <Clock3 size={15} aria-hidden="true" />
                        活动
                      </Tabs.Trigger>
                      <Tabs.Trigger value="revisions" className="detail-tab">
                        <History size={15} aria-hidden="true" />
                        修订
                      </Tabs.Trigger>
                    </Tabs.List>
                    <Tabs.Content value="artifacts" className="detail-content">
                      <div className="artifact-tabs" role="tablist" aria-label="Change 文档">
                        {change.artifacts
                          .filter((entry) => entry.type !== 'metadata')
                          .map((entry) => (
                            <button
                              key={entry.relativePath}
                              type="button"
                              role="tab"
                              aria-selected={artifact?.relativePath === entry.relativePath}
                              data-artifact-path={entry.relativePath}
                              className={
                                artifact?.relativePath === entry.relativePath ? 'is-selected' : ''
                              }
                              ref={(node) => {
                                if (node) {
                                  if (
                                    artifactFocus?.path === entry.relativePath &&
                                    handledArtifactFocus.current !== artifactFocus.nonce
                                  ) {
                                    handledArtifactFocus.current = artifactFocus.nonce;
                                    node.focus();
                                  }
                                }
                              }}
                              onClick={() => setSelectedArtifactPath(entry.relativePath)}
                            >
                              <FileText size={14} aria-hidden="true" />
                              {entry.relativePath.split('/').at(-1)}
                            </button>
                          ))}
                        {change.missingArtifacts.length > 0 && (
                          <span className="missing-note">
                            <CircleAlert size={14} aria-hidden="true" />
                            缺少：{change.missingArtifacts.join('、')}
                          </span>
                        )}
                      </div>
                      {artifact ? (
                        <MarkdownPane
                          projectId={project.project.id}
                          artifact={artifact}
                          desktop={desktop}
                        />
                      ) : (
                        <EmptyState icon={<FileText size={20} />} title="暂无文档" />
                      )}
                    </Tabs.Content>
                    <Tabs.Content value="tasks" className="detail-content">
                      <TasksPane change={change} />
                    </Tabs.Content>
                    <Tabs.Content value="readiness" className="detail-content readiness-content">
                      <ReadinessPane
                        assessment={lifecycleQuery.data}
                        loading={lifecycleQuery.isLoading}
                        error={lifecycleQuery.error}
                        artifacts={change.artifacts}
                        focusSection={readinessFocus.section}
                        focusNonce={readinessFocus.nonce}
                        onNavigateArtifact={navigateToArtifact}
                        validationRunning={validationIsRunning}
                        validationError={validationMutation.error}
                      />
                    </Tabs.Content>
                    <Tabs.Content value="activity" className="detail-content">
                      {project && (
                        <ActivityPane
                          projectId={project.project.id}
                          changeId={change.id}
                          desktop={desktop}
                          versionSummaries={versionSummaries}
                          versionKey={selectedVersionKey}
                          onVersionChange={selectVersion}
                        />
                      )}
                    </Tabs.Content>
                    <Tabs.Content value="revisions" className="detail-content">
                      {project && (
                        <RevisionsPane
                          projectId={project.project.id}
                          artifact={artifact}
                          desktop={desktop}
                          versionSummaries={versionSummaries}
                          versionKey={selectedVersionKey}
                          onVersionChange={selectVersion}
                        />
                      )}
                    </Tabs.Content>
                  </Tabs.Root>
                </>
              )}
            </main>
          </>
        )}
      </div>
      {notice && (
        <div
          className={`toast toast-${notice.tone} is-${notice.phase}`}
          role="status"
          aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          {notice.tone === 'success' ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <CircleAlert size={15} aria-hidden="true" />
          )}
          <span className="toast-message">{notice.text}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="关闭通知"
            title="关闭通知"
            onClick={dismissNotice}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {project && (
        <ProjectDialog
          key={`${project.project.id}-${projectDialogOpen}`}
          open={projectDialogOpen}
          project={project.project}
          groups={snapshot.catalog.groups}
          desktop={desktop}
          onClose={closeProjectDialog}
          onRun={run}
        />
      )}
      <CodexImportDialog
        key={codexDialogOpen ? 'codex-open' : 'codex-closed'}
        open={codexDialogOpen}
        desktop={desktop}
        onOpenChange={setCodexDialogOpen}
        onImported={handleCodexImported}
      />
    </div>
  );
}

function ProjectDialog({
  open,
  project,
  groups,
  desktop,
  onClose,
  onRun,
}: {
  open: boolean;
  project: AppSnapshot['catalog']['projects'][number];
  groups: AppSnapshot['catalog']['groups'];
  desktop: DesktopApi | undefined;
  onClose: () => void;
  onRun: (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
}): React.JSX.Element | null {
  const [name, setName] = useState(project.displayName);
  const [version, setVersion] = useState(project.versionLabel);
  const [versionMode, setVersionMode] = useState(project.versionMode);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState(project.groupId ?? '');
  const [revisionsPerArtifact, setRevisionsPerArtifact] = useState(50);
  const [activityPerProject, setActivityPerProject] = useState(1000);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !desktop) return undefined;
    let cancelled = false;
    void desktop
      .getRetention({ projectId: project.id })
      .then((retention) => {
        if (cancelled) return;
        setRevisionsPerArtifact(retention.revisionsPerArtifact);
        setActivityPerProject(retention.activityPerProject);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [desktop, open, project.id]);

  if (!open) return null;
  const showStorage = async () => {
    if (!desktop) return;
    setStoragePath(await desktop.getUserDataPath());
  };
  const clearHistory = () => {
    if (
      desktop &&
      window.confirm('将删除本地快照、活动、实施轮次和归档基线，不会改动项目文件。继续？')
    ) {
      void onRun(
        () =>
          desktop.clearHistory({
            projectId: project.id,
            confirm: true,
            retention: { revisionsPerArtifact, activityPerProject },
          }),
        '本地历史已清除',
      );
    }
  };
  const saveRetention = () => {
    if (!desktop) return;
    void onRun(
      () =>
        desktop.setRetention({
          projectId: project.id,
          retention: { revisionsPerArtifact, activityPerProject },
        }),
      '保留策略已保存',
    );
  };
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className="settings-dialog"
          aria-describedby="settings-description"
          onOpenAutoFocus={() => {
            returnFocusRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">项目管理</span>
              <Dialog.Title className="dialog-title">{project.displayName}</Dialog.Title>
              <Dialog.Description id="settings-description" className="sr-only">
                修改项目显示信息、历史保留策略和本地存储位置。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label="关闭" title="关闭">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>
          <div className="form-stack">
            <label>
              显示名称
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="version-settings-block">
              <div className="field-heading">
                <span className="field-label">版本上下文</span>
                <span className="field-hint">
                  当前：{displayVersion(project.versionLabel)} ·{' '}
                  {versionSourceLabel(project.versionSource)}
                </span>
              </div>
              <div className="mini-segment version-mode-segment" role="group" aria-label="版本模式">
                <button
                  type="button"
                  className={versionMode === 'automatic' ? 'is-active' : ''}
                  aria-pressed={versionMode === 'automatic'}
                  onClick={() => {
                    setVersionMode('automatic');
                    setVersionError(null);
                  }}
                >
                  自动识别
                </button>
                <button
                  type="button"
                  className={versionMode === 'manual' ? 'is-active' : ''}
                  aria-pressed={versionMode === 'manual'}
                  onClick={() => setVersionMode('manual')}
                >
                  手动设置
                </button>
              </div>
              {versionMode === 'manual' ? (
                <label>
                  手动版本标签
                  <input
                    value={version}
                    onChange={(event) => {
                      setVersion(event.target.value);
                      setVersionError(null);
                    }}
                    placeholder="例如 v1.2.0"
                    aria-invalid={Boolean(versionError)}
                    aria-describedby={versionError ? 'version-error' : 'version-hint'}
                  />
                  <span id="version-hint" className="field-hint">
                    去除首尾空白后 1-120 个字符 · {version.trim().length}/120
                  </span>
                  {versionError && (
                    <span id="version-error" className="field-error" role="alert">
                      {versionError}
                    </span>
                  )}
                </label>
              ) : (
                <div className="version-auto-preview">
                  <Tag size={15} aria-hidden="true" />
                  <span>{displayVersion(project.versionLabel)}</span>
                  <small>{versionSourceLabel(project.versionSource)}</small>
                </div>
              )}
            </div>
            <label>
              分组
              <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                <option value="">未分组</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="retention-grid">
              <label>
                每个文档保留修订
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={revisionsPerArtifact}
                  onChange={(event) => setRevisionsPerArtifact(Number(event.target.value))}
                />
              </label>
              <label>
                每个项目保留活动
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={activityPerProject}
                  onChange={(event) => setActivityPerProject(Number(event.target.value))}
                />
              </label>
            </div>
          </div>
          <div className="settings-privacy-note" role="note" aria-label="本地数据说明">
            <strong>本地数据说明</strong>
            <span>
              行动中心只读，不会修改项目或 Git；严格验证只检查 OpenSpec 契约，不代表代码已交付。
              实施轮次从本机首次观察开始。清除历史会重置快照、活动、轮次和归档基线，
              且不会改动项目文件。
            </span>
            <span>
              归档就绪只表示项目工件、任务和严格验证满足门槛，不证明需求或实现正确。
              旧版规格保障数据已停用；应用不会读取、迁移或自动清理它。
            </span>
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="command-button command-primary"
              onClick={() => {
                const normalizedVersion = version.trim();
                if (versionMode === 'manual' && !normalizedVersion) {
                  setVersionError('手动版本标签不能为空');
                  return;
                }
                if (versionMode === 'manual' && normalizedVersion.length > 120) {
                  setVersionError('手动版本标签不能超过 120 个字符');
                  return;
                }
                if (desktop)
                  void onRun(
                    () =>
                      desktop.updateProject({
                        projectId: project.id,
                        displayName: name,
                        ...(versionMode === 'manual'
                          ? { versionLabel: normalizedVersion, versionMode: 'manual' as const }
                          : { versionMode: 'automatic' as const }),
                        groupId: groupId || null,
                      }),
                    '项目设置已保存',
                  );
                onClose();
              }}
            >
              <Check size={16} aria-hidden="true" />
              保存
            </button>
            <button type="button" className="command-button" onClick={saveRetention}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              保存保留策略
            </button>
            <button
              type="button"
              className="command-button"
              onClick={() => {
                if (desktop)
                  void onRun(
                    () => desktop.selectRelocation({ projectId: project.id }),
                    '项目路径已更新',
                  );
              }}
            >
              <Upload size={16} aria-hidden="true" />
              重新定位
            </button>
            <button
              type="button"
              className="command-button"
              onClick={() => {
                if (desktop)
                  void onRun(
                    () => desktop.rescanProject({ projectId: project.id }),
                    '项目已重新扫描',
                  );
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
              重新扫描
            </button>
            <button type="button" className="command-button" onClick={() => void showStorage()}>
              <FolderCog size={16} aria-hidden="true" />
              本地存储
            </button>
            <button type="button" className="command-button" onClick={clearHistory}>
              <Trash2 size={16} aria-hidden="true" />
              清除历史
            </button>
          </div>
          {storagePath && <code className="storage-path">{storagePath}</code>}
          <div className="dialog-danger">
            <button
              type="button"
              className="text-button danger-button"
              onClick={() => {
                if (desktop && window.confirm('只会移除本地目录登记，不会删除项目文件。继续？')) {
                  void onRun(
                    () => desktop.unregisterProject({ projectId: project.id }),
                    '项目已移除',
                  );
                  onClose();
                }
              }}
            >
              <Trash2 size={15} aria-hidden="true" />
              移除项目登记
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function App(): React.JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  const desktop = typeof window !== 'undefined' ? window.desktop : undefined;
  return (
    <QueryClientProvider client={queryClient}>
      <Workspace desktop={desktop} />
    </QueryClientProvider>
  );
}
