"""Generate the module's original 16-bit mono crystal effects with Python's standard library."""

from math import exp, pi, sin, sqrt
from pathlib import Path
from struct import pack
import wave

RATE = 22050
OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "sounds"

# Each voice defines its onset, duration, frequency, level and optional pitch bend.
EFFECTS = {
    "open": [(0, .24, 440, .7, 1.04), (.065, .29, 659.25, .85, 1), (.14, .31, 880, .67, 1)],
    "countdown": [(0, .15, 698.46, .85, .98), (.018, .14, 1046.50, .23, 1)],
    "start": [(0, .28, 523.25, .76, 1), (.065, .31, 783.99, .85, 1), (.145, .36, 1046.5, .74, 1)],
    "hit": [(0, .21, 220, 1, .55), (.016, .17, 329.63, .43, .6)],
    "telegraph": [(0, .28, 415.30, .78, 1.32), (.105, .235, 622.25, .48, 1.12)],
    "beam-fire": [(0, .24, 349.23, .9, .52), (.009, .23, 523.25, .55, .61), (.016, .22, 174.61, .68, .75)],
    "timing-hit": [(0, .22, 783.99, .85, 1), (.05, .29, 1174.66, .63, 1)],
    "win": [(0, .33, 523.25, .72, 1), (.075, .35, 659.25, .75, 1), (.15, .4, 783.99, .77, 1),
            (.23, .50, 1046.50, .72, 1), (.26, .46, 659.25, .35, 1)],
    "lose": [(0, .34, 440, .83, .91), (.103, .36, 349.23, .72, .9), (.215, .42, 261.63, .78, .94)],
    "close": [(0, .23, 659.25, .72, .93), (.068, .25, 440, .58, .87)],
    "jump": [(0, .12, 349.23, .78, 1.48), (.02, .11, 523.25, .42, 1.32)],
    "shard-wave": [(0, .18, 587.33, .45, 1.18), (.045, .19, 880.0, .40, 1.12), (.09, .16, 1174.66, .28, 1.05)],
    "gate-warn": [(0, .08, 880.0, .72, 1.04), (.075, .09, 1046.5, .62, 1.02)],
}


def synthesize(voices):
    total = int((max(start + duration for start, duration, *_ in voices) + .026) * RATE)
    mix = [0.0] * total
    for start, duration, hz, level, bend in voices:
        phase = 0.0
        offset = round(start * RATE)
        for i in range(round(duration * RATE)):
            t = i / RATE
            position = t / duration
            attack = sin(pi / 2 * min(t / .014, 1)) ** 2
            release = sin(pi / 2 * min((duration - t) / .09, 1)) ** 2
            envelope = attack * release * exp(-2.5 * position)
            tone = sin(phase) + .23 * exp(-3 * position) * sin(2.01 * phase) + .08 * sin(3.02 * phase)
            mix[offset + i] += level * envelope * tone
            phase += 2 * pi * hz * (1 + (bend - 1) * position) / RATE
    peak = max(abs(sample) for sample in mix)
    rms = sqrt(sum(sample * sample for sample in mix) / len(mix))
    gain = min(.54 / peak, .12 / rms)
    return [round(sample * gain * 32767) for sample in mix]


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for event, notes in EFFECTS.items():
        samples = synthesize(notes)
        with wave.open(str(OUTPUT / f"{event}.wav"), "wb") as wav:
            wav.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
            wav.writeframes(pack(f"<{len(samples)}h", *samples))


if __name__ == "__main__":
    main()
