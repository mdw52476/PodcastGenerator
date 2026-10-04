import type { CharAlignment, ShowProfile } from "@shoebox/edit-plan";
import { need } from "./env";

const API = "https://api.elevenlabs.io/v1";

/** Characters left this billing period, or null if the key may not read the subscription. */
export async function remainingCharacters(): Promise<number | null> {
  const res = await fetch(`${API}/user/subscription`, { headers: { "xi-api-key": need("ELEVENLABS_API_KEY") } });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`ElevenLabs subscription check failed: HTTP ${res.status} ${await res.text()}`);
  const s = (await res.json()) as { character_count: number; character_limit: number };
  return s.character_limit - s.character_count;
}

export interface Speech {
  audio: Buffer;
  alignment: CharAlignment;
}

/**
 * One paragraph of speech with character timings. The neighbouring paragraphs
 * go along as context so the delivery matches what's around it.
 */
export async function speak(text: string, voice: ShowProfile["voice"], context: { previous?: string; next?: string } = {}): Promise<Speech> {
  const body = {
    text,
    model_id: voice.model,
    voice_settings: { stability: voice.stability, similarity_boost: voice.similarity, style: voice.style, use_speaker_boost: true, speed: voice.speed },
    ...(context.previous ? { previous_text: context.previous.slice(-1000) } : {}),
    ...(context.next ? { next_text: context.next.slice(0, 1000) } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voice.voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": need("ELEVENLABS_API_KEY"), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const j = (await res.json()) as { audio_base64: string; alignment: CharAlignment };
      return { audio: Buffer.from(j.audio_base64, "base64"), alignment: j.alignment };
    }
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    if (res.status === 401) throw new Error("ElevenLabs refused the API key (check ELEVENLABS_API_KEY and that it has Text to Speech access).");
    if (/quota|credits|limit/i.test(text)) throw new Error(`ElevenLabs is out of characters for this key or plan: ${text.slice(0, 300)}`);
    throw new Error(`ElevenLabs text-to-speech failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
}
