"""Generate the module's original 16-bit mono effects with Python's standard library."""

import argparse
from dataclasses import dataclass
from math import exp, pi, sin, sqrt
from pathlib import Path
from struct import pack
import wave

RETRO_RATE = 22050
CRYSTAL_RATE = 22050
OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "sounds"


@dataclass(frozen=True)
class Voice:
    """Single synthesized oscillator or LFSR noise layer."""

    start: float
    duration: float
    wave: str
    hz_start: float
    hz_end: float | None = None
    level: float = 1.0
    duty: float = 0.5
    attack: float = 0.003
    release: float = 0.022
    decay: float = 2.2
    curve: float = 1.0
    step_hz: float = 0.0
    vib_hz: float = 0.0
    vib_depth: float = 0.0
    short_mode: bool = False


# Original soft crystal chimes preserved for `--style crystal`.
CRYSTAL_EFFECTS = {
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
    "shield-block": [(0, .10, 987.77, .82, 1.06), (.014, .12, 1479.98, .55, 1.02)],
}


# Original retro 8-bit/16-bit chiptune effects: (target_rms, peak_cap, voices).
RETRO_EFFECTS: dict[str, tuple[float, float, list[Voice]]] = {
    "open": (0.14, 0.62, [
        Voice(0.000, 0.060, "pulse", 880.00, 880.00, 0.72, duty=0.25, attack=0.002, release=0.012, decay=1.8),
        Voice(0.000, 0.012, "noise", 11000.0, 6500.0, 0.25, attack=0.001, release=0.005, decay=3.0),
        Voice(0.085, 0.060, "pulse", 987.77, 987.77, 0.75, duty=0.25, attack=0.002, release=0.012, decay=1.8),
        Voice(0.085, 0.012, "noise", 11000.0, 6500.0, 0.25, attack=0.001, release=0.005, decay=3.0),
        Voice(0.165, 0.195, "pulse", 523.25, 1046.50, 0.80, duty=0.5, attack=0.003, release=0.030, decay=1.6, step_hz=45.0),
        Voice(0.165, 0.195, "tri", 261.63, 523.25, 0.55, attack=0.004, release=0.030, decay=1.4, step_hz=45.0),
    ]),
    "countdown": (0.11, 0.52, [
        Voice(0.000, 0.095, "pulse", 698.46, 783.99, 0.80, duty=0.25, attack=0.002, release=0.018, decay=2.0, curve=0.7),
        Voice(0.000, 0.095, "tri", 349.23, 392.00, 0.50, attack=0.002, release=0.018, decay=1.8, curve=0.7),
    ]),
    "start": (0.14, 0.62, [
        Voice(0.000, 0.075, "pulse", 523.25, 523.25, 0.72, duty=0.25, attack=0.002, release=0.015, decay=1.6),
        Voice(0.052, 0.075, "pulse", 659.25, 659.25, 0.76, duty=0.25, attack=0.002, release=0.015, decay=1.6),
        Voice(0.104, 0.075, "pulse", 783.99, 783.99, 0.80, duty=0.25, attack=0.002, release=0.015, decay=1.6),
        Voice(0.156, 0.190, "pulse", 1046.50, 1046.50, 0.88, duty=0.25, attack=0.002, release=0.036, decay=1.8),
        Voice(0.000, 0.104, "tri", 261.63, 261.63, 0.45, attack=0.003, release=0.018, decay=1.2),
        Voice(0.104, 0.060, "tri", 392.00, 392.00, 0.48, attack=0.003, release=0.015, decay=1.2),
        Voice(0.156, 0.185, "tri", 523.25, 523.25, 0.56, attack=0.003, release=0.036, decay=1.6),
    ]),
    "hit": (0.15, 0.66, [
        Voice(0.000, 0.165, "noise", 5400.0, 850.0, 0.68, attack=0.002, release=0.030, decay=2.6, curve=1.2, step_hz=60.0),
        Voice(0.000, 0.185, "saw", 370.0, 82.0, 0.74, attack=0.002, release=0.030, decay=2.2, curve=0.9, step_hz=60.0),
        Voice(0.000, 0.210, "tri", 190.0, 62.0, 0.72, attack=0.002, release=0.035, decay=1.9, curve=0.85),
    ]),
    "telegraph": (0.12, 0.56, [
        Voice(0.000, 0.100, "pulse", 415.30, 622.25, 0.75, duty=0.25, attack=0.002, release=0.016, decay=1.4),
        Voice(0.000, 0.095, "pulse", 830.61, 1244.51, 0.30, duty=0.125, attack=0.002, release=0.016, decay=2.0),
        Voice(0.115, 0.120, "pulse", 523.25, 783.99, 0.85, duty=0.25, attack=0.002, release=0.024, decay=1.6),
        Voice(0.115, 0.115, "pulse", 1046.50, 1567.98, 0.34, duty=0.125, attack=0.002, release=0.022, decay=2.0),
    ]),
    "beam-fire": (0.16, 0.68, [
        Voice(0.000, 0.032, "noise", 11500.0, 7200.0, 0.72, attack=0.001, release=0.010, decay=2.0),
        Voice(0.010, 0.320, "noise", 7800.0, 1300.0, 0.58, attack=0.004, release=0.055, decay=2.1, curve=1.1),
        Voice(0.008, 0.310, "saw", 460.0, 102.0, 0.52, attack=0.004, release=0.045, decay=1.8, curve=0.95),
        Voice(0.008, 0.310, "pulse", 452.0, 96.0, 0.42, duty=0.5, attack=0.004, release=0.045, decay=1.8, curve=0.95),
        Voice(0.004, 0.335, "tri", 145.0, 52.0, 0.68, attack=0.003, release=0.055, decay=1.5, curve=0.8),
    ]),
    "timing-hit": (0.13, 0.58, [
        Voice(0.000, 0.022, "noise", 13000.0, 5500.0, 0.48, attack=0.001, release=0.008, decay=2.8),
        Voice(0.008, 0.072, "pulse", 783.99, 783.99, 0.75, duty=0.25, attack=0.002, release=0.015, decay=1.8),
        Voice(0.056, 0.135, "pulse", 1174.66, 1174.66, 0.88, duty=0.25, attack=0.002, release=0.030, decay=2.0),
        Voice(0.056, 0.135, "pulse", 587.33, 587.33, 0.42, duty=0.5, attack=0.002, release=0.030, decay=2.0),
    ]),
    "jump": (0.11, 0.52, [
        Voice(0.000, 0.120, "pulse", 245.0, 650.0, 0.80, duty=0.25, attack=0.002, release=0.022, decay=1.7, curve=0.8),
        Voice(0.000, 0.105, "tri", 122.5, 325.0, 0.48, attack=0.002, release=0.022, decay=1.6, curve=0.8),
    ]),
    "shard-wave": (0.125, 0.54, [
        Voice(0.000, 0.095, "noise", 4200.0, 10500.0, 0.56, attack=0.006, release=0.020, decay=1.1, curve=0.8),
        Voice(0.070, 0.120, "noise", 9500.0, 2600.0, 0.50, attack=0.006, release=0.032, decay=1.9, curve=1.1),
        Voice(0.008, 0.085, "pulse", 587.33, 880.00, 0.36, duty=0.125, attack=0.004, release=0.018, decay=1.6),
        Voice(0.075, 0.110, "pulse", 880.00, 1174.66, 0.34, duty=0.125, attack=0.004, release=0.025, decay=1.9),
    ]),
    "gate-warn": (0.115, 0.64, [
        Voice(0.000, 0.066, "pulse", 880.00, 880.00, 0.80, duty=0.125, attack=0.002, release=0.014, decay=0.9),
        Voice(0.000, 0.012, "noise", 12000.0, 8000.0, 0.24, attack=0.001, release=0.005, decay=2.2),
        Voice(0.075, 0.072, "pulse", 1046.50, 1046.50, 0.86, duty=0.125, attack=0.002, release=0.016, decay=0.9),
        Voice(0.075, 0.012, "noise", 12500.0, 8500.0, 0.24, attack=0.001, release=0.005, decay=2.2),
    ]),
    "shield-block": (0.125, 0.64, [
        Voice(0.000, 0.016, "noise", 10500.0, 7500.0, 0.42, attack=0.001, release=0.006, decay=2.4, short_mode=True),
        Voice(0.002, 0.142, "pulse", 987.77, 987.77, 0.86, duty=0.125, attack=0.002, release=0.028, decay=1.75),
        Voice(0.010, 0.132, "pulse", 1479.98, 1479.98, 0.64, duty=0.25, attack=0.002, release=0.026, decay=2.1),
        Voice(0.004, 0.088, "sine", 2725.0, 2725.0, 0.28, attack=0.002, release=0.022, decay=2.8),
    ]),
    "win": (0.15, 0.64, [
        Voice(0.000, 0.090, "pulse", 523.25, 523.25, 0.72, duty=0.25, attack=0.002, release=0.016, decay=1.4),
        Voice(0.075, 0.090, "pulse", 659.25, 659.25, 0.75, duty=0.25, attack=0.002, release=0.016, decay=1.4),
        Voice(0.150, 0.090, "pulse", 783.99, 783.99, 0.78, duty=0.25, attack=0.002, release=0.016, decay=1.4),
        Voice(0.225, 0.090, "pulse", 987.77, 987.77, 0.82, duty=0.25, attack=0.002, release=0.016, decay=1.4),
        Voice(0.300, 0.395, "pulse", 1046.50, 1046.50, 0.88, duty=0.25, attack=0.003, release=0.070, decay=1.8, vib_hz=6.5, vib_depth=0.012),
        Voice(0.300, 0.380, "pulse", 783.99, 783.99, 0.42, duty=0.5, attack=0.004, release=0.070, decay=2.0),
        Voice(0.000, 0.150, "tri", 261.63, 261.63, 0.50, attack=0.004, release=0.022, decay=1.1),
        Voice(0.150, 0.150, "tri", 196.00, 196.00, 0.50, attack=0.004, release=0.022, decay=1.1),
        Voice(0.300, 0.385, "tri", 261.63, 261.63, 0.58, attack=0.004, release=0.070, decay=1.6),
    ]),
    "lose": (0.15, 0.66, [
        # Stage 1: soul crack
        Voice(0.000, 0.140, "noise", 8800.0, 2200.0, 0.62, attack=0.002, release=0.026, decay=2.2, curve=1.1),
        Voice(0.000, 0.145, "pulse", 329.63, 246.94, 0.72, duty=0.5, attack=0.002, release=0.024, decay=1.7, step_hz=45.0),
        # Stage 2: shatter & descending defeat
        Voice(0.255, 0.250, "noise", 6800.0, 750.0, 0.64, attack=0.002, release=0.050, decay=2.3, curve=1.2),
        Voice(0.260, 0.140, "pulse", 311.13, 293.66, 0.74, duty=0.5, attack=0.003, release=0.024, decay=1.4),
        Voice(0.375, 0.145, "pulse", 261.63, 246.94, 0.76, duty=0.5, attack=0.003, release=0.024, decay=1.4),
        Voice(0.495, 0.220, "pulse", 220.00, 196.00, 0.80, duty=0.5, attack=0.003, release=0.055, decay=1.6),
        Voice(0.260, 0.455, "tri", 155.56, 98.00, 0.58, attack=0.004, release=0.060, decay=1.3),
    ]),
    "close": (0.132, 0.52, [
        Voice(0.000, 0.095, "pulse", 392.00, 392.00, 0.72, duty=0.5, attack=0.002, release=0.018, decay=1.7),
        Voice(0.000, 0.095, "tri", 196.00, 196.00, 0.45, attack=0.002, release=0.018, decay=1.6),
        Voice(0.075, 0.125, "pulse", 293.66, 293.66, 0.76, duty=0.5, attack=0.002, release=0.032, decay=2.0),
        Voice(0.075, 0.125, "tri", 146.83, 146.83, 0.48, attack=0.002, release=0.032, decay=1.9),
    ]),
}


