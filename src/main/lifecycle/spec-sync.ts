import { createHash } from 'node:crypto';
import { unified } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { toString } from 'mdast-util-to-string';
import type { Heading, Root, RootContent } from 'mdast';
import {
  safeRelativePathSchema,
  specSyncAssessmentSchema,
  type ChangeProjection,
  type SpecOperationCounts,
  type SpecOperationType,
  type SpecDeltaOperationEvidence,
  type SpecDeltaParseIssue,
  type SpecSyncAssessment,
  type SpecSyncCapability,
} from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import { mainSpecPathForDelta } from './fingerprint';

export interface ParsedRequirement {
  name: string;
  scenarios: string[];
  normalizedBlock: string;
  line: number;
}

export interface ParsedDeltaOperation extends ParsedRequirement {
  type: SpecOperationType;
  requirement: string;
  targetKey: string;
  contentFingerprint: string;
  from?: string;
  to?: string;
}

export interface ParsedDeltaSpec {
  purpose: string;
  operations: ParsedDeltaOperation[];
}

export type DeltaSpecParseResult =
  { ok: true; value: ParsedDeltaSpec } | { ok: false; error: string; issue: SpecDeltaParseIssue };

export interface ParsedMainSpec {
  purpose: string;
  requirements: Map<string, ParsedRequirement>;
}

function parseTree(rawContent: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(rawContent) as Root;
}

function headingInfo(node: RootContent): { depth: number; text: string; line: number } | null {
  if (node.type !== 'heading') return null;
  const heading = node as Heading;
  return {
    depth: heading.depth,
    text: toString(heading).trim(),
    line: heading.position?.start.line ?? 1,
  };
}

function offset(node: RootContent, side: 'start' | 'end'): number | null {
  const value = node.position?.[side].offset;
  return typeof value === 'number' ? value : null;
}

function blockEnd(
  children: RootContent[],
  startIndex: number,
  maxDepth: number,
  rawLength: number,
): number {
  for (let index = startIndex + 1; index < children.length; index += 1) {
    const heading = headingInfo(children[index]!);
    if (!heading || heading.depth > maxDepth) continue;
    return offset(children[index]!, 'start') ?? rawLength;
  }
  return rawLength;
}

