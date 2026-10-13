"""
Audio Preprocessing & Dictation Post-Processing Engine
Provides:
1. Native sample-rate polyphase resampling (e.g. 44.1kHz -> 16kHz) with zero aliasing.
2. DC offset removal and 75Hz high-pass rumble filter.
3. Energy-based silence trimming (eliminates Whisper silence hallucinations).
4. Peak dynamics normalization.
5. Post-processing text cleanup (hallucination stripping, punctuation, verbal commands).
"""
import math
import re
import numpy as np
import scipy.signal

TARGET_SR = 16000

def resample_to_16k(audio, orig_sr):
    """Resamples audio from native hardware sample rate to 16kHz using polyphase filtering."""
    if orig_sr == TARGET_SR:
        return audio.astype(np.float32)

    # Calculate exact rational fraction
    g = math.gcd(int(orig_sr), TARGET_SR)
    up = TARGET_SR // g
    down = int(orig_sr) // g

    resampled = scipy.signal.resample_poly(audio, up, down)
    return resampled.astype(np.float32)

def filter_rumble(audio, sr=16000, cutoff_hz=75.0):
    """High-pass 2nd-order Butterworth filter to eliminate low-frequency room rumble & DC."""
    try:
        sos = scipy.signal.butter(2, cutoff_hz, btype='highpass', fs=sr, output='sos')
        return scipy.signal.sosfilt(sos, audio).astype(np.float32)
    except Exception:
        return audio

def trim_silence(audio, sr=16000, frame_duration_ms=25, padding_ms=200):
    """
    Trims leading and trailing silence using RMS energy gating.
    Eliminates dead air where Whisper notoriously hallucinates subtitles.
    """
    if len(audio) == 0:
        return None

    frame_size = int(sr * frame_duration_ms / 1000)
    padding_samples = int(sr * padding_ms / 1000)

    # Compute RMS energy per frame
    num_frames = len(audio) // frame_size
    if num_frames == 0:
        return audio

    rms = []
    for i in range(num_frames):
        chunk = audio[i * frame_size : (i + 1) * frame_size]
        val = np.sqrt(np.mean(chunk ** 2))
        rms.append(val)
    rms = np.array(rms)

    max_energy = np.max(rms)
    if max_energy < 0.005:  # Audio is virtually silent throughout
        return None

    # Dynamic threshold based on background noise floor (10th percentile)
    noise_floor = float(np.percentile(rms, 10))
    speech_threshold = min(max_energy * 0.25, max(0.005, noise_floor + 0.004))

    speech_frames = np.where(rms >= speech_threshold)[0]
    if len(speech_frames) == 0:
        return None

    start_frame = speech_frames[0]
    end_frame = speech_frames[-1]

    start_sample = max(0, start_frame * frame_size - padding_samples)
    end_sample = min(len(audio), (end_frame + 1) * frame_size + padding_samples)

    trimmed = audio[start_sample:end_sample]
    return trimmed

def normalize_dynamics(audio):
    """Normalizes speech volume so soft speech is clearly recognized and loud speech doesn't clip."""
    if len(audio) == 0:
        return audio

    # Remove DC bias
    audio = audio - np.mean(audio)

    peak = np.max(np.abs(audio))
    if peak > 0.005:
        target_peak = 0.707  # -3 dB
        scale = target_peak / peak
        # Cap scaling factor at 10x to prevent amplifying pure quiet noise floor
        scale = min(10.0, max(0.2, scale))
        audio = audio * scale

    return np.clip(audio, -1.0, 1.0).astype(np.float32)

