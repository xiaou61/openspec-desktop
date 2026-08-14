import { createHash } from 'node:crypto';
import {
  archiveIntegrityEventSchema,
  archiveIntegrityStateSchema,
  sha256FingerprintSchema,
  type ArchiveIntegrityEvent,
  type ArchiveIntegrityState,
  type ChangeProjection,
} from '@shared/contracts';

export interface ArchiveIntegrityObservation {
  fingerprint: string;
  observedAt: string;
}

export interface ArchiveIntegrityTransition {
  state: ArchiveIntegrityState;
  changed?: ArchiveIntegrityEvent;
}

function hash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

export function createArchiveContentFingerprint(change: ChangeProjection): string {
  const entries = change.artifacts
    .map(
      (artifact) =>
        `${artifact.relativePath.replaceAll('\\', '/')}:${artifact.contentHash ?? `${artifact.parseHealth}:${artifact.size ?? 0}`}`,
    )
    .sort((left, right) => left.localeCompare(right, 'en'));
  return hash([`archive:${change.id}`, ...entries]);
}

export function transitionArchiveIntegrity(
  previous: ArchiveIntegrityState | undefined,
  observation: ArchiveIntegrityObservation,
): ArchiveIntegrityTransition {
  const fingerprint = sha256FingerprintSchema.parse(observation.fingerprint);
  const observedAt = new Date(observation.observedAt).toISOString();
  if (!previous) {
    return {
      state: archiveIntegrityStateSchema.parse({
        status: 'baseline',
        baselineFingerprint: fingerprint,
        currentFingerprint: fingerprint,
        observedAt,
        incident: 0,
      }),
    };
  }
  const current = archiveIntegrityStateSchema.parse(previous);
  if (current.currentFingerprint === fingerprint) return { state: current };
  if (current.baselineFingerprint === fingerprint) {
    return {
      state: archiveIntegrityStateSchema.parse({
        ...current,
        status: 'restored',
        currentFingerprint: fingerprint,
        observedAt,
        restoredAt: observedAt,
      }),
    };
  }
  if (current.status === 'changed') {
    return {
      state: archiveIntegrityStateSchema.parse({
        ...current,
        currentFingerprint: fingerprint,
        observedAt,
      }),
    };
  }
  const incident = current.incident + 1;
  const eventKey = hash([current.baselineFingerprint, fingerprint, `${incident}`]);
  const changed = archiveIntegrityEventSchema.parse({
    eventKey,
    incident,
    detectedAt: observedAt,
    baselineFingerprint: current.baselineFingerprint,
    currentFingerprint: fingerprint,
  });
  return {
    state: archiveIntegrityStateSchema.parse({
      ...current,
      status: 'changed',
      currentFingerprint: fingerprint,
      observedAt,
      incident,
      changedAt: observedAt,
      lastEventKey: eventKey,
      restoredAt: undefined,
    }),
    changed,
  };
}
