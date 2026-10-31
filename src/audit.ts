import { randomBytes } from "crypto";
import { findAgentHome } from "./config";
import { appendAuditEvent, loadAuditEvents } from "./database";
import { AuditEvent } from "./types";

export function createRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function appendAudit(event: AuditEvent, home = findAgentHome()): void {
  appendAuditEvent(home, event);
}

export function readAudit(limit: number, home = findAgentHome()): AuditEvent[] {
  return loadAuditEvents(home, limit);
}

export function audit(
  runId: string,
  event: AuditEvent["event"],
  action: string,
  details: Record<string, unknown>,
  home = findAgentHome(),
): void {
  appendAudit(
    {
      runId,
      event,
      action,
      timestamp: new Date().toISOString(),
      details,
    },
    home,
  );
}