export function normalizeMarkdownBlock(raw: string): string {
  const normalized = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  return normalized
    .split('\n')
    .map((line) => {
      const trimmedEnd = line.trimEnd();
      const heading = /^(#{1,6})\s*(.*?)\s*#*\s*$/.exec(trimmedEnd);
      return heading ? `${heading[1]} ${heading[2]?.trim() ?? ''}` : trimmedEnd;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizedSourcePath(sourcePath: string): string {
  const normalized = sourcePath.replaceAll('\\', '/').replace(/^\.\//, '');
  return normalized.startsWith('openspec/') ? normalized : `openspec/${normalized}`;
}

function safeSourcePath(sourcePath: string): string {
  const normalized = normalizedSourcePath(sourcePath);
  return safeRelativePathSchema.safeParse(normalized).success
    ? normalized
    : 'openspec/invalid-spec.md';
}

function capabilityFromSourcePath(sourcePath: string): string | null {
  const normalized = normalizedSourcePath(sourcePath);
  const match = /(?:^|\/)specs\/(.+)\/spec\.md$/i.exec(normalized);
  const capability = match?.[1];
  return capability && safeRelativePathSchema.safeParse(capability).success ? capability : null;
}

export function operationTargetKey(
  capabilityPath: string,
  type: SpecOperationType,
  name: string,
  from?: string,
  to?: string,
): string {
  const identity =
    type === 'RENAMED'
      ? [capabilityPath, type, from ?? '', to ?? '']
      : [capabilityPath, type, name];
  return `sdo1:${hash(identity.join('\n'))}`;
}

function parseFailure(
  sourcePath: string,
  code: SpecDeltaParseIssue['code'],
  message: string,
  line?: number,
  requirementName?: string,
): DeltaSpecParseResult {
  const safeSource = safeSourcePath(sourcePath);
  const issue: SpecDeltaParseIssue = {
    code,
    message,
    sourcePath: safeSource,
    ...(line ? { line } : {}),
    ...(requirementName ? { requirementName } : {}),
  };
  return { ok: false, error: message, issue };
}

function sectionBody(
  raw: string,
  children: RootContent[],
  headingIndex: number,
  depth: number,
): string {
  const start = offset(children[headingIndex]!, 'end') ?? 0;
  return normalizeMarkdownBlock(
    raw.slice(start, blockEnd(children, headingIndex, depth, raw.length)),
  );
}

function scenariosIn(children: RootContent[], startIndex: number, endOffset: number): string[] {
  const scenarios: string[] = [];
  for (let index = startIndex + 1; index < children.length; index += 1) {
    const child = children[index]!;
    const childOffset = offset(child, 'start') ?? Number.MAX_SAFE_INTEGER;
    if (childOffset >= endOffset) break;
    const heading = headingInfo(child);
    if (!heading || heading.depth !== 4) continue;
    const match = /^Scenario:\s*(.+)$/i.exec(heading.text);
    if (match?.[1]?.trim()) scenarios.push(match[1].trim());
  }
  return scenarios;
}

function requirementAt(
  raw: string,
  children: RootContent[],
  index: number,
): ParsedRequirement | null {
  const heading = headingInfo(children[index]!);
  if (!heading || heading.depth !== 3) return null;
  const match = /^Requirement:\s*(.+)$/i.exec(heading.text);
  if (!match?.[1]?.trim()) return null;
  const start = offset(children[index]!, 'start') ?? 0;
  const end = blockEnd(children, index, 3, raw.length);
  return {
    name: match[1].trim(),
    scenarios: scenariosIn(children, index, end),
    normalizedBlock: normalizeMarkdownBlock(raw.slice(start, end)),
    line: heading.line,
  };
}

function purposeOf(raw: string, children: RootContent[]): string {
  const index = children.findIndex((child) => {
    const heading = headingInfo(child);
    return heading?.depth === 2 && heading.text.toLowerCase() === 'purpose';
  });
  return index >= 0 ? sectionBody(raw, children, index, 2) : '';
}

export function parseDeltaSpec(rawContent: string, sourcePath: string): DeltaSpecParseResult {
  try {
    const capabilityPath = capabilityFromSourcePath(sourcePath);
    if (!capabilityPath) {
      return parseFailure(sourcePath, 'invalid-target-path', 'delta spec 目标路径无效');
    }
    const tree = parseTree(rawContent);
    const operations: ParsedDeltaOperation[] = [];
    const identities = new Set<string>();
    let operationType: SpecOperationType | null = null;
    let renameFrom: { name: string; line: number; start: number } | null = null;
    for (let index = 0; index < tree.children.length; index += 1) {
      const child = tree.children[index]!;
      const heading = headingInfo(child);
      if (!heading) continue;
      if (heading.depth === 2) {
        if (renameFrom) {
          return parseFailure(
            sourcePath,
            'ambiguous-rename',
            'RENAMED 操作无法唯一映射 FROM/TO',
            renameFrom.line,
            renameFrom.name,
          );
        }
        const match = /^(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements$/i.exec(heading.text);
        operationType = (match?.[1]?.toUpperCase() as SpecOperationType | undefined) ?? null;
        renameFrom = null;
        continue;
      }
      if (heading.depth !== 3) continue;
      if (!operationType) {
        const orphan = /^Requirement:\s*(.+)$/i.exec(heading.text)?.[1]?.trim();
        if (orphan) {
          return parseFailure(
            sourcePath,
            'missing-operation-boundary',
            'Requirement 标题缺少 operation 边界',
            heading.line,
            orphan,
          );
        }
        continue;
      }
      if (operationType === 'RENAMED') {
        const from = /^FROM:\s*(.+)$/i.exec(heading.text)?.[1]?.trim();
        const to = /^TO:\s*(.+)$/i.exec(heading.text)?.[1]?.trim();
        if (from) {
          if (renameFrom) {
            return parseFailure(
              sourcePath,
              'ambiguous-rename',
              'RENAMED 操作无法唯一映射 FROM/TO',
              heading.line,
              from,
            );
          }
          renameFrom = {
            name: from,
            line: heading.line,
            start: offset(tree.children[index]!, 'start') ?? 0,
          };
        }
        if (to && !renameFrom) {
          return parseFailure(
            sourcePath,
            'ambiguous-rename',
            'RENAMED 操作无法唯一映射 FROM/TO',
            heading.line,
            to,
          );
        }
        if (to && renameFrom) {
          const normalizedBlock = normalizeMarkdownBlock(
            rawContent.slice(
              renameFrom.start,
              blockEnd(tree.children, index, 3, rawContent.length),
            ),
          );
          const targetKey = operationTargetKey(capabilityPath, 'RENAMED', to, renameFrom.name, to);
          if (identities.has(targetKey)) {
            return parseFailure(
              sourcePath,
              'ambiguous-rename',
              'RENAMED 操作无法唯一映射 FROM/TO',
              renameFrom.line,
              `${renameFrom.name} -> ${to}`,
            );
          }
          identities.add(targetKey);
          operations.push({
            type: 'RENAMED',
            requirement: `${renameFrom.name} -> ${to}`,
            from: renameFrom.name,
            to,
            name: to,
            scenarios: [],
            normalizedBlock,
            line: renameFrom.line,
            targetKey,
            contentFingerprint: hash(normalizedBlock),
          });
          renameFrom = null;
        }
        continue;
      }
      const requirement = requirementAt(rawContent, tree.children, index);
      if (!requirement) continue;
      const targetKey = operationTargetKey(capabilityPath, operationType, requirement.name);
      if (identities.has(targetKey)) {
        return parseFailure(
          sourcePath,
          'duplicate-requirement',
          `Requirement “${requirement.name}” 在 ${operationType} 中重复`,
          requirement.line,
          requirement.name,
        );
      }
      identities.add(targetKey);
      operations.push({
        ...requirement,
        type: operationType,
        requirement: requirement.name,
        targetKey,
        contentFingerprint: hash(requirement.normalizedBlock),
      });
    }
    if (renameFrom)
      return parseFailure(
        sourcePath,
        'ambiguous-rename',
        'RENAMED 操作缺少 TO 标题',
        renameFrom.line,
        renameFrom.name,
      );
    if (operations.length === 0)
      return parseFailure(sourcePath, 'malformed-delta', 'delta spec 未包含有效操作', 1);
    return { ok: true, value: { purpose: purposeOf(rawContent, tree.children), operations } };
  } catch (error) {
    return parseFailure(
      sourcePath,
      'malformed-delta',
      error instanceof Error ? error.message : 'delta spec 解析失败',
    );
  }
}

export function parseMainSpec(rawContent: string): ParsedMainSpec {
  const tree = parseTree(rawContent);
  const requirements = new Map<string, ParsedRequirement>();
  for (let index = 0; index < tree.children.length; index += 1) {
    const requirement = requirementAt(rawContent, tree.children, index);
    if (!requirement) continue;
    if (requirements.has(requirement.name))
      throw new Error(`Requirement ${requirement.name} 不唯一`);
    requirements.set(requirement.name, requirement);
  }
  return { purpose: purposeOf(rawContent, tree.children), requirements };
}

function capabilityPath(
  relativePath: string,
  changeId: string,
  archived: boolean,
): { capabilityPath: string; targetPath: string } | null {
  const targetPath = mainSpecPathForDelta(relativePath, changeId, archived);
  if (!targetPath || !safeRelativePathSchema.safeParse(targetPath).success) return null;
  const capability = targetPath.replace(/^specs\//, '').replace(/\/spec\.md$/i, '');
  if (!capability || !safeRelativePathSchema.safeParse(capability).success) return null;
  return { capabilityPath: capability, targetPath };
}

function emptyCounts(): SpecOperationCounts {
  return { added: 0, modified: 0, removed: 0, renamed: 0 };
}

function invalidCapability(
  artifact: ChangeProjection['artifacts'][number],
  message: string,
  issue?: SpecDeltaParseIssue,
): SpecSyncCapability {
  const paths = capabilityPath(
    artifact.relativePath,
    artifact.changeId ?? 'unknown',
    artifact.archived,
  );
  return {
    capabilityPath: paths?.capabilityPath ?? 'invalid-spec',
    status: 'unknown',
    sourcePath: safeSourcePath(artifact.sourcePath),
    targetPath: paths?.targetPath ?? 'specs/invalid-spec/spec.md',
    operationCounts: emptyCounts(),
    requirements: [],
    scenarios: [],
    operations: [],
    parseIssues: [
      issue ?? {
        code: paths ? 'malformed-delta' : 'invalid-target-path',
        message: message.slice(0, 1000),
        sourcePath: safeSourcePath(artifact.sourcePath),
      },
    ],
    conflicts: [message.slice(0, 1000)],
  };
}

function operationEvidence(
  operation: ParsedDeltaOperation,
  artifact: ChangeProjection['artifacts'][number],
  paths: { capabilityPath: string; targetPath: string },
): SpecDeltaOperationEvidence {
  return {
    capabilityPath: paths.capabilityPath,
    sourcePath: artifact.sourcePath,
    targetPath: `openspec/${paths.targetPath}`,
    operationType: operation.type,
    requirementName: operation.requirement,
    ...(operation.from ? { renameFrom: operation.from } : {}),
    ...(operation.to ? { renameTo: operation.to } : {}),
    scenarios: operation.scenarios,
    line: operation.line,
    targetKey: operation.targetKey,
    contentFingerprint: operation.contentFingerprint,
    normalizedBlock: operation.normalizedBlock,
  };
}

function compareCapability(
  artifact: ChangeProjection['artifacts'][number],
  mainArtifact: ProjectScanResult['specs'][number] | undefined,
  change: ChangeProjection,
): SpecSyncCapability {
  const paths = capabilityPath(artifact.relativePath, change.id, change.archived);
  if (!paths || !artifact.rawContent)
    return invalidCapability(artifact, 'delta spec 路径或内容无效');
  const delta = parseDeltaSpec(artifact.rawContent, artifact.sourcePath);
  if (!delta.ok) return invalidCapability(artifact, delta.error, delta.issue);
  let main: ParsedMainSpec = { purpose: '', requirements: new Map() };
  if (mainArtifact) {
    if (mainArtifact.parseHealth !== 'ok' || !mainArtifact.rawContent)
      return invalidCapability(artifact, '目标主规格不可读');
    try {
      main = parseMainSpec(mainArtifact.rawContent);
    } catch (error) {
      return invalidCapability(
        artifact,
        error instanceof Error ? error.message : '目标主规格解析失败',
      );
    }
  }

  const counts = emptyCounts();
  const requirements: string[] = [];
  const scenarios: string[] = [];
  const conflicts: string[] = [];
  let pending = false;
  let unknown = false;
  for (const operation of delta.value.operations) {
    counts[operation.type.toLowerCase() as keyof SpecOperationCounts] += 1;
    requirements.push(operation.requirement);
    scenarios.push(...operation.scenarios);
    if (operation.type === 'ADDED') {
      const target = main.requirements.get(operation.name);
      if (!target) pending = true;
      else if (target.normalizedBlock !== operation.normalizedBlock) {
        unknown = true;
        conflicts.push(`ADDED Requirement “${operation.name}” 已存在但内容不同`);
      }
      continue;
    }
    if (operation.type === 'MODIFIED') {
      const target = main.requirements.get(operation.name);
      if (operation.scenarios.length === 0) {
        unknown = true;
        conflicts.push(`MODIFIED Requirement “${operation.name}” 不是完整块`);
      } else if (!target) {
        unknown = true;
        conflicts.push(`MODIFIED Requirement “${operation.name}” 在主规格中不存在`);
      } else if (target.normalizedBlock !== operation.normalizedBlock) pending = true;
      continue;
    }
    if (operation.type === 'REMOVED') {
      if (main.requirements.has(operation.name)) pending = true;
      continue;
    }
    const hasFrom = Boolean(operation.from && main.requirements.has(operation.from));
    const hasTo = Boolean(operation.to && main.requirements.has(operation.to));
    if (hasFrom && !hasTo) pending = true;
    else if (hasFrom === hasTo) {
      unknown = true;
      conflicts.push(`RENAMED “${operation.from}” / “${operation.to}” 的目标组合冲突`);
    }
  }
  if (mainArtifact && delta.value.purpose && !main.purpose) {
    unknown = true;
    conflicts.push('目标主规格缺少 Purpose');
  }
  return {
    capabilityPath: paths.capabilityPath,
    status: unknown ? 'unknown' : pending ? 'pending' : 'synced',
    sourcePath: artifact.sourcePath,
    targetPath: `openspec/${paths.targetPath}`,
    operationCounts: counts,
    requirements,
    scenarios,
    operations: delta.value.operations.map((operation) =>
      operationEvidence(operation, artifact, paths),
    ),
    parseIssues: [],
    conflicts,
  };
}

export interface AssessSpecSyncInput {
  scan: ProjectScanResult;
  change: ChangeProjection;
  checkedAt: string;
  skipSpecs: boolean;
  maxFileBytes?: number;
}

export function assessSpecSync(input: AssessSpecSyncInput): SpecSyncAssessment {
  const maxFileBytes = input.maxFileBytes ?? 2 * 1024 * 1024;
  const deltas = input.change.artifacts.filter((artifact) => artifact.type === 'spec');
  if (deltas.length === 0) {
    return specSyncAssessmentSchema.parse({
      status: input.skipSpecs ? 'not-applicable' : 'unknown',
      source: 'local-comparison',
      checkedAt: input.checkedAt,
      capabilities: [],
      summary: {
        capabilityCount: 0,
        pendingCount: 0,
        syncedCount: 0,
        unknownCount: input.skipSpecs ? 0 : 1,
      },
      message: input.skipSpecs
        ? 'Change 明确声明 skip_specs'
        : '未发现 delta specs，且未声明 skip_specs',
    });
  }
  const mainByPath = new Map(
    input.scan.specs.map((artifact) => [artifact.relativePath.replaceAll('\\', '/'), artifact]),
  );
  const capabilities = deltas.map((artifact) => {
    if (artifact.parseHealth !== 'ok')
      return invalidCapability(artifact, artifact.error ?? 'delta spec 不可读');
    if ((artifact.size ?? Buffer.byteLength(artifact.rawContent ?? '')) > maxFileBytes)
      return invalidCapability(artifact, 'delta spec 超过规格影响预览大小上限');
    const paths = capabilityPath(artifact.relativePath, input.change.id, input.change.archived);
    return compareCapability(
      artifact,
      paths ? mainByPath.get(paths.targetPath) : undefined,
      input.change,
    );
  });
  const pendingCount = capabilities.filter((capability) => capability.status === 'pending').length;
  const syncedCount = capabilities.filter((capability) => capability.status === 'synced').length;
  const unknownCount = capabilities.filter((capability) => capability.status === 'unknown').length;
  const status = unknownCount > 0 ? 'unknown' : pendingCount > 0 ? 'pending' : 'synced';
  return specSyncAssessmentSchema.parse({
    status,
    source: 'local-comparison',
    checkedAt: input.checkedAt,
    capabilities,
    summary: {
      capabilityCount: capabilities.length,
      pendingCount,
      syncedCount,
      unknownCount,
    },
    ...(status === 'unknown' ? { message: '部分 delta spec 无法安全比较' } : {}),
  });
}
