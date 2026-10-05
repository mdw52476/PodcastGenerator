import type { Pitch } from "@/lib/stages";

/** Plain text with bare URLs and [label](url) links made clickable. */
function Linked({ text }: { text: string }) {
  const parts: Array<string | { label: string; url: string }> = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(m[1] ? { label: m[1], url: m[2] } : { label: m[3], url: m[3] });
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          p
        ) : (
          <a key={i} href={p.url} target="_blank" rel="noreferrer noopener" className="break-all text-amber hover:underline">
            {p.label}
          </a>
        ),
      )}
    </>
  );
}

export function PitchCard({ pitch }: { pitch: Pitch }) {
  return (
    <section className="rounded-lg border border-teal/40 bg-panel p-4">
      <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Pitch</h2>
      <p className="mt-2 leading-relaxed">{pitch.logline}</p>
      {pitch.whyNow && (
        <p className="mt-2 text-sm text-muted">
          <b className="text-text">Why now:</b> {pitch.whyNow}
        </p>
      )}
      {pitch.angle && (
        <p className="mt-1 text-sm text-muted">
          <b className="text-text">Angle:</b> {pitch.angle}
        </p>
      )}
      {pitch.sources?.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {pitch.sources.map((s, i) => (
            <li key={i}>
              <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-amber hover:underline">
                {s.title || s.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The writer's fact sheet (markdown-ish): headings, bullets and links, kept readable without a parser. */
export function FactSheet({ text }: { text: string }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Fact sheet</h2>
      <div className="mt-2 space-y-1.5 text-sm leading-relaxed">
        {text.split("\n").map((line, i) => {
          const t = line.trim();
          if (!t) return <div key={i} className="h-1" />;
          if (/^#{1,6}\s/.test(t)) return <h3 key={i} className="pt-2 font-semibold">{t.replace(/^#+\s*/, "")}</h3>;
          if (/^[-*]\s/.test(t))
            return (
              <p key={i} className="pl-4 -indent-3">
                • <Linked text={t.replace(/^[-*]\s*/, "")} />
              </p>
            );
          return (
            <p key={i}>
              <Linked text={t} />
            </p>
          );
        })}
      </div>
    </section>
  );
}
