export const STAGES = [
  { id: "idea", label: "Idea" },
  { id: "researched", label: "Researched" },
  { id: "scripted", label: "Scripted" },
  { id: "voiced", label: "Voiced" },
  { id: "edited", label: "Edited" },
  { id: "awaiting-approval", label: "Awaiting approval" },
  { id: "approved", label: "Approved" },
  { id: "scheduled", label: "Scheduled" },
  { id: "published", label: "Published" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];
export const stageLabel = (id: string) => STAGES.find((s) => s.id === id)?.label ?? id;

export interface EpisodeRow {
  id: string;
  show: string;
  title: string;
  status: StageId;
  updated_at: string;
}

export interface JobRow {
  id: string;
  episode_id: string;
  kind: "episode" | "preview" | "prepare" | "short";
  options?: { shortId?: string; frames?: [number, number] } | null;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  stage: string | null;
  progress: number;
  outputs: { master?: { key: string }; proxy?: { key: string }; report?: { key: string }; dropbox?: string[]; loudness?: { integrated?: string; truePeak?: string }; renderSeconds?: number } | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface EventRow {
  id: number;
  episode_id: string;
  kind: "approved" | "changes_requested" | "status" | "note";
  body: string | null;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
}

export const JOB_KIND_LABEL: Record<JobRow["kind"], string> = {
  episode: "Full render",
  preview: "Quick test",
  prepare: "Preview refresh",
  short: "Short",
};

export const showLabel = (slug: string) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
