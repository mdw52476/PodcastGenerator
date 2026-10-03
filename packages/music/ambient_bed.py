"""Code-composed dark ambient bed for The Shoebox Files.

Layers: detuned low pad following a slow chord progression, a sub hum,
sparse synthesized piano notes from the chord tones, a soft tape-hiss floor,
and a long synthetic reverb. Deterministic for a given set of parameters.

The defaults (A minor, seed 7, 60 s) reproduce the bed the owner approved.
Longer durations loop the four-chord progression.

Usage:
  python ambient_bed.py --out bed.wav [--duration 180] [--seed 7] [--key "A minor"]
                        [--density sparse|normal|dense] [--brightness 1.0] [--preset lighter]
                        [--fade-in 4] [--fade-out 6]
"""
import argparse

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
NOTE = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6,
        "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}

# Progressions as semitone offsets from the tonic (tonic sits in octave 2-3).
# Minor: i, VImaj7, iv9, Vsus4 (the approved Am, Fmaj7, Dm9, Esus4).
# Major: I, vi7, IVmaj7, Vsus4.
PROGRESSIONS = {
    "minor": [[0, 7, 12, 15, 19], [-4, 3, 8, 12, 19], [-7, 0, 5, 8, 12, 19], [-5, 2, 7, 12, 14]],
    "major": [[0, 7, 12, 16, 19], [-3, 4, 9, 12, 16, 19], [-7, 0, 5, 9, 16], [-5, 2, 7, 12, 14]],
}
DENSITY = {"sparse": (4.5, 9.0), "normal": (2.8, 6.5), "dense": (1.8, 4.0)}
PRESETS = {
    "dark": {},
    "lighter": {"key": "C major", "density": "sparse", "brightness": 1.35, "sub": 0.12},
}


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lowpass(x, cutoff, order=4):
    return sosfilt(butter(order, min(cutoff, SR / 2 - 100), "low", fs=SR, output="sos"), x)


def parse_key(key):
    name, mode = key.split()
    tonic = NOTE[name]
    # A2 = MIDI 45 was the approved root; keep tonics in the same register (F2..E3).
    root = 36 + tonic if tonic >= 5 else 48 + tonic
    return root, mode.lower()