def poly_blep(t: float, dt: float) -> float:
    """Polynomial band-limited step correction to reduce oscillator aliasing."""
    if dt <= 0.0:
        return 0.0
    if t < dt:
        x = t / dt
        return x + x - x * x - 1.0
    if t > 1.0 - dt:
        x = (t - 1.0) / dt
        return x * x + x + x + 1.0
    return 0.0


def sample_oscillator(wave_kind: str, phase: float, dt: float, duty: float) -> float:
    """Evaluate one band-limited retro oscillator sample in [-1, 1]."""
    if wave_kind == "pulse":
        dc = 2.0 * duty - 1.0
        raw = (1.0 if phase < duty else -1.0) + poly_blep(phase, dt) - poly_blep((phase - duty) % 1.0, dt)
        return (raw - dc) / max(abs(1.0 - dc), abs(-1.0 - dc))
    if wave_kind == "saw":
        return 2.0 * phase - 1.0 - poly_blep(phase, dt)
    if wave_kind == "tri":
        return 1.0 - 4.0 * abs(phase - 0.5)
    if wave_kind == "sine":
        return sin(2.0 * pi * phase)
    raise ValueError(f"Unsupported wave kind: {wave_kind}")


def voice_frequency(voice: Voice, t: float, pos: float) -> float:
    """Compute instantaneous frequency with optional quantization and vibrato."""
    if voice.step_hz > 0.0:
        ticks = max(1.0, voice.duration * voice.step_hz)
        qpos = int(pos * ticks) / ticks
    else:
        qpos = pos
    hz_end = voice.hz_end if voice.hz_end is not None else voice.hz_start
    if voice.hz_start > 0.0 and hz_end > 0.0:
        hz = voice.hz_start * ((hz_end / voice.hz_start) ** (qpos ** voice.curve))
    else:
        hz = voice.hz_start
    if voice.vib_hz > 0.0 and voice.vib_depth > 0.0:
        hz *= 1.0 + voice.vib_depth * sin(2.0 * pi * voice.vib_hz * t) * min(pos * 2.5, 1.0)
    return hz


