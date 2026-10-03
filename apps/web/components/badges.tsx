import type { EventRow, JobRow } from "@/lib/stages";
import { JOB_KIND_LABEL } from "@/lib/stages";

export function DecisionBadge({ event }: { event?: EventRow }) {
  if (!event) return null;
  if (event.kind === "approved")
    return <span className="rounded bg-ok/15 px-1.5 py-0.5 text-xs font-medium text-ok">Approved</span>;
  if (event.kind === "changes_requested")
    return <span className="rounded bg-amber/15 px-1.5 py-0.5 text-xs font-medium text-amber">Changes requested</span>;
  return null;
}

const JOB_STYLE: Record<JobRow["status"], string> = {
  queued: "text-muted",
  running: "text-teal",
  succeeded: "text-ok",
  failed: "text-danger",
  cancelled: "text-muted",
};

export function JobStatus({ job }: { job: Pick<JobRow, "kind" | "status" | "progress"> }) {
  const label =
    job.status === "running" ? `${Math.round(job.progress * 100)}%` : job.status === "succeeded" ? "done" : job.status;
  return (
    <span className={`text-xs ${JOB_STYLE[job.status]}`}>
      {JOB_KIND_LABEL[job.kind]}: {label}
    </span>
  );
}
