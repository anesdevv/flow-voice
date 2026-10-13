# FlowVoice

**FlowVoice** is an independent, 100% private, local voice dictation desktop app inspired by the reverse-engineered architecture of Wispr Flow.

It features a transparent floating pill overlay, local offline Whisper speech recognition (CTranslate2 INT8 with `base.en`), global hotkey Hybrid (Hold OR Tap) modes, native studio-grade polyphase audio resampling, and intelligent text insertion into any active Windows application.

---

## Architecture Overview

```
                      +---------------------------------------+
                      |       Electron Floating Pill UI       |
                      |  - Transparent Glassmorphism Overlay  |
                      |  - Live Audio Equalizer Waveform      |
                      |  - WS_EX_TOOLWINDOW (Stealth Mode)    |
                      |  - showInactive (Zero Focus Steal)    |
                      +-------------------+-------------------+
                                          |
                               WebSocket (ws://127.0.0.1:48123)
                                          |
                      +-------------------+-------------------+
                      |      Python FlowEngine Service        |
                      |  - pynput Global Hotkey (F8 Hybrid)   |
                      |  - Native Audio (44.1kHz / 48kHz)     |
                      |  - Polyphase 16kHz FIR Resampling     |
                      |  - 75Hz Rumble & DC Bias Filter       |
                      |  - Adaptive RMS VAD Silence Trimming  |
                      |  - faster-whisper (base.en Beam 5)    |
                      |  - Anti-Hallucination Guardrails      |
                      |  - pynput Keystroke Injector          |
                      +---------------------------------------+
```

---

## High-Precision Accuracy & Anti-Hallucination Features

1. **Upgraded to `base.en` (High Precision)**:
   - Powered by the 74M-parameter `base.en` model running quantized INT8 locally on your CPU.
   - Far superior accuracy and phoneme recognition compared to `tiny.en`, avoiding misheard words and garbled text.
2. **Native Hardware Audio Capture & Polyphase FIR Resampling**:
   - Captures directly at your microphone's native hardware rate (e.g. 44.1kHz / 48kHz stereo) to prevent driver-level aliasing distortion.
   - Resamples using `scipy.signal.resample_poly` with a bandlimited Kaiser-windowed FIR filter, producing studio-clean 16kHz speech.
3. **Adaptive RMS Voice Activity Detection (VAD) & Silence Trimming**:
   - Trims dead air before and after speech based on real-time noise floor estimation.
   - Discards pure background noise/silence before it reaches Whisper, eliminating phantom subtitle hallucinations (e.g., *"Thank you for watching"*, *"Please subscribe"*).
4. **Anti-Hallucination Beam Search Decoding**:
   - Uses `beam_size=5` and `best_of=5` with `condition_on_previous_text=False`, `repetition_penalty=1.1`, and `no_repeat_ngram_size=3`.
   - Prevents repetitive word loops and unprompted text hallucinations.
5. **Hybrid Hotkey: Hold OR Tap (`F8`)**:
   - **Hold to Speak**: Hold down **`F8`** while talking, release to automatically paste into your active app.
   - **Tap to Speak**: Tap **`F8`** once to start dictating (overlay displays *"Listening..."*). Speak freely, then tap **`F8`** again to finish and paste!
6. **Smart Verbal Punctuation & Commands**:
   - Say *"period"* or *"full stop"* $\rightarrow$ `.`
   - Say *"comma"* $\rightarrow$ `,`
   - Say *"question mark"* $\rightarrow$ `?`
   - Say *"exclamation point"* $\rightarrow$ `!`
   - Say *"new line"* or *"next line"* $\rightarrow$ Line break
   - Say *"press enter"* or *"hit enter"* $\rightarrow$ Executes Enter keypress!
7. **Zero Focus Stealing**:
   - The floating overlay uses `showInactive()` and `focusable: false` so your blinking cursor stays firmly in Notepad, YouTube search, Chrome, or VS Code.

---

## How to Run

To start FlowVoice with both the Python engine and Electron overlay:

```bash
npm start
```

Or run the Python engine standalone:

```bash
python engine/server.py
```

### Try it now:
1. Open **Notepad** or click into the **YouTube search bar**.
2. Either **hold `F8`** while speaking and release, OR **tap `F8`**, speak, and **tap `F8`** again.
3. Speak clearly into your microphone: *"Hello world period This is a high accuracy test period"*
4. Your speech is transcribed locally with zero hallucinations and pasted directly into the input field!