def voice_envelope(voice: Voice, t: float, pos: float) -> float:
    """Compute smooth attack/decay/release envelope without edge clicks."""
    attack = sin(pi * 0.5 * min(t / max(voice.attack, 1e-6), 1.0)) ** 2
    release = sin(pi * 0.5 * min((voice.duration - t) / max(voice.release, 1e-6), 1.0)) ** 2
    return attack * release * exp(-voice.decay * pos)


def render_voice(mix: list[float], voice: Voice, idx: int, rate: int) -> None:
    """Add one synthesized voice layer into the mix buffer."""
    offset = round(voice.start * rate)
    count = round(voice.duration * rate)
    phase = 0.0
    lfsr = (0x4ACE ^ ((idx + 1) * 0x1357)) & 0x7FFF or 1
    tap = 6 if voice.short_mode else 1

    for i in range(count):
        t = i / rate
        pos = t / voice.duration
        hz = voice_frequency(voice, t, pos)
        env = voice_envelope(voice, t, pos)
        if voice.wave == "noise":
            phase += max(hz, 1.0) / rate
            if phase >= 1.0:
                steps = min(int(phase), 16)
                phase -= int(phase)
                for _ in range(steps):
                    bit = (lfsr ^ (lfsr >> tap)) & 1
                    lfsr = (lfsr >> 1) | (bit << 14)
            tone = 1.0 if (lfsr & 1) else -1.0
        else:
            dt = min(max(hz, 1.0) / rate, 0.45)
            tone = sample_oscillator(voice.wave, phase, dt, voice.duty)
            phase = (phase + dt) % 1.0
        mix[offset + i] += voice.level * env * tone


