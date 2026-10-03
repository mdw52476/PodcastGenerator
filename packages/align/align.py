"""Word timings for a known script against existing narration audio.

faster-whisper supplies *times*; the script supplies *words*. Each script word
gets {word, start, end} where `word` is the script's exact spelling (with its
punctuation), so captions never inherit a transcription error ("Glenn").

Usage: python align.py --audio narration.mp3 --script script.txt --out timings.json
"""
import argparse
import difflib
import json
import re
import sys


def norm(w: str) -> str:
    w = w.lower().replace("’", "'")
    return re.sub(r"[^a-z0-9']", "", w).strip("'")


def script_words(text: str):
    # Keep paragraph breaks as a flag so the caption chunker can use them.
    out = []
    for p_i, para in enumerate(re.split(r"\n\s*\n", text.strip())):
        for i, w in enumerate(para.split()):
            out.append({"word": w, "para": p_i, "paraStart": i == 0})
    return out


def decode(audio: str, ffmpeg: str):
    # Decode with ffmpeg ourselves; faster-whisper's PyAV path is fragile across versions.
    import subprocess
    import numpy as np

    pcm = subprocess.run(
        [ffmpeg, "-v", "error", "-i", audio, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(pcm, dtype=np.float32)


def transcribe(audio: str, model_name: str, ffmpeg: str):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(decode(audio, ffmpeg), word_timestamps=True, language="en", beam_size=5)
    words = []
    for seg in segments:
        for w in seg.words:
            words.append({"text": w.word.strip(), "start": w.start, "end": w.end})
        print(f"  transcribed to {seg.end:7.1f}s / {info.duration:.1f}s", file=sys.stderr, flush=True)
    return words, info.duration


def align(script, heard):
    a = [norm(w["word"]) for w in script]
    b = [norm(w["text"]) for w in heard]
    times = [None] * len(script)
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                times[i1 + k] = (heard[j1 + k]["start"], heard[j1 + k]["end"])
        elif tag == "replace" and j2 > j1:
            # Spread the heard span evenly across the script words ("45" vs "forty-five").
            s, e = heard[j1]["start"], heard[j2 - 1]["end"]
            n = i2 - i1
            for k in range(n):
                times[i1 + k] = (s + (e - s) * k / n, s + (e - s) * (k + 1) / n)
    matched = sum(1 for t in times if t is not None)
    # Interpolate anything still missing between known neighbours.
    i = 0
    while i < len(times):
        if times[i] is None:
            j = i
            while j < len(times) and times[j] is None:
                j += 1
            lo = times[i - 1][1] if i > 0 else 0.0
            hi = times[j][0] if j < len(times) else lo + 0.4 * (j - i)
            n = j - i
            for k in range(n):
                times[i + k] = (lo + (hi - lo) * k / n, lo + (hi - lo) * (k + 1) / n)
            i = j
        else:
            i += 1
    return times, matched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--script", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--ffmpeg", default="ffmpeg")
    args = ap.parse_args()

    with open(args.script, encoding="utf-8") as f:
        script = script_words(f.read())
    heard, duration = transcribe(args.audio, args.model, args.ffmpeg)
    times, matched = align(script, heard)
    words = [
        {"word": w["word"], "start": round(s, 3), "end": round(e, 3), **({"paraStart": True} if w["paraStart"] else {})}
        for w, (s, e) in zip(script, times)
    ]
    out = {
        "source": f"faster-whisper {args.model} + script alignment",
        "durationSec": round(duration, 3),
        "matchedRatio": round(matched / len(script), 4),
        "words": words,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
    print(f"aligned {len(words)} words, {matched} matched directly ({out['matchedRatio']:.1%})")


if __name__ == "__main__":
    main()