def render(duration=60.0, seed=7, key="A minor", density="normal", brightness=1.0, sub_level=0.22,
           chord_sec=15.0, fade_in=4.0, fade_out=6.0):
    rng = np.random.default_rng(seed)
    N = int(SR * duration)
    t = np.arange(N) / SR
    root, mode = parse_key(key)
    prog = PROGRESSIONS[mode]
    n_chords = max(1, int(np.ceil(duration / chord_sec)))
    chords = [[root + o for o in prog[i % len(prog)]] for i in range(n_chords)]
    CH = chord_sec
    fade = 4.0  # seconds of overlap between chords

    def window(i):
        start, end = i * CH - fade / 2, (i + 1) * CH + fade / 2
        a, b = max(0, int(start * SR)), min(N, int(end * SR) + 1)
        tt = t[a:b]
        env = np.clip((tt - start) / fade, 0, 1) * np.clip((end - tt) / fade, 0, 1)
        return a, b, tt, env

    # --- Pad: detuned saw-ish voices, crossfaded between chords ------------
    pad = np.zeros(N)
    for i, chord in enumerate(chords):
        a, b, tt, env = window(i)
        env = np.sin(env * np.pi / 2) ** 2
        seg = np.zeros(b - a)
        for m in chord:
            f = midi_hz(m)
            for det in (-0.12, 0.0, 0.11):
                ph = rng.uniform(0, 2 * np.pi)
                ff = f * (1 + det / 100)
                for h in range(1, 7):
                    seg += np.sin(2 * np.pi * ff * h * tt + ph * h) / (h ** 1.6)
        pad[a:b] += seg * env / len(chord)
    swell = 0.75 + 0.25 * np.sin(2 * np.pi * t / 23.0 - 1.2)
    pad = lowpass(pad, 900 * brightness) * swell
    pad = lowpass(pad, 1400 * brightness)

    # --- Sub hum (root of each chord, an octave down) -----------------------
    sub = np.zeros(N)
    for i, chord in enumerate(chords):
        a, b, tt, env = window(i)
        sub[a:b] += np.sin(2 * np.pi * midi_hz(chord[0] - 12) * tt) * env
    sub *= 0.9 + 0.1 * np.sin(2 * np.pi * t / 7.0)

    # --- Sparse piano --------------------------------------------------------
    def piano_note(freq, dur=6.0, vel=0.6):
        n = int(SR * dur)
        tt = np.arange(n) / SR
        out = np.zeros(n)
        B = 0.0004  # slight inharmonicity like real strings
        for h in range(1, 12):
            fh = freq * h * np.sqrt(1 + B * h * h)
            if fh > SR / 2 - 1000:
                break
            decay = 1.2 + 0.9 * h
            amp = (1.0 / h ** 1.1) * np.exp(-tt * decay / 2.2)
            out += amp * np.sin(2 * np.pi * fh * tt + rng.uniform(0, 6.28))
        attack = np.minimum(tt / 0.006, 1.0)
        thump = lowpass(rng.normal(0, 1, n), 2500) * np.exp(-tt * 60) * 0.15
        note = (out * attack + thump) * vel
        note *= np.exp(-tt * 0.35)
        return note

    gap_lo, gap_hi = DENSITY[density]
    piano = np.zeros(N + SR * 8)
    time = 3.5
    while time < duration - 5:
        ci = min(int(time // CH), len(chords) - 1)
        pool = [m + 12 for m in chords[ci]] + [m + 24 for m in chords[ci][2:]]
        m = int(rng.choice(pool))
        vel = rng.uniform(0.35, 0.65)
        s = int(time * SR)
        nt = piano_note(midi_hz(m), vel=vel)
        piano[s:s + len(nt)] += nt
        if rng.random() < 0.35:
            m2 = int(rng.choice(pool))
            s2 = s + int(rng.uniform(0.6, 1.4) * SR)
            nt2 = piano_note(midi_hz(m2), vel=vel * 0.6)
            piano[s2:s2 + len(nt2)] += nt2
        time += rng.uniform(gap_lo, gap_hi)
    piano = lowpass(piano[:N], 4500 * brightness)

    # --- Hiss floor -----------------------------------------------------------
    hiss = lowpass(rng.normal(0, 1, N), 6000) * 0.004

    def norm(x):
        return x / (np.max(np.abs(x)) + 1e-9)

    dry = 0.42 * norm(pad) + sub_level * norm(sub) + 0.40 * norm(piano) + hiss

    # Synthetic reverb: exponentially decaying filtered noise (stereo, decorrelated)
    rt = 4.5
    ir_n = int(SR * rt)
    irt = np.arange(ir_n) / SR
    irL = lowpass(rng.normal(0, 1, ir_n), 5000) * np.exp(-irt * 6.9 / rt)
    irR = lowpass(rng.normal(0, 1, ir_n), 5000) * np.exp(-irt * 6.9 / rt)
    irL /= np.sqrt(np.sum(irL ** 2))
    irR /= np.sqrt(np.sum(irR ** 2))
    wetL = fftconvolve(dry, irL)[:N]
    wetR = fftconvolve(dry, irR)[:N]
    L = 0.55 * dry + 0.45 * norm(wetL) * np.max(np.abs(dry))
    R = 0.55 * dry + 0.45 * norm(wetR) * np.max(np.abs(dry))

    fi, fo = int(SR * fade_in), int(SR * fade_out)
    for ch in (L, R):
        if fi:
            ch[:fi] *= np.linspace(0, 1, fi) ** 2
        if fo:
            ch[-fo:] *= np.linspace(1, 0, fo) ** 2

    stereo = np.stack([L, R], axis=1)
    return stereo / np.max(np.abs(stereo)) * 0.89


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--duration", type=float, default=60.0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--preset", choices=sorted(PRESETS), default="dark")
    ap.add_argument("--key")
    ap.add_argument("--density", choices=sorted(DENSITY))
    ap.add_argument("--brightness", type=float)
    ap.add_argument("--fade-in", type=float, default=4.0)
    ap.add_argument("--fade-out", type=float, default=6.0)
    a = ap.parse_args()

    p = {"key": "A minor", "density": "normal", "brightness": 1.0, "sub": 0.22, **PRESETS[a.preset]}
    for k in ("key", "density", "brightness"):
        if getattr(a, k) is not None:
            p[k] = getattr(a, k)
    stereo = render(a.duration, a.seed, p["key"], p["density"], p["brightness"], p["sub"],
                    fade_in=a.fade_in, fade_out=a.fade_out)
    wavfile.write(a.out, SR, (stereo * 32767).astype(np.int16))
    print(f"wrote {a.out} ({a.duration:.1f}s, {p['key']}, {p['density']}, seed {a.seed})")


if __name__ == "__main__":
    main()
