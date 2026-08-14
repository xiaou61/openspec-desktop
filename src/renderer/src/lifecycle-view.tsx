import { useEffect, useId, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  FileText,
  GitCompareArrows,
  ListChecks,
  LoaderCircle,
  PanelsTopLeft,
  ShieldCheck,
} from 'lucide-react';
import type {
  ArtifactProjection,
  ChangeLifecycleAssessment,
  LifecycleNodeId,
  LifecycleNodeState,
  ValidationStatus,
} from '@shared/contracts';
import type { ValidationActionPresentation } from './lifecycle-model';

export type ReadinessSection = 'validation' | 'archive';

type StatusTone = 'neutral' | 'green' | 'amber' | 'red' | 'blue';

const trackNodes: Array<{
  id: LifecycleNodeId;
  label: string;
  icon: typeof FileText;
}> = [
  { id: 'proposal', label: '提案', icon: FileText },
  { id: 'specs', label: '规格', icon: FileText },
  { id: 'design', label: '设计', icon: PanelsTopLeft },
  { id: 'tasks', label: '任务', icon: ListChecks },
  { id: 'validation', label: '验证', icon: ShieldCheck },
  { id: 'archive', label: '归档', icon: Archive },
];

const lifecycleStateLabels: Record<LifecycleNodeState, string> = {
  complete: '已完成',
  current: '当前',
  ready: '已就绪',
  blocked: '阻塞',
  pending: '待处理',
  unavailable: '不可用',
  archived: '已归档',
};

const validationLabels: Record<ValidationStatus, string> = {
  'not-run': '尚未验证',
  running: '验证中',
  passed: '验证通过',
  failed: '验证失败',
  unavailable: '验证不可用',
  stale: '验证已过期',
};

const validationTones: Record<ValidationStatus, StatusTone> = {
  'not-run': 'amber',
  running: 'blue',
  passed: 'green',
  failed: 'red',
  unavailable: 'neutral',
  stale: 'amber',
};

const validationBadgeLabels: Record<ValidationStatus, string> = {
  'not-run': '未运行',
  running: '运行中',
  passed: '通过',
  failed: '失败',
  unavailable: '不可用',
  stale: '已过期',
};

function formatCheckedAt(value: string | undefined): string {
  if (!value) return '尚无检查记录';
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
  return error instanceof Error ? error.message : '生命周期证据暂时不可用';
}

export function ValidationActionButton({
  changeName,
  presentation,
  canRun,
  running,
  error,
  onActivate,
}: {
  changeName: string;
  presentation: ValidationActionPresentation;
  canRun: boolean;
  running: boolean;
  error: unknown;
  onActivate: () => void;
}): React.JSX.Element | null {
  if (!presentation.visible) return null;
  const disabled = !canRun || presentation.disabled;
  return (
    <div className="validation-action-block">
      <button
        type="button"
        className="command-button command-primary validation-action"
        data-validation-state={presentation.status}
        aria-busy={running || undefined}
        aria-disabled={disabled || undefined}
        aria-label={`${changeName}，${presentation.accessibleLabel}`}
        title={presentation.label}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          onActivate();
        }}
      >
        {running ? (
          <LoaderCircle size={15} className="spin" aria-hidden="true" />
        ) : (
          <ShieldCheck size={15} aria-hidden="true" />
        )}
        <span>{presentation.label}</span>
      </button>
      {running && (
        <span className="validation-action-note" role="status">
          正在调用 OpenSpec 严格验证
        </span>
      )}
      {error ? (
        <span className="validation-action-note validation-action-error" role="alert">
          {readableError(error)}
        </span>
      ) : null}
    </div>
  );
}

