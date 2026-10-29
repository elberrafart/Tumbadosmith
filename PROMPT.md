# Tumbadosmith — Build Prompt (v1: Web Prototype)

## Goal
Build **Tumbadosmith**, a Rocksmith-style practice game for **corridos tumbados**. The player plugs a real electric guitar or bass into an iPad with a **Rocksmith Real Tone Cable** (or any USB guitar interface). The app listens to the player through that cable, detects the notes they play, and scores them against a scrolling note highway.

v1 is a **web app that runs in Safari on iPad**. It's a prototype to prove the gameplay before a later native Swift/AVAudioEngine port, so the audio and chart logic should be framework-independent and easy to port.

## Platform & tech
- **Stack:** Vite + TypeScript, no heavy framework (vanilla or Preact). Canvas 2D (or WebGL if needed) for the highway. Installable as a PWA so it runs fullscreen in landscape on iPad.
- **Audio input:** `getUserMedia` with `echoCancellation`, `noiseSuppression` and `autoGainControl` all set to `false`. Let the user pick the input device (`enumerateDevices`) and remember the choice. The Real Tone Cable appears as a standard USB audio input; it's class-compliant, so no driver is needed.
- **Processing:** an `AudioWorklet` handles pitch detection off the main thread.
- **Pitch detection:** YIN or MPM (McLeod) with an adaptive window. It must reliably track **bass low E (41.2 Hz)** and the 5-string low B as a stretch goal (30.9 Hz), which needs a window of about 4096 samples at 48 kHz. It must also track guitar notes up to about fret 22 on the high E (~1175 Hz). Add onset detection (spectral flux or energy) so repeated notes count as separate hits.
- **Latency calibration:** a screen where the player plays along with a click. The app measures the offset between the click and the detected note and applies it to hit timing.
- **Tests:** unit tests (Vitest) for the pitch detector using synthesized sine and sawtooth tones and recorded-style signals across the bass and guitar ranges. Playwright smoke tests for the main screens.

## Instruments (v1)
- **Guitar:** 6 strings, standard tuning E A D G B E. Used for requinto lead lines and armonía rhythm.
- **Bass:** 4 strings, standard tuning E A D G, with 5-string B E A D G as a stretch goal. Covers both the tololoche-style role and electric bass.
- **Tuning setting:** offer presets (standard, half-step down, drop D) and a custom offset in semitones. All note targets follow the selected tuning.

## v1 features
1. **Tuner**
   - Chromatic tuner with a needle or strobe and cents readout. A string-by-string mode shows the target for each string in the selected tuning.
   - Shows an input level meter and a "no signal / check cable" hint.
2. **Note highway (main game)**
   - A Rocksmith-style 3D-perspective highway. String lanes are colored per string, with fret numbers on the gems and a fret-position indicator.
   - Single notes, slides, hammer-ons/pull-offs, and sustains in v1. Chords appear as shapes, scored by whether *any* of their notes is detected; full polyphonic detection is out of scope for v1.
   - Hit windows rated Perfect / Good / Miss. Score, streak multiplier and accuracy percent.
   - Speed control at 50 to 100% that slows the audio without changing pitch, and A-B section looping.
   - Results screen showing accuracy per section.
3. **Riff / lesson mode**
   - A library of **original practice riffs written in the corridos tumbados style**. No transcriptions of copyrighted songs. Include:
     - Guitar: requinto-style runs (fast triplet and sixteenth-note scalar runs, chromatic approaches, thirds and sixths), and armonía patterns (the tumbado strum and palm-mute feel, common progressions in minor keys).
     - Bass: tololoche-style walking patterns (root–fifth, chromatic walk-ups between chords), and lines in common tumbado keys.
     - Technique drills: alternate picking, hammer-on/pull-off trills, slides, position shifts.
   - Each riff has a difficulty level, a metronome or drum-loop backing generated with Web Audio, and an auto speed-up: after N clean loops the tempo rises 5%.
   - Progress per riff (best accuracy, highest speed cleared) saved in IndexedDB.

## Chart format
Use a JSON chart format, with a TypeScript type and validation:
```json
{
  "id": "requinto-run-01",
  "title": { "es": "Corrida de requinto #1", "en": "Requinto Run #1" },
  "instrument": "guitar" | "bass",
  "tuning": [0,0,0,0,0,0],   // semitone offsets per string from standard
  "bpm": 140, "timeSig": [4,4],
  "difficulty": 1-5,
  "sections": [{ "name": "intro", "start": 0.0 }],
  "notes": [
    { "t": 0.000, "string": 1, "fret": 5, "dur": 0.0, "tech": ["hammer"|"pull"|"slide"|"palm"] }
  ]
}
```
Time is in seconds from the chart start. String 1 is the highest-pitched string. Seed the app with at least 6 guitar riffs and 6 bass riffs.

## UI / UX
- **Bilingual Spanish + English** with a toggle; default to the device language. All text lives in i18n files.
- **Visual style:** dark, neon, with a regional-Mexican/street aesthetic (think tumbado album art). Large touch targets, landscape-first.
- **Screens:** Home → Instrument select (Guitar / Bass) → Tuner | Riffs | Settings (input device, tuning, latency calibration, language).

## Out of scope for v1
Song import, licensed music, polyphonic chord detection, amp/tone simulation, online accounts, and the native iOS app.

## Deliverables
- A working app in this repo, with a README covering setup, how to run it on the iPad (`npm run dev -- --host` over LAN, plus an HTTPS note because `getUserMedia` requires a secure context), and how to connect the cable.
- The audio and detection code in `src/audio/` and the chart logic in `src/chart/` stay free of DOM dependencies, so they can be ported to Swift later.
- Passing unit and smoke tests.
