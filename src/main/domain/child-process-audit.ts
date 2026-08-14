import { appendFileSync } from 'node:fs';

export const CHILD_PROCESS_AUDIT_ENV = 'OPENSPEC_DESKTOP_CHILD_PROCESS_AUDIT_LOG';

export function auditChildProcessInvocation(command: string, args: string[], cwd: string): void {
  const logPath = process.env[CHILD_PROCESS_AUDIT_ENV];
  if (!logPath) return;
  try {
    appendFileSync(logPath, `${JSON.stringify({ command, args, cwd })}\n`, {
      encoding: 'utf8',
      flag: 'a',
    });
  } catch {
    // Diagnostic auditing must never change process execution behavior.
  }
}