function Disclosure({
  className,
  summary,
  children,
  regionLabel,
  defaultOpen = false,
}: {
  className: string;
  summary: React.ReactNode;
  children: React.ReactNode;
  regionLabel: string;
  defaultOpen?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <div className={`${className} disclosure ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="disclosure-trigger"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        {summary}
        <ChevronDown className="disclosure-chevron" size={15} aria-hidden="true" />
      </button>
      <div
        id={contentId}
        className="disclosure-panel"
        role="region"
        aria-label={regionLabel}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="disclosure-panel-inner">{children}</div>
      </div>
    </div>
  );
}

function nodeStateIcon(state: LifecycleNodeState): typeof Check {
  if (state === 'complete' || state === 'archived') return Check;
  if (state === 'blocked' || state === 'unavailable') return CircleAlert;
  if (state === 'current') return LoaderCircle;
  return CircleDashed;
}

export function LifecycleTrack({
  assessment,
  loading,
  error,
  onSelect,
}: {
  assessment: ChangeLifecycleAssessment | undefined;
  loading: boolean;
  error: unknown;
  onSelect: (nodeId: LifecycleNodeId) => void;
}): React.JSX.Element {
  const nodeById = new Map(assessment?.nodes.map((node) => [node.id, node]));
  const liveSummary = assessment
    ? assessment.nodes.map((node) => `${node.label}${lifecycleStateLabels[node.state]}`).join('，')
    : error
      ? '生命周期证据不可用'
      : '正在读取生命周期证据';
  return (
    <nav className="lifecycle-track" aria-label="Change 生命周期" aria-busy={loading} tabIndex={0}>
      <ol>
        {trackNodes.map((definition) => {
          const node = nodeById.get(definition.id);
          const state: LifecycleNodeState = node?.state ?? (error ? 'unavailable' : 'pending');
          const Icon = definition.icon;
          const StateIcon = nodeStateIcon(state);
          return (
            <li key={definition.id} className={`lifecycle-step state-${state}`} data-state={state}>
              <span className="lifecycle-connector" aria-hidden="true" />
              <button
                type="button"
                aria-label={`${definition.label}：${lifecycleStateLabels[state]}`}
                aria-current={state === 'current' ? 'step' : undefined}
                onClick={() => onSelect(definition.id)}
              >
                <span className="lifecycle-node-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="lifecycle-node-copy">
                  <strong>{definition.label}</strong>
                  <small className="lifecycle-state-mark">
                    <StateIcon size={11} aria-hidden="true" />
                    {lifecycleStateLabels[state]}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        生命周期已更新：{liveSummary}
      </span>
      {error ? <span className="sr-only">{readableError(error)}</span> : null}
    </nav>
  );
}

function artifactStatusLabel(
  status: ChangeLifecycleAssessment['artifactGraph']['artifacts'][number]['status'],
) {
  return {
    done: '完成',
    skipped: '跳过',
    blocked: '阻塞',
    pending: '待处理',
    unknown: '未知',
  }[status];
}

function specImpactStatusLabel(status: ChangeLifecycleAssessment['sync']['status']): string {
  return {
    'not-applicable': '无需更新',
    pending: '归档时将更新',
    synced: '已反映',
    unknown: '预览不可用',
  }[status];
}

function specImpactDescription(sync: ChangeLifecycleAssessment['sync']): string {
  if (sync.status === 'pending') {
    return `OpenSpec 归档时会把 ${sync.summary.pendingCount} 个能力的 delta 更新到主规格；这里仅展示影响，不是独立门槛。`;
  }
  if (sync.status === 'synced') return 'delta 内容已经反映在主规格中。';
  if (sync.status === 'not-applicable') return '当前 Change 没有需要归档更新的规格 delta。';
  const reason = sync.message ?? '本地规格影响预览无法得出确定结论。';
  return `${reason} 这不影响 OpenSpec CLI 严格验证通过后的归档就绪判断。`;
}

function archiveStatusLabel(readiness: ChangeLifecycleAssessment['archiveReadiness']): string {
  return {
    'not-ready': '尚不可归档',
    ready: '可以归档',
    archived: '已归档',
  }[readiness.status];
}

function gateStatusLabel(status: 'pass' | 'fail' | 'unknown'): string {
  return { pass: '通过', fail: '未通过', unknown: '未知' }[status];
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function resolveDiagnosticArtifact(
  relativePath: string,
  artifacts: Array<Pick<ArtifactProjection, 'relativePath' | 'sourcePath'>>,
): string | null {
  const target = normalizePath(relativePath);
  const artifact = artifacts.find((entry) => {
    const relative = normalizePath(entry.relativePath);
    const source = normalizePath(entry.sourcePath);
    return target === relative || target === source || target === `openspec/${relative}`;
  });
  return artifact?.relativePath ?? null;
}

export function ReadinessPane({
  assessment,
  loading,
  error,
  artifacts,
  focusSection,
  focusNonce,
  onNavigateArtifact,
  validationRunning = false,
  validationError = null,
}: {
  assessment: ChangeLifecycleAssessment | undefined;
  loading: boolean;
  error: unknown;
  artifacts: Array<Pick<ArtifactProjection, 'relativePath' | 'sourcePath'>>;
  focusSection: ReadinessSection | null;
  focusNonce: number;
  onNavigateArtifact: (relativePath: string) => void;
  validationRunning?: boolean;
  validationError?: unknown;
}): React.JSX.Element {
  const validationRef = useRef<HTMLElement>(null);
  const archiveRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!focusSection) return;
    const target = {
      validation: validationRef,
      archive: archiveRef,
    }[focusSection];
    target.current?.focus();
  }, [focusNonce, focusSection]);

  if (loading && !assessment) {
    return (
      <div className="readiness-loading" role="status">
        <LoaderCircle size={18} className="spin" aria-hidden="true" />
        正在汇总生命周期证据
      </div>
    );
  }
  if (!assessment) {
    return (
      <div className="inline-alert alert-warning" role="status">
        <CircleAlert size={16} aria-hidden="true" />
        <span>{readableError(error)}</span>
      </div>
    );
  }

  const validation = assessment.validation;
  const readiness = assessment.archiveReadiness;
  const effectiveValidationStatus: ValidationStatus = validationRunning
    ? 'running'
    : validation.status;

  return (
    <div className="readiness-pane">
      {assessment.archived && (
        <div className="inline-alert alert-neutral" role="status">
          <Archive size={16} aria-hidden="true" />
          <span>此 Change 已归档，生命周期证据为只读记录。</span>
        </div>
      )}

      <section className="readiness-recommendation" aria-labelledby="next-action-heading">
        <span className="eyebrow">唯一建议</span>
        <h2 id="next-action-heading">{assessment.nextAction.title}</h2>
        <p>{assessment.nextAction.description}</p>
        {assessment.blockers.length > 0 && (
          <ul className="blocker-list" aria-label="当前阻塞原因">
            {assessment.blockers.map((blocker) => (
              <li key={`${blocker.code}-${blocker.node}`}>
                <CircleAlert size={14} aria-hidden="true" />
                <span>
                  <strong>{blocker.title}</strong>
                  <small>{blocker.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="readiness-section" aria-labelledby="artifact-graph-heading">
        <header>
          <div>
            <span className="eyebrow">依赖图</span>
            <h2 id="artifact-graph-heading">工件准备度</h2>
          </div>
          <span className="evidence-source">
            {assessment.artifactGraph.authoritative ? '权威' : '降级'} ·{' '}
            {assessment.artifactGraph.source === 'openspec-cli' ? 'OpenSpec CLI' : '本地结构检查'}
          </span>
        </header>
        {assessment.artifactGraph.message && <p>{assessment.artifactGraph.message}</p>}
        <ul className="artifact-graph-list">
          {assessment.artifactGraph.artifacts.map((entry) => (
            <li key={entry.id}>
              <span>
                <strong>{entry.id}</strong>
                <small>
                  {entry.requires.length > 0 ? `依赖 ${entry.requires.join('、')}` : '无前置依赖'}
                </small>
              </span>
              <span className={`evidence-state evidence-${entry.status}`}>
                {artifactStatusLabel(entry.status)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        ref={validationRef}
        className="readiness-section focus-section"
        role="region"
        aria-labelledby="validation-heading"
        tabIndex={-1}
      >
        <header>
          <div>
            <span className="eyebrow">质量门槛</span>
            <h2 id="validation-heading">严格验证</h2>
          </div>
          <span className={`status-badge status-${validationTones[effectiveValidationStatus]}`}>
            {validationBadgeLabels[effectiveValidationStatus]}
          </span>
        </header>
        <div className="evidence-toolbar">
          <span>
            {validation.source === 'openspec-cli' ? 'OpenSpec CLI' : '验证记录'} ·{' '}
            {formatCheckedAt(validation.checkedAt)}
          </span>
        </div>
        <div className="validation-live" role="status" aria-live="polite" aria-atomic="true">
          {validationRunning
            ? '正在调用 OpenSpec 严格验证'
            : (validation.message ?? validation.staleReason ?? validationLabels[validation.status])}
        </div>
        {validationError ? (
          <div className="inline-alert alert-error" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{readableError(validationError)}</span>
          </div>
        ) : null}
        {validation.diagnostics.length > 0 ? (
          <Disclosure
            className="evidence-disclosure"
            regionLabel="严格验证诊断"
            summary={
              <>
                <span className="disclosure-label">验证诊断</span>
                <span className="evidence-state evidence-fail">
                  {validation.diagnostics.length} 条
                </span>
              </>
            }
          >
            <ul className="diagnostic-list">
              {validation.diagnostics.map((diagnostic, index) => {
                const artifactPath = diagnostic.relativePath
                  ? resolveDiagnosticArtifact(diagnostic.relativePath, artifacts)
                  : null;
                const fileName = artifactPath?.split('/').at(-1);
                return (
                  <li key={`${diagnostic.message}-${diagnostic.line ?? index}`}>
                    <CircleAlert size={15} aria-hidden="true" />
                    <span>
                      <strong>{diagnostic.message}</strong>
                      <small>
                        {[diagnostic.capability, diagnostic.requirement]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </span>
                    {artifactPath && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onNavigateArtifact(artifactPath)}
                      >
                        <FileText size={14} aria-hidden="true" />
                        定位到 {fileName}
                        {diagnostic.line ? `:${diagnostic.line}` : ''}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Disclosure>
        ) : (
          <p className="evidence-empty">
            {validation.status === 'passed' ? '没有验证诊断。' : '尚无可显示的验证诊断。'}
          </p>
        )}
      </section>

      <section
        ref={archiveRef}
        className="readiness-section focus-section"
        role="region"
        aria-labelledby="archive-heading"
        tabIndex={-1}
      >
        <header>
          <div>
            <span className="eyebrow">最终判断</span>
            <h2 id="archive-heading">归档门槛</h2>
          </div>
          <span className="evidence-source">
            {archiveStatusLabel(readiness)}
          </span>
        </header>
        <ul className="archive-gate-list">
          {assessment.archiveReadiness.gates.map((gate) => (
            <li key={gate.id}>
              <span>
                {gate.status === 'pass' ? (
                  <Check size={15} aria-hidden="true" />
                ) : (
                  <CircleAlert size={15} aria-hidden="true" />
                )}
                <strong>{gate.label}</strong>
              </span>
              <span className={`evidence-state evidence-${gate.status}`}>
                {gateStatusLabel(gate.status)}
              </span>
            </li>
          ))}
        </ul>
        <div className="archive-impact" aria-labelledby="archive-impact-heading">
          <div className="archive-impact-heading">
            <span className="archive-impact-title">
              <GitCompareArrows size={16} aria-hidden="true" />
              <span>
                <span className="eyebrow">归档说明 · 只读</span>
                <h3 id="archive-impact-heading">规格影响</h3>
              </span>
            </span>
            <span className={`evidence-state evidence-${assessment.sync.status}`}>
              {specImpactStatusLabel(assessment.sync.status)} ·{' '}
              {formatCheckedAt(assessment.sync.checkedAt)}
            </span>
          </div>
          {assessment.sync.status === 'unknown' ? (
            <div className="inline-alert alert-warning" role="status">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{specImpactDescription(assessment.sync)}</span>
            </div>
          ) : (
            <p>{specImpactDescription(assessment.sync)}</p>
          )}
          {assessment.sync.capabilities.length > 0 ? (
            <div className="sync-capability-list">
              {assessment.sync.capabilities.map((capability) => (
                <Disclosure
                  key={capability.capabilityPath}
                  className="sync-capability"
                  regionLabel={`${capability.capabilityPath} 规格影响详情`}
                  summary={
                    <>
                      <span>
                        <strong>{capability.capabilityPath}</strong>
                        <small>
                          {capability.sourcePath} → {capability.targetPath}
                        </small>
                      </span>
                      <span className={`evidence-state evidence-${capability.status}`}>
                        {capability.status === 'pending'
                          ? '归档时更新'
                          : capability.status === 'synced'
                            ? '已反映'
                            : '预览不可用'}
                      </span>
                    </>
                  }
                >
                  <div className="sync-capability-body">
                    <dl className="operation-counts">
                      <div>
                        <dt>新增</dt>
                        <dd>{capability.operationCounts.added}</dd>
                      </div>
                      <div>
                        <dt>修改</dt>
                        <dd>{capability.operationCounts.modified}</dd>
                      </div>
                      <div>
                        <dt>移除</dt>
                        <dd>{capability.operationCounts.removed}</dd>
                      </div>
                      <div>
                        <dt>重命名</dt>
                        <dd>{capability.operationCounts.renamed}</dd>
                      </div>
                    </dl>
                    <div className="sync-summary-grid">
                      <div>
                        <h3>Requirements</h3>
                        {capability.requirements.length > 0 ? (
                          <ul>
                            {capability.requirements.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>无 Requirement 变化</p>
                        )}
                      </div>
                      <div>
                        <h3>Scenarios</h3>
                        {capability.scenarios.length > 0 ? (
                          <ul>
                            {capability.scenarios.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>无 Scenario 变化</p>
                        )}
                      </div>
                    </div>
                    {capability.conflicts.length > 0 && (
                      <div className="sync-conflicts">
                        <h3>解析提示</h3>
                        <ul>
                          {capability.conflicts.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Disclosure>
              ))}
            </div>
          ) : (
            <p className="evidence-empty">
              {assessment.sync.status === 'not-applicable'
                ? '当前 Change 没有规格 delta，归档无需更新主规格。'
                : '尚无可展开的 capability 影响证据。'}
            </p>
          )}
        </div>
        <p className="evidence-footnote">
          评估于 {formatCheckedAt(assessment.evaluatedAt)}，证据来源会随项目文件变化自动失效。
        </p>
      </section>
    </div>
  );
}