def postprocess_mix(mix: list[float], active_len: int, rate: int, target_rms: float, peak_cap: float) -> list[int]:
    """Filter ultrasonic aliasing, remove DC, fade edges cleanly, and normalize."""
    # 1-pole low-pass filter safely below Nyquist removes harsh aliasing.
    dt = 1.0 / rate
    cutoff = min(11500.0, rate * 0.40)
    rc = 1.0 / (2.0 * pi * cutoff)
    alpha = dt / (rc + dt)
    lp = 0.0
    for i, x in enumerate(mix):
        lp += alpha * (x - lp)
        mix[i] = lp

    # 1-pole DC blocker prevents pulse/noise DC thumps.
    x_prev = 0.0
    y_prev = 0.0
    for i, x in enumerate(mix):
        y = x - x_prev + 0.996 * y_prev
        x_prev = x
        y_prev = y
        mix[i] = y

    # Zero-click boundary fades and 15 ms silent tail.
    fade_in = min(round(0.002 * rate), active_len)
    fade_out = min(round(0.008 * rate), active_len)
    for i in range(fade_in):
        mix[i] *= sin(pi * 0.5 * (i / fade_in)) ** 2
    for i in range(fade_out):
        idx = active_len - 1 - i
        mix[idx] *= sin(pi * 0.5 * (i / fade_out)) ** 2
    for i in range(active_len, len(mix)):
        mix[i] = 0.0

    peak = max((abs(s) for s in mix), default=0.0)
    rms = sqrt(sum(s * s for s in mix) / len(mix)) if mix else 0.0
    gain = min(peak_cap / peak, target_rms / rms) if peak > 0.0 and rms > 0.0 else 0.0
    return [max(-32000, min(32000, round(s * gain * 32767))) for s in mix]


