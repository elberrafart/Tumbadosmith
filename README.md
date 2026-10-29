# Tumbadosmith

A Rocksmith-style practice game for **corridos tumbados**. Plug a real electric guitar or bass into an iPad with a **Rocksmith Real Tone Cable** (or any USB guitar interface). The app listens to what you play, detects the notes, and scores you on a scrolling 3D note highway.

> *Aprende corridos tumbados con tu guitarra o bajo real. La app está en español e inglés.*

v1 is a web app (PWA) that runs in Safari on iPad. The audio-detection and chart code has no DOM dependencies, so it can be ported to a native Swift app later.

## What's in v1

- **Tuner:** chromatic mode, or string-by-string with auto string detection and a ✓ on each string once it's in tune. Supports standard, half-step down, drop D and custom tunings, plus 5-string bass.
- **Note highway:** perspective highway with colour-coded strings, fret numbers, sustains, slides, hammer-ons/pull-offs, palm mutes and chord frames. Ratings are Perfect / Good / Miss, with score, streak, a ×1–×4 multiplier and accuracy. You can set the speed from 50% to 100%, and loop a section or an A-B range. The results screen shows accuracy for each section.
- **Riff / practice mode:** 12 original riffs in the tumbado style: 6 for guitar (requinto runs, thirds, sixths, legato, *armonía* rhythm) and 6 for bass (root–fifth, walk-ups, arpeggios, tololoche runs). Practice mode loops the riff with a synthesized drum groove. After 3 clean passes (90% or better) the speed goes up 5%. Your best accuracy and highest clean speed are saved on the device.
- **Settings:** input device, level meter, noise gate, input gain, monitor (hear your instrument), drums and metronome, latency calibration, ES/EN, string order, and **demo mode** (the app plays the notes itself, so you can try it without an instrument).

## Setup

Requires Node 22.18 or later.

```bash
npm install
npm run dev          # http://localhost:5173 on this computer
```

### Running on the iPad

Safari only allows audio input over **HTTPS**, so a plain `http://192.168…` address on your Wi-Fi won't work. There are two options:

**A. GitHub Pages (easiest, permanent URL).** In the GitHub repo, go to **Settings → Pages → Source** and choose **GitHub Actions**. Every push to `main` then runs the tests and publishes the app to `https://<user>.github.io/Tumbadosmith/`. Open that URL in Safari, then tap **Share → Add to Home Screen** to run it fullscreen like an app.

**B. Local HTTPS dev server.**

```bash
npm run dev:https    # prints https://<your-computer-ip>:5173
```

Open that address in Safari on the iPad, on the same Wi-Fi. Safari will warn about the self-signed certificate. Tap **Show Details → visit this website** to continue.

### Connecting the cable

1. Plug the Real Tone Cable into the iPad. USB-C iPads take it directly or through a USB-C to USB-A adapter. Lightning iPads need Apple's *Lightning to USB 3 Camera Adapter*.
2. Plug your guitar or bass into the other end and turn the instrument's volume up.
3. In the app, pick your instrument. Safari asks for microphone permission: allow it. The cable is a standard USB audio input, so iPadOS treats it as a microphone. No driver is needed.
4. If the status pill shows the iPad's built-in mic, choose the cable under **Settings → Audio input**.
5. Tune up, then run **Settings → Latency → Calibrate** once: pick an open string on each click.

The cable is input-only, so the drums and clicks come out of the iPad speaker or headphones. Turn on **Hear my instrument** if you want your playing in the mix too. Expect a little delay on it.

## Development

```bash
npm test             # unit tests: pitch detection, scoring, sessions, full synth→detect→score runs
npm run test:e2e     # Playwright smoke tests in Chromium with a fake microphone
npm run typecheck
npm run build        # production build in dist/
npm run charts       # rebuild src/content/charts/*.json from scripts/build-charts.ts
```

### How detection works

```
cable ─▶ AudioWorklet (src/audio/worklet.ts)
          └─ Analyzer: DC block → low-pass → decimate (24 kHz guitar / 12 kHz bass)
               ├─ YIN pitch every ~10 ms (tracks bass low B 31 Hz … guitar fret 22, 1175 Hz)
               ├─ onset detector (high-frequency energy rise) → separates repeated notes
               └─ chroma filter bank (guitar) → recognizes strummed chords
       ─▶ NoteEventTracker: onsets + stable pitch → "pluck" / "legato" note events
       ─▶ Session + Scorer: latency-compensated, matched to chart targets within ±70 ms (Perfect) / ±150 ms (Good)
```

Code layout:

| Path | What | Portable to Swift |
|---|---|---|
| `src/audio/{yin,analyzer,events,notes,synth}.ts` | Pitch, onset and chord detection | ✅ pure |
| `src/chart/` | Chart types, validation, tuning, timeline, scoring | ✅ pure |
| `src/game/session.ts` | Clock, speed, loops, auto speed-up | ✅ pure |
| `src/game/highway.ts` | Canvas renderer | ✗ |
| `src/audio/{engine,backing,worklet}.ts` | Web Audio plumbing | ✗ |
| `src/ui/` | Screens, i18n, storage | ✗ |

### Chart format

Charts are JSON (`src/content/charts/`). Times are in seconds at 100% speed, and string 1 is the highest-pitched string. Notes at the same time form a chord.

```json
{
  "id": "gtr-ligados",
  "title": { "es": "Ligados", "en": "Hammer-ons & Pull-offs" },
  "instrument": "guitar",
  "tuning": [0, 0, 0, 0, 0, 0],
  "bpm": 90, "timeSig": [4, 4], "difficulty": 2,
  "sections": [{ "name": "Bajando", "start": 0 }],
  "notes": [{ "t": 0, "string": 1, "fret": 5, "dur": 0, "tech": ["hammer"], "slideTo": 7 }]
}
```

You write the riffs in a compact tab notation in `scripts/build-charts.ts`, for example `e 1:5 1:8h 1:5p | q [3:5+1:5] 3:7/9~`. The build checks that every bar adds up to the time signature.

## Known limits (v1)

- Chords are matched by pitch-class profile, not note by note. Strumming the right chord counts, but a single wrong string inside a chord won't be flagged.
- Octave slips are accepted (common on bass harmonics).
- No song import, licensed music, amp simulation or accounts yet.