def prepare_audio_for_whisper(raw_frames, native_sr, num_channels=1):
    """
    Complete audio pipeline:
    1. Concatenates raw chunks
    2. Downmixes to mono
    3. Polyphase resamples to 16kHz
    4. Removes rumble & DC bias
    5. Trims leading/trailing silence
    6. Normalizes volume
    """
    if not raw_frames:
        return None, 0.0

    raw = np.concatenate(raw_frames, axis=0)

    # Downmix if multi-channel
    if num_channels > 1 and raw.ndim > 1:
        mono = np.mean(raw, axis=1)
    elif raw.ndim > 1:
        mono = raw[:, 0]
    else:
        mono = raw

    # Resample to 16kHz
    audio_16k = resample_to_16k(mono, native_sr)

    # High-pass filter
    audio_clean = filter_rumble(audio_16k, sr=TARGET_SR)

    # Trim leading & trailing silence
    audio_trimmed = trim_silence(audio_clean, sr=TARGET_SR)
    if audio_trimmed is None or len(audio_trimmed) < int(TARGET_SR * 0.2):
        # Empty or less than 200ms of actual speech
        return None, 0.0

    # Normalize dynamics
    final_audio = normalize_dynamics(audio_trimmed)
    duration = len(final_audio) / TARGET_SR

    return final_audio, duration

# Hallucination patterns common in Whisper
HALLUCINATION_PATTERNS = [
    r"\[blank_audio\]",
    r"\[music\]",
    r"\[applause\]",
    r"\[laughter\]",
    r"\(cheering\)",
    r"\(cheers\)",
    r"♪+",
    r"thank you for watching.*",
    r"thanks for watching.*",
    r"please like and subscribe.*",
    r"subtitles by.*",
    r"translated by.*",
    r"mbc news.*",
    r"amara\.org.*",
    r"^you$"
]

def clean_hallucinations(text):
    """Strips common subtitle and silence hallucination phrases."""
    cleaned = text
    for pattern in HALLUCINATION_PATTERNS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE).strip()
    return cleaned

def clean_repetitions(text):
    """Collapses consecutive repeated words (e.g. 'the the' -> 'the')."""
    words = text.split()
    if not words:
        return ""
    result = []
    for w in words:
        if not result or result[-1].lower() != w.lower():
            result.append(w)
    return " ".join(result)

def process_voice_commands(text):
    """
    Detects and handles verbal commands:
    - 'press enter' / 'hit enter' -> executes Enter keypress
    - 'new line' / 'next line' -> \n
    - 'period' / 'comma' / 'question mark' -> punctuation
    """
    press_enter = False
    lower = text.lower().rstrip(" .,!?")

    # Check for Enter command at the end of utterance
    if lower.endswith("press enter") or lower.endswith("hit enter"):
        press_enter = True
        idx = text.lower().rfind("press enter")
        if idx == -1:
            idx = text.lower().rfind("hit enter")
        if idx != -1:
            text = text[:idx].rstrip(" ,.-")

    # Verbal punctuation replacements
    replacements = [
        (r"\s*\bnew line\b\s*", "\n"),
        (r"\s*\bnext line\b\s*", "\n"),
        (r"\s*\bcomma\b\s*", ", "),
        (r"\s*\bperiod\b\s*", ". "),
        (r"\s*\bfull stop\b\s*", ". "),
        (r"\s*\bquestion mark\b\s*", "? "),
        (r"\s*\bexclamation point\b\s*", "! "),
        (r"\s*\bexclamation mark\b\s*", "! ")
    ]

    for pattern, repl in replacements:
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)

    # Clean up any weird spaces before punctuation (e.g. "word ," -> "word,")
    text = re.sub(r"\s+([,.\?!;:])", r"\1", text)
    text = re.sub(r"([,.\?!;:])\s*([A-Za-z])", r"\1 \2", text)

    # Capitalize first letter
    text = text.strip()
    if len(text) > 0:
        text = text[0].upper() + text[1:]

    return text, press_enter

def postprocess_transcription(raw_text):
    """Full postprocessing pipeline."""
    if not raw_text:
        return "", False

    # 1. Hallucination removal
    cleaned = clean_hallucinations(raw_text)
    if not cleaned:
        return "", False

    # 2. Repetition collapse
    cleaned = clean_repetitions(cleaned)

    # 3. Voice command & punctuation handling
    final_text, press_enter = process_voice_commands(cleaned)

    return final_text, press_enter