def synthesize_retro(spec: tuple[float, float, list[Voice]], rate: int = RETRO_RATE) -> list[int]:
    """Render one retro 8-bit/16-bit effect to 16-bit mono samples."""
    target_rms, peak_cap, voices = spec
    active_len = max(round(v.start * rate) + round(v.duration * rate) for v in voices)
    total = active_len + round(0.015 * rate)
    mix = [0.0] * total
    for idx, voice in enumerate(voices):
        render_voice(mix, voice, idx, rate)
    return postprocess_mix(mix, active_len, rate, target_rms, peak_cap)


def synthesize_crystal(voices, rate: int = CRYSTAL_RATE) -> list[int]:
    """Render one soft crystal chime effect (legacy `--style crystal`)."""
    total = int((max(start + duration for start, duration, *_ in voices) + .026) * rate)
    mix = [0.0] * total
    for start, duration, hz, level, bend in voices:
        phase = 0.0
        offset = round(start * rate)
        for i in range(round(duration * rate)):
            t = i / rate
            position = t / duration
            attack = sin(pi / 2 * min(t / .014, 1)) ** 2
            release = sin(pi / 2 * min((duration - t) / .09, 1)) ** 2
            envelope = attack * release * exp(-2.5 * position)
            tone = sin(phase) + .23 * exp(-3 * position) * sin(2.01 * phase) + .08 * sin(3.02 * phase)
            mix[offset + i] += level * envelope * tone
            phase += 2 * pi * hz * (1 + (bend - 1) * position) / rate
    peak = max(abs(sample) for sample in mix)
    rms = sqrt(sum(sample * sample for sample in mix) / len(mix))
    gain = min(.54 / peak, .12 / rms)
    return [round(sample * gain * 32767) for sample in mix]


def write_wav(path: Path, samples: list[int], rate: int) -> None:
    """Write 16-bit signed mono PCM samples to a WAV file."""
    with wave.open(str(path), "wb") as wav:
        wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        wav.writeframes(pack(f"<{len(samples)}h", *samples))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--style", choices=("retro", "crystal"), default="retro",
                        help="Synthesis preset style (default: retro)")
    parser.add_argument("--output", type=Path, default=OUTPUT,
                        help="Output directory for generated .wav files")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.style == "crystal":
        for event, voices in CRYSTAL_EFFECTS.items():
            write_wav(args.output / f"{event}.wav", synthesize_crystal(voices, CRYSTAL_RATE), CRYSTAL_RATE)
        return

    for event, spec in RETRO_EFFECTS.items():
        write_wav(args.output / f"{event}.wav", synthesize_retro(spec, RETRO_RATE), RETRO_RATE)


if __name__ == "__main__":
    main()
