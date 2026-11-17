/** Pieces shared by the builder and mentor portals. */
import type { ComponentChildren } from "preact";
import type { BuildspaceSchedule, PortalActivity, PortalMe } from "../../lib/contracts";
import type { Hue } from "../../lib/colors";
import { api } from "../../lib/api/client";
import { fmtDate, fmtShort } from "../../lib/format";
import { Badge } from "../components/kit";
import { PeopleChip } from "../components/PeopleTable";
import { Empty } from "../components/states";
import { kindLabel, trackShort, VISIBILITY_LABEL } from "../views/buildspace/model";
import { TRACK_HUE } from "../views/buildspace/Cards";

export type WeekStatus = "done" | "awaiting" | "past-due" | "not-joined";

export const WEEK: Record<WeekStatus, { label: (s: BuildspaceSchedule) => string; hue: Hue }> = {
  done: { label: () => "Checked in this week", hue: "green" },
  awaiting: { label: (s) => `Check-in due ${fmtShort(s.week.due)}`, hue: "amber" },
  "past-due": { label: (s) => `Past due · ${fmtShort(s.week.due)}`, hue: "coral" },
  "not-joined": { label: () => "Starts soon", hue: "blue" },
};

export function WeekChip({ status, schedule }: { status: WeekStatus; schedule: BuildspaceSchedule }) {
  return (
    <span data-week={status}>
      <PeopleChip hue={WEEK[status].hue}>{WEEK[status].label(schedule)}</PeopleChip>
    </span>
  );
}

export function TrackChip({ track }: { track: keyof typeof TRACK_HUE }) {
  return <PeopleChip hue={TRACK_HUE[track]}>{trackShort(track)}</PeopleChip>;
}

export function PortalHeader({ me }: { me: PortalMe }) {
  return (
    <header class="portal-head">
      <a class="portal-brand" href="/launchpad" aria-label="CSEED Launchpad home">
        <img class="wordmark-logo wordmark-logo--ink" src="/images/cseed-wordmark.png" alt="" width="78" height="18" />
        <img class="wordmark-logo wordmark-logo--white" src="/images/cseed-wordmark-white.png" alt="" width="78" height="18" />
        <span class="portal-brand-sub">Launchpad</span>
      </a>
      <div class="portal-head-actions">
        {me.cohort && <span class="portal-cohort muted small">{me.cohort.name}</span>}
        {me.officer && (
          <a class="btn btn--small btn--text" href="/" data-officer-link>
            Officer dashboard
          </a>
        )}
        <span class="portal-who">
          <strong>{me.account.name || me.account.email}</strong>
          <span class="muted small">{me.account.kind === "mentor" ? "Mentor" : "Builder"}</span>
        </span>
        <button
          type="button"
          class="btn btn--small"
          data-portal-signout
          onClick={async () => {
            try {
              await api("portalLogout");
            } catch {
              /* already signed out */
            }
            location.replace("/launchpad/login");
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

const STATUS_TONE = { "on-track": "positive", "needs-help": "attention", open: "attention", resolved: "neutral" } as const;
const STATUS_LABEL = { "on-track": "On track", "needs-help": "Needs help", open: "Open", resolved: "Resolved" } as const;

/** The project timeline as a portal reader sees it. `names` resolves builder ids. */
export function PortalTimeline({
  items,
  names,
  showVisibility = false,
  empty = "Nothing here yet.",
}: {
  items: PortalActivity[];
  names: Record<string, string>;
  showVisibility?: boolean;
  empty?: string;
}) {
  if (!items.length) return <Empty title="No updates yet">{empty}</Empty>;
  return (
    <ol class="bs-timeline motion-list" data-portal-timeline>
      {items.map((a) => (
        <li key={a.id} data-kind={a.kind}>
          <div class="bs-timeline-head">
            <span>{kindLabel[a.kind]}</span>
            <time dateTime={a.date}>{fmtDate(a.date)}</time>
          </div>
          <p>{a.body}</p>
          <div class="bs-activity-meta">
            <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
            <span>
              {a.authorName ?? (a.personId ? names[a.personId] ?? "A builder" : "Whole project")}
              {a.personId && a.authorName && names[a.personId] && a.authorName !== names[a.personId] ? ` · about ${names[a.personId]}` : ""}
            </span>
            {showVisibility && (
              <span class="lp-visibility" data-visibility={a.visibility}>
                {VISIBILITY_LABEL[a.visibility]}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Card({ title, actions, children, id, data }: { title: ComponentChildren; actions?: ComponentChildren; children: ComponentChildren; id: string; data?: string }) {
  return (
    <section class="block portal-block" aria-labelledby={id} data-card={data}>
      <div class="block-head portal-block-head">
        <h2 id={id}>{title}</h2>
        {actions && <div class="action-row">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
