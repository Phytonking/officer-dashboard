/**
 * Archive / restore / delete for projects and builders (docs/launchpad-cohorts.md, "Lifecycle
 * rules"). Archive and restore are officer actions; delete is director-only and only for
 * records nothing refers to, so history is never lost by accident. The server re-checks all of it.
 */
import type { BuildspaceData, BuildspacePerson, BuildspaceProject } from "../../../lib/contracts";
import { api } from "../../../lib/api/client";
import { errorMessage } from "../../components/states";

export interface LifecycleAction {
  label: string;
  data: string;
  danger?: boolean;
  disabled?: boolean;
  /** Why the action is unavailable (shown as a tooltip and in the confirm text). */
  reason?: string;
  run: () => void;
}

export function lifecycleActions(
  target: { kind: "project"; record: BuildspaceProject } | { kind: "person"; record: BuildspacePerson },
  b: BuildspaceData,
  opts: { canDirector: boolean; readOnly: boolean; done: (message: string, closed?: boolean) => void; fail: (message: string) => void },
): LifecycleAction[] {
  if (opts.readOnly) return [];
  const { kind, record } = target;
  const id = record.id;
  const archived = record.archivedAt !== null;
  const run = async (fn: () => Promise<unknown>, message: string, closed = false) => {
    try {
      await fn();
      opts.done(message, closed);
    } catch (e) {
      opts.fail(errorMessage(e));
    }
  };
  const out: LifecycleAction[] = [];
  if (kind === "project") {
    const builders = b.people.filter((p) => p.projectId === id).length;
    const history = b.activity.some((a) => a.projectId === id);
    out.push(
      archived
        ? { label: "Restore project", data: "restore", run: () => void run(() => api("launchpadProjectRestore", { params: { id } }), `${record.name} restored with its builders.`) }
        : {
            label: "Archive project",
            data: "archive",
            run: () => {
              if (!confirm(`Archive ${record.name}? Its ${builders === 1 ? "builder is" : `${builders} builders are`} archived too and lose portal access. Mentors stop seeing it. You can restore it later.`)) return;
              void run(() => api("launchpadProjectArchive", { params: { id } }), `${record.name} archived.`);
            },
          },
    );
    if (opts.canDirector) {
      const reason = builders ? "Has builders: archive it, or delete its builders first." : history ? "Has activity history: archive it instead." : undefined;
      out.push({
        label: "Delete project",
        data: "delete",
        danger: true,
        disabled: !!reason,
        reason,
        run: () => {
          if (!confirm(`Delete ${record.name}? This can’t be undone.`)) return;
          void run(() => api("launchpadProjectDelete", { params: { id } }), `${record.name} deleted.`, true);
        },
      });
    }
  } else {
    const history = b.activity.some((a) => a.personId === id);
    out.push(
      archived
        ? { label: "Restore builder", data: "restore", run: () => void run(() => api("launchpadPersonRestore", { params: { id } }), `${record.name} restored.`) }
        : {
            label: "Archive builder",
            data: "archive",
            run: () => {
              if (!confirm(`Archive ${record.name}? They drop out of weekly follow-ups and lose portal access. Their history stays, and you can restore them.`)) return;
              void run(() => api("launchpadPersonArchive", { params: { id } }), `${record.name} archived.`);
            },
          },
    );
    if (opts.canDirector) {
      const reason = history ? "Has activity history: archive instead." : undefined;
      out.push({
        label: "Delete builder",
        data: "delete",
        danger: true,
        disabled: !!reason,
        reason,
        run: () => {
          if (!confirm(`Delete ${record.name}? Their portal account is removed too. This can’t be undone.`)) return;
          void run(() => api("launchpadPersonDelete", { params: { id } }), `${record.name} deleted.`, true);
        },
      });
    }
  }
  return out;
}
