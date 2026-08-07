import { useCallback, useEffect, useRef, useState } from 'react';
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
  LoaderCircle,
  Menu,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
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
  CodexImportResult,
  CodexProjectCandidate,
  CodexProjectList,
  ProjectSnapshot,
  RevisionComparison,
  RevisionPage,
} from '@shared/contracts';
import type { DesktopApi } from '@shared/desktop-api';

type ChangeView = 'active' | 'archive';
type DetailTab = 'artifacts' | 'tasks' | 'activity' | 'revisions';

const queryKey = ['app-snapshot'];
const codexQueryKey = ['codex-projects'];

function emptySnapshot(): AppSnapshot {
  return {
    catalog: {
      schemaVersion: 1,
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

function stageLabel(stage: ChangeProjection['stage']): string {
  return {
    draft: '草稿',
    specified: '已提案',
    designed: '规格中',
    planned: '已设计',
    implementing: '实现中',
    verifying: '验证中',
    completed: '已完成',
    archived: '已归档',
  }[stage];
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
      <span className="progress-fill" style={{ width: `${ratio}%` }} />
    </div>
  );
}

function ProjectSidebar({
  snapshot,
  selectedProjectId,
  onSelect,
  onBrowse,
  onImportCodex,
  onCreateGroup,
  onRemoveGroup,
  onManage,
}: {
  snapshot: AppSnapshot;
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
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
      <div className="project-tree">
        {grouped.map(({ group, projects }) => (
          <section key={group.id} className="tree-group" aria-labelledby={`group-${group.id}`}>
            <div className="tree-group-heading">
              <span id={`group-${group.id}`}>
                <Folder size={14} aria-hidden="true" />
                {group.name}
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
        <small>{project.versionLabel || '未设置版本'}</small>
      </span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  );
}

function ChangeList({
  project,
  mode,
  onModeChange,
  selectedChangeId,
  onSelect,
}: {
  project: ProjectSnapshot | null;
  mode: ChangeView;
  onModeChange: (mode: ChangeView) => void;
  selectedChangeId: string | null;
  onSelect: (changeId: string) => void;
}): React.JSX.Element {
  const changes =
    project?.changes.filter((change) =>
      mode === 'archive' ? change.archived : !change.archived,
    ) ?? [];
  return (
    <section className="change-list-pane" aria-label="Change 列表">
      <div className="pane-heading">
        <div>
          <span className="eyebrow">{project?.project.displayName ?? '工作区'}</span>
          <h2>Changes</h2>
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
          进行中
        </button>
        <button
          type="button"
          aria-pressed={mode === 'archive'}
          className={mode === 'archive' ? 'is-active' : ''}
          onClick={() => onModeChange('archive')}
        >
          <Archive size={14} aria-hidden="true" />
          归档
        </button>
      </div>
      <div className="change-list" role="list">
        {changes.map((change) => (
          <ChangeRow
            key={`${change.archived ? 'archive-' : ''}${change.id}`}
            change={change}
            selected={selectedChangeId === change.id}
            onClick={() => onSelect(change.id)}
          />
        ))}
        {changes.length === 0 && (
          <EmptyState
            icon={mode === 'archive' ? <Archive size={20} /> : <FileCode2 size={20} />}
            title={mode === 'archive' ? '暂无归档 Change' : '暂无进行中的 Change'}
          />
        )}
      </div>
    </section>
  );
}

function ChangeRow({
  change,
  selected,
  onClick,
}: {
  change: ChangeProjection;
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const tone =
    change.readiness === 'ready' ? 'green' : change.readiness === 'parse-error' ? 'red' : 'amber';
  return (
    <button
      type="button"
      role="listitem"
      className={`change-row ${selected ? 'is-selected' : ''}`}
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
    >
      <span className="change-row-top">
        <strong>{change.name}</strong>
        <ChevronRight size={15} aria-hidden="true" />
      </span>
      <span className="change-row-meta">
        <StatusBadge tone={tone}>{stageLabel(change.stage)}</StatusBadge>
        <span>
          {change.taskTotals.completed}/{change.taskTotals.total} 任务
        </span>
      </span>
      <ProgressBar completed={change.taskTotals.completed} total={change.taskTotals.total} />
      <span className="change-row-foot">
        <span>{readinessLabel(change.readiness)}</span>
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

function ActivityPane({
  projectId,
  changeId,
  desktop,
}: {
  projectId: string;
  changeId: string;
  desktop: DesktopApi | undefined;
}): React.JSX.Element {
  const query = useQuery({
    queryKey: ['activity', projectId, changeId],
    queryFn: () => desktop!.listActivity({ projectId, changeId, limit: 50 }),
    enabled: Boolean(desktop),
  });
  const page = query.data as ActivityPage | undefined;
  return (
    <div className="activity-pane">
      {query.isLoading ? (
        <LoadingState />
      ) : page?.items.length ? (
        <ol className="activity-list">
          {page.items.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} />
          ))}
        </ol>
      ) : (
        <EmptyState icon={<Clock3 size={20} />} title="暂无活动记录" />
      )}
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }): React.JSX.Element {
  return (
    <li>
      <span className="activity-marker" aria-hidden="true" />
      <div>
        <strong>{entry.summary}</strong>
        <p>
          {formatDate(entry.createdAt)} · {entry.projectVersion || '未设置版本'}
        </p>
      </div>
    </li>
  );
}

function RevisionsPane({
  projectId,
  artifact,
  desktop,
}: {
  projectId: string;
  artifact: ArtifactProjection | undefined;
  desktop: DesktopApi | undefined;
}): React.JSX.Element {
  const [leftId, setLeftId] = useState<string>('');
  const [rightId, setRightId] = useState<string>('');
  const [comparison, setComparison] = useState<RevisionComparison | null>(null);
  const query = useQuery({
    queryKey: ['revisions', projectId, artifact?.relativePath],
    queryFn: () =>
      desktop!.listRevisions({ projectId, relativePath: artifact!.relativePath, limit: 50 }),
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
      {query.isLoading ? (
        <LoadingState />
      ) : revisions.length === 0 ? (
        <EmptyState icon={<History size={20} />} title="暂无保留修订" />
      ) : (
        <>
          <div className="revision-grid">
            <label>
              较早版本
              <select value={effectiveLeftId} onChange={(event) => setLeftId(event.target.value)}>
                {revisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {formatDate(revision.createdAt)} · {revision.contentHash.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              较新版本
              <select value={effectiveRightId} onChange={(event) => setRightId(event.target.value)}>
                {revisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {formatDate(revision.createdAt)} · {revision.contentHash.slice(0, 8)}
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

function codexCandidateStatus(
  candidate: CodexProjectCandidate,
  imported: boolean,
): {
  label: string;
  tone: 'green' | 'amber' | 'red' | 'neutral';
} {
  if (imported || candidate.status === 'already-added') return { label: '已添加', tone: 'neutral' };
  if (candidate.status === 'available') return { label: '可导入', tone: 'green' };
  if (candidate.status === 'missing') return { label: '目录不可用', tone: 'red' };
  return { label: '不是 OpenSpec 项目', tone: 'amber' };
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
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [importResult, setImportResult] = useState<CodexImportResult | null>(null);
  const [completedRoots, setCompletedRoots] = useState<Set<string>>(() => new Set());
  const query = useQuery({
    queryKey: codexQueryKey,
    queryFn: () => desktop!.listCodexProjects(),
    enabled: open && Boolean(desktop),
    staleTime: 0,
  });
  const importMutation = useMutation({
    mutationFn: (projects: Array<{ rootPath: string; displayName: string }>) =>
      desktop!.importCodexProjects({ projects }),
    onSuccess: (result) => {
      const completed = result.items
        .filter((item) => item.status !== 'failed')
        .map((item) => item.rootPath);
      setCompletedRoots((current) => new Set([...current, ...completed]));
      setSelectedIds(new Set());
      onImported(result);
      if (result.items.every((item) => item.status !== 'failed')) {
        onOpenChange(false);
        return;
      }
      setImportResult(result);
    },
  });

  const data = query.data as CodexProjectList | undefined;
  const available =
    data?.candidates.filter(
      (candidate) => candidate.status === 'available' && !completedRoots.has(candidate.rootPath),
    ) ?? [];
  const effectiveSelectedIds = selectedIds ?? new Set(available.map((candidate) => candidate.id));
  const selected = available.filter((candidate) => effectiveSelectedIds.has(candidate.id));
  const allSelected = available.length > 0 && selected.length === available.length;
  const toggleCandidate = (candidateId: string, checked: boolean): void => {
    setSelectedIds((current) => {
      const next = new Set(current ?? available.map((candidate) => candidate.id));
      if (checked) next.add(candidateId);
      else next.delete(candidateId);
      return next;
    });
  };
  const toggleAll = (checked: boolean): void => {
    setSelectedIds(checked ? new Set(available.map((candidate) => candidate.id)) : new Set());
  };
  const refresh = async (): Promise<void> => {
    setImportResult(null);
    setSelectedIds(null);
    await query.refetch();
  };
  const submit = (): void => {
    if (selected.length === 0 || importMutation.isPending) return;
    importMutation.mutate(
      selected.map((candidate) => ({
        rootPath: candidate.rootPath,
        displayName: candidate.displayName,
      })),
    );
  };
  const failedItems = importResult?.items.filter((item) => item.status === 'failed') ?? [];
  const successfulItems = importResult?.items.filter((item) => item.status !== 'failed') ?? [];

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
              <span>{data.summary.candidateCount} 个候选</span>
              <span className="summary-separator" aria-hidden="true" />
              <strong>{available.length} 个可导入</strong>
              {data.summary.source === 'backup' && <StatusBadge tone="amber">备份索引</StatusBadge>}
            </div>
          )}
          {(data?.summary.truncated || data?.summary.message) && (
            <div className="inline-alert alert-warning">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{data.summary.message ?? '候选数量较多，仅显示索引中的前 500 项。'}</span>
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
                disabled={available.length === 0 || importMutation.isPending}
                onChange={(event) => toggleAll(event.target.checked)}
              />
              <span>全选可用项目</span>
            </label>
            <span>{selected.length} 个已选</span>
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
            ) : data?.candidates.length ? (
              data.candidates.map((candidate) => {
                const imported = completedRoots.has(candidate.rootPath);
                const status = codexCandidateStatus(candidate, imported);
                const selectable = candidate.status === 'available' && !imported;
                return (
                  <label
                    key={candidate.id}
                    className={`codex-candidate ${selectable ? '' : 'is-disabled'}`}
                    title={candidate.rootPath}
                  >
                    <input
                      type="checkbox"
                      checked={selectable && effectiveSelectedIds.has(candidate.id)}
                      disabled={!selectable || importMutation.isPending}
                      onChange={(event) => toggleCandidate(candidate.id, event.target.checked)}
                    />
                    <span className="candidate-copy">
                      <strong>{candidate.displayName}</strong>
                      <small>{candidate.rootPath}</small>
                    </span>
                    <span className="candidate-meta">
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      <small>
                        {candidate.lastUsedAt
                          ? formatDate(candidate.lastUsedAt)
                          : (candidate.reason ?? 'Codex 工作区')}
                      </small>
                    </span>
                  </label>
                );
              })
            ) : (
              <EmptyState icon={<Laptop size={20} />} title="未发现 Codex 项目" />
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

function Workspace({ desktop }: { desktop: DesktopApi | undefined }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null);
  const [changeView, setChangeView] = useState<ChangeView>('active');
  const [detailTab, setDetailTab] = useState<DetailTab>('artifacts');
  const [mobileCatalogOpen, setMobileCatalogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [codexDialogOpen, setCodexDialogOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const preferencesHydrated = useRef(false);

  const query = useQuery({
    queryKey,
    queryFn: () => desktop?.getSnapshot() ?? Promise.resolve(emptySnapshot()),
    staleTime: Infinity,
  });
  const snapshot = query.data ?? emptySnapshot();
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
      if (!event.snapshot) {
        void queryClient.invalidateQueries({ queryKey });
        return;
      }
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
      void queryClient.invalidateQueries({ queryKey: ['activity', event.projectId] });
      void queryClient.invalidateQueries({ queryKey: ['revisions', event.projectId] });
    });
  }, [desktop, queryClient]);

  const project =
    snapshot.projects.find((entry) => entry.project.id === selectedProjectId) ??
    snapshot.projects[0] ??
    null;
  const visibleChanges =
    project?.changes.filter((change) =>
      changeView === 'archive' ? change.archived : !change.archived,
    ) ?? [];
  const change =
    project?.changes.find(
      (entry) => entry.id === selectedChangeId && entry.archived === (changeView === 'archive'),
    ) ??
    visibleChanges[0] ??
    null;
  const artifact =
    change?.artifacts.find((entry) => entry.relativePath === selectedArtifactPath) ??
    change?.artifacts.find((entry) => entry.type !== 'metadata') ??
    change?.artifacts[0];

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

  const run = async (action: () => Promise<unknown>, success = '已更新') => {
    try {
      const next = await action();
      if (next && typeof next === 'object' && 'catalog' in next && 'projects' in next) {
        queryClient.setQueryData(queryKey, next as AppSnapshot);
      }
      setNotice({ tone: 'success', text: success });
      window.setTimeout(() => setNotice(null), 2600);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '操作失败' });
    }
  };

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
      setNotice({
        tone: failedCount > 0 ? 'error' : 'success',
        text:
          failedCount > 0
            ? `已导入 ${importedCount} 个，${failedCount} 个失败`
            : `已导入 ${importedCount} 个 Codex 项目`,
      });
      window.setTimeout(() => setNotice(null), 3200);
    },
    [queryClient],
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

  return (
    <div className="app-shell">
      <header className="mobile-topbar">
        <IconButton label="打开项目目录" onClick={() => setMobileCatalogOpen(true)}>
          <Menu size={19} />
        </IconButton>
        <span className="mobile-title">OpenSpec Desktop</span>
        <span className="live-dot" aria-label="本地应用" />
      </header>
      <div className="workspace-grid">
        <div className={`catalog-layer ${mobileCatalogOpen ? 'is-open' : ''}`}>
          <ProjectSidebar
            snapshot={snapshot}
            selectedProjectId={project?.project.id ?? null}
            onSelect={(id) => {
              setSelectedProjectId(id);
              setSelectedChangeId(null);
              setMobileCatalogOpen(false);
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
            onClick={() => setMobileCatalogOpen(false)}
          />
        </div>
        <ChangeList
          project={project}
          mode={changeView}
          onModeChange={(mode) => {
            setChangeView(mode);
            setSelectedChangeId(null);
          }}
          selectedChangeId={change?.id ?? null}
          onSelect={setSelectedChangeId}
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
                  <span className="eyebrow">{change.archived ? '归档 Change' : '当前 Change'}</span>
                  <h1>{change.name}</h1>
                  <div className="detail-meta">
                    <StatusBadge
                      tone={
                        change.readiness === 'ready'
                          ? 'green'
                          : change.readiness === 'parse-error'
                            ? 'red'
                            : 'amber'
                      }
                    >
                      {readinessLabel(change.readiness)}
                    </StatusBadge>
                    <StatusBadge>{stageLabel(change.stage)}</StatusBadge>
                    <span>{formatDate(change.lastActivityAt)}</span>
                  </div>
                </div>
                <div className="detail-actions">
                  <IconButton
                    label="重新扫描项目"
                    onClick={() => {
                      if (desktop && project)
                        void run(
                          () => desktop.rescanProject({ projectId: project.project.id }),
                          '扫描完成',
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
                          className={
                            artifact?.relativePath === entry.relativePath ? 'is-selected' : ''
                          }
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
                <Tabs.Content value="activity" className="detail-content">
                  {project && (
                    <ActivityPane
                      projectId={project.project.id}
                      changeId={change.id}
                      desktop={desktop}
                    />
                  )}
                </Tabs.Content>
                <Tabs.Content value="revisions" className="detail-content">
                  {project && (
                    <RevisionsPane
                      projectId={project.project.id}
                      artifact={artifact}
                      desktop={desktop}
                    />
                  )}
                </Tabs.Content>
              </Tabs.Root>
            </>
          )}
        </main>
      </div>
      {notice && (
        <div
          className={`toast toast-${notice.tone}`}
          role="status"
          aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          {notice.tone === 'success' ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <CircleAlert size={15} aria-hidden="true" />
          )}
          {notice.text}
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
  onRun: (action: () => Promise<unknown>, success?: string) => Promise<void>;
}): React.JSX.Element | null {
  const [name, setName] = useState(project.displayName);
  const [version, setVersion] = useState(project.versionLabel);
  const [groupId, setGroupId] = useState(project.groupId ?? '');
  const [revisionsPerArtifact, setRevisionsPerArtifact] = useState(50);
  const [activityPerProject, setActivityPerProject] = useState(1000);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const getFocusable = (): HTMLElement[] =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]',
        ),
      );
    const focusables = getFocusable();
    (focusables[0] ?? dialog).focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const current = getFocusable();
      if (current.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = current[0]!;
      const last = current[current.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open]);

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
    if (desktop && window.confirm('只会删除本地快照和活动，不会改动项目文件。继续？')) {
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
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        aria-describedby="settings-description"
        tabIndex={-1}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">项目管理</span>
            <h2 id="settings-title">{project.displayName}</h2>
            <p id="settings-description" className="sr-only">
              修改项目显示信息、历史保留策略和本地存储位置。
            </p>
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="form-stack">
          <label>
            显示名称
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            当前版本
            <input
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder="例如 2026.08"
            />
          </label>
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
        <div className="dialog-actions">
          <button
            type="button"
            className="command-button command-primary"
            onClick={() => {
              if (desktop)
                void onRun(
                  () =>
                    desktop.updateProject({
                      projectId: project.id,
                      displayName: name,
                      versionLabel: version,
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
                void onRun(() => desktop.rescanProject({ projectId: project.id }), '扫描完成');
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
      </section>
    </div>
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
