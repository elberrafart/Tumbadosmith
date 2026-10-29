// Builds src/content/charts/*.json from a compact tab notation.
// Run: npm run charts   (Node >= 22.18 runs this TypeScript directly)
//
// Notation, space-separated:
//   w h q e s t x   set the step: whole, half, quarter, eighth, sixteenth,
//                   triplet eighth (1/3 beat), triplet sixteenth (1/6 beat)
//   S:F             a note on string S (1 = highest) at fret F
//     modifiers:    h hammer-on, p pull-off, pm palm mute, ~ sustain, /N slide to fret N
//   [S:F+S:F]       a chord; modifiers after ']' apply to every note
//   r               rest      |  bar line (ignored, for readability)
// All original material written for Tumbadosmith in a corridos tumbados style.

import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Tech = 'hammer' | 'pull' | 'slide' | 'palm';
interface Note { t: number; string: number; fret: number; dur: number; tech?: Tech[]; slideTo?: number }
interface Riff {
  id: string;
  title: { es: string; en: string };
  description: { es: string; en: string };
  instrument: 'guitar' | 'bass';
  bpm: number;
  timeSig: [number, number];
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** [name, bar index] */
  sections: [string, number][];
  tab: string;
}

const STEPS: Record<string, number> = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 1 / 3, x: 1 / 6 };
const round = (v: number) => Math.round(v * 10000) / 10000;

function parseNote(tok: string, mods: string, beat: number, step: number, spb: number): Note {
  const m = /^(\d):(\d+)$/.exec(tok);
  if (!m) throw new Error(`bad note "${tok}"`);
  const note: Note = { t: round(beat * spb), string: Number(m[1]), fret: Number(m[2]), dur: 0 };
  const tech: Tech[] = [];
  let rest = mods;
  if (rest.includes('pm')) { tech.push('palm'); rest = rest.replace('pm', ''); }
  const slide = /\/(\d+)/.exec(rest);
  if (slide) { note.slideTo = Number(slide[1]); tech.push('slide'); rest = rest.replace(slide[0], ''); }
  const sustain = rest.includes('~');
  rest = rest.replace('~', '');
  if (rest.includes('h')) tech.push('hammer');
  if (rest.includes('p')) tech.push('pull');
  if (sustain || slide) note.dur = round(step * spb * 0.85);
  if (tech.length) note.tech = tech;
  return note;
}

function parseTab(tab: string, bpm: number, beatsPerBar: number, id: string): Note[] {
  const spb = 60 / bpm;
  let bar = 0;
  let beat = 0;
  let step = 1;
  const notes: Note[] = [];
  for (const tok of tab.trim().split(/\s+/)) {
    if (tok === '|') {
      bar++;
      if (Math.abs(beat - bar * beatsPerBar) > 1e-6) throw new Error(`${id}: bar ${bar} ends on beat ${round(beat)}, expected ${bar * beatsPerBar}`);
      continue;
    }
    if (tok in STEPS) { step = STEPS[tok]; continue; }
    if (tok === 'r') { beat += step; continue; }
    if (tok.startsWith('[')) {
      const close = tok.indexOf(']');
      const mods = tok.slice(close + 1);
      for (const part of tok.slice(1, close).split('+')) notes.push(parseNote(part, mods, beat, step, spb));
    } else {
      const m = /^(\d:\d+)(.*)$/.exec(tok);
      if (!m) throw new Error(`bad token "${tok}"`);
      notes.push(parseNote(m[1], m[2], beat, step, spb));
    }
    beat += step;
  }
  if (Math.abs(beat / beatsPerBar - Math.round(beat / beatsPerBar)) > 1e-6) throw new Error(`${id}: last bar is incomplete (${round(beat)} beats)`);
  return notes;
}

const RIFFS: Riff[] = [
  // ───────────── Guitar ─────────────
  {
    id: 'gtr-escala-la-menor', instrument: 'guitar', bpm: 90, timeSig: [3, 4], difficulty: 1,
    title: { es: 'Escala de La menor', en: 'A Minor Scale' },
    description: { es: 'Sube en La menor natural y baja con el Sol# de la menor armónica, el sonido clásico del requinto.', en: 'Up A natural minor, back down with the harmonic-minor G#, the classic requinto sound.' },
    sections: [['Subida', 0], ['Bajada', 4]],
    tab: `q 6:5 6:7 6:8 | 5:5 5:7 5:8 | 4:5 4:7 3:4 | h 3:5~ q r |
          q 3:5 3:4 4:7 | 4:6 5:8 5:7 | 5:5 6:8 6:7 | h 6:5~ q r`,
  },
  {
    id: 'gtr-terceras-requinto', instrument: 'guitar', bpm: 100, timeSig: [3, 4], difficulty: 2,
    title: { es: 'Terceras de requinto', en: 'Requinto Thirds' },
    description: { es: 'Dobles cuerdas en terceras sobre la 1ª y 2ª cuerda. Toca las dos notas juntas.', en: 'Double stops in thirds on strings 1 and 2. Pick both notes together.' },
    sections: [['Arriba', 0], ['Abajo', 4]],
    tab: `q [2:10+1:8] [2:12+1:10] [2:13+1:12] | h [2:15+1:13]~ q [2:13+1:12] |
          q [2:12+1:10] [2:10+1:8] [2:9+1:7] | h [2:10+1:8]~ q r |
          e [2:10+1:8] [2:9+1:7] q [2:6+1:5] [2:5+1:4] | q [2:6+1:5] e [2:9+1:7] [2:10+1:8] q [2:12+1:10] |
          q [2:6+1:5] [2:5+1:4] [2:9+1:7] | h [2:10+1:8]~ q r`,
  },
  {
    id: 'gtr-ligados', instrument: 'guitar', bpm: 90, timeSig: [4, 4], difficulty: 2,
    title: { es: 'Ligados', en: 'Hammer-ons & Pull-offs' },
    description: { es: 'Púa solo en la primera nota de cada grupo; las demás salen con la mano izquierda.', en: 'Pick only the first note of each group; the fretting hand does the rest.' },
    sections: [['Bajando', 0], ['Subiendo', 2]],
    tab: `e 1:5 1:8h 1:5p 2:8 2:5 2:8h 2:5p 3:7 | e 3:5 3:7h 3:5p 4:7 4:5 4:7h q 4:5p~ |
          e 4:5 4:7h 3:5 3:7h 2:5 2:8h 1:5 1:8h | e 1:8 1:5p 2:8 2:5p h 3:5~`,
  },
  {
    id: 'gtr-armonia-tumbada', instrument: 'guitar', bpm: 95, timeSig: [3, 4], difficulty: 2,
    title: { es: 'Armonía tumbada', en: 'Tumbado Rhythm' },
    description: { es: 'Bajo en el 1 y acordes apagados con la palma. Lam – Sol – Fa – Mi.', en: 'Bass note on 1, palm-muted chords after. Am – G – F – E.' },
    sections: [['Vuelta 1', 0], ['Vuelta 2', 4]],
    tab: `q 5:0 e [4:2+3:2+2:1+1:0]pm [4:2+3:2+2:1+1:0]pm [4:2+3:2+2:1+1:0]pm [4:2+3:2+2:1+1:0]pm |
          q 6:3 e [4:0+3:0+2:0+1:3]pm [4:0+3:0+2:0+1:3]pm [4:0+3:0+2:0+1:3]pm [4:0+3:0+2:0+1:3]pm |
          q 6:1 e [4:3+3:2+2:1+1:1]pm [4:3+3:2+2:1+1:1]pm [4:3+3:2+2:1+1:1]pm [4:3+3:2+2:1+1:1]pm |
          q 6:0 e [4:2+3:1+2:0+1:0]pm [4:2+3:1+2:0+1:0]pm [4:2+3:1+2:0+1:0]pm [4:2+3:1+2:0+1:0]pm |
          q 5:0 e [4:2+3:2+2:1+1:0]pm [4:2+3:2+2:1+1:0]pm [4:2+3:2+2:1+1:0]pm [4:2+3:2+2:1+1:0]pm |
          q 6:1 e [4:3+3:2+2:1+1:1]pm [4:3+3:2+2:1+1:1]pm [4:3+3:2+2:1+1:1]pm [4:3+3:2+2:1+1:1]pm |
          q 6:0 e [4:2+3:1+2:0+1:0]pm [4:2+3:1+2:0+1:0]pm [4:2+3:1+2:0+1:0]pm [4:2+3:1+2:0+1:0]pm |
          q 5:0 h [5:0+4:2+3:2+2:1+1:0]~`,
  },
  {
    id: 'gtr-corrida-tresillos', instrument: 'guitar', bpm: 80, timeSig: [3, 4], difficulty: 3,
    title: { es: 'Corrida en tresillos', en: 'Triplet Run' },
    description: { es: 'Bajada en grupos de tres por La menor armónica, luego arpegios de Lam y Mi.', en: 'A descending run in groups of three through A harmonic minor, then Am and E arpeggios.' },
    sections: [['Corrida', 0], ['Arpegios', 4]],
    tab: `t 1:8 1:7 1:5 1:7 1:5 1:4 1:5 1:4 2:6 | 1:4 2:6 2:5 2:6 2:5 3:7 2:5 3:7 3:5 |
          t 3:7 3:5 3:4 3:5 3:4 4:7 3:4 4:7 4:6 | h 4:7~ q r |
          t 6:5 5:7 4:7 3:5 2:5 1:5 1:8 1:5 2:5 | t 5:7 4:6 3:4 2:5 1:4 1:7 1:4 2:5 3:4 |
          t 5:7 4:7 3:5 2:5 1:5 1:8 1:7 1:5 1:4 | h 1:5~ q r`,
  },
  {
    id: 'gtr-deslizamientos', instrument: 'guitar', bpm: 100, timeSig: [4, 4], difficulty: 4,
    title: { es: 'Deslizamientos y sextas', en: 'Slides & Sixths' },
    description: { es: 'Cambios de posición con slides y luego sextas en 1ª y 3ª cuerda, muy de requinto.', en: 'Position shifts with slides, then sixths on strings 1 and 3, a requinto staple.' },
    sections: [['Slides', 0], ['Sextas', 4]],
    tab: `e 2:5 2:6 q 2:8/10 e 1:8 1:10 q 1:12~ | e 1:13 1:12 1:10 2:13 2:12 2:10 q 3:13 |
          q 3:14 e 3:12 3:14 q 2:10/13 e 2:12 2:10 | q 3:13 h 3:14/9 q r |
          q [3:5+1:5] [3:7+1:7] [3:9+1:8] [3:10+1:10] | h [3:13+1:12]~ q [3:14+1:13] [3:13+1:12] |
          q [3:10+1:10] [3:9+1:8] [3:7+1:7] [3:4+1:4] | h [3:5+1:5]~ q 5:0 r`,
  },
  // ───────────── Bass ─────────────
  {
    id: 'bajo-raiz-quinta', instrument: 'bass', bpm: 100, timeSig: [2, 4], difficulty: 1,
    title: { es: 'Raíz y quinta', en: 'Root & Fifth' },
    description: { es: 'El pulso del corrido: raíz en el 1, quinta en el 2. Lam – Mi – Rem – Mi – Lam.', en: 'The corrido pulse: root on 1, fifth on 2. Am – E – Dm – E – Am.' },
    sections: [['A', 0], ['B', 4]],
    tab: `q 3:0 4:0 | 3:0 4:0 | 4:0 3:2 | 4:0 3:2 | 2:0 3:0 | 2:0 3:0 | 4:0 3:2 | h 3:0~`,
  },
  {
    id: 'bajo-caminando', instrument: 'bass', bpm: 100, timeSig: [2, 4], difficulty: 2,
    title: { es: 'Caminando al acorde', en: 'Walking to the Chord' },
    description: { es: 'Caminados cromáticos que llevan de un acorde al otro, como el tololoche.', en: 'Chromatic walk-ups that lead from chord to chord, tololoche style.' },
    sections: [['Lam a Rem', 0], ['Rem a Lam', 5]],
    tab: `q 3:0 4:0 | 3:0 4:0 | e 3:0 3:2 3:3 3:4 | q 2:0 3:0 | 2:0 3:0 |
          e 2:0 2:1 q 2:2 | q 2:2 3:2 | e 4:0 4:2 4:3 4:4 | h 3:0~`,
  },
  {
    id: 'bajo-tumbado-34', instrument: 'bass', bpm: 95, timeSig: [3, 4], difficulty: 2,
    title: { es: 'Tumbado en 3/4', en: 'Tumbado in 3/4' },
    description: { es: 'Raíz, quinta y octava sobre Lam – Sol – Fa – Mi. Va con «Armonía tumbada».', en: 'Root, fifth and octave over Am – G – F – E. Fits with "Tumbado Rhythm".' },
    sections: [['Básico', 0], ['Variación', 4]],
    tab: `q 3:0 2:2 1:2 | 4:3 2:0 1:0 | 4:1 3:3 2:3 | 4:0 3:2 2:2 |
          q 3:0 e 2:2 3:0 q 1:2 | q 4:3 e 2:0 4:3 q 1:0 | q 4:1 e 3:3 4:1 q 2:3 | q 4:0 e 3:2 2:1 q 2:2 | h 3:0~ q r`,
  },
  {
    id: 'bajo-ligados', instrument: 'bass', bpm: 90, timeSig: [4, 4], difficulty: 3,
    title: { es: 'Ligados en el bajo', en: 'Bass Legato' },
    description: { es: 'Hammer-ons, pull-offs y slides en La menor. Deja que suene cada nota.', en: 'Hammer-ons, pull-offs and slides in A minor. Let every note ring.' },
    sections: [['A', 0], ['B', 2]],
    tab: `e 3:0 3:2h 3:3h 2:0 2:2 2:0p 3:3 3:2p | q 3:0 3:5/7 e 2:5 2:7h q 2:5p |
          e 1:2 1:4h 1:5h 1:4p 1:2p 2:5 2:7h 2:5p | q 2:3 2:2 h 3:0~`,
  },
  {
    id: 'bajo-arpegios', instrument: 'bass', bpm: 100, timeSig: [3, 4], difficulty: 3,
    title: { es: 'Arpegios menores', en: 'Minor Arpeggios' },
    description: { es: 'Arpegios de Lam, Rem y Mi en corcheas, luego dos octavas.', en: 'Am, Dm and E arpeggios in eighths, then across two octaves.' },
    sections: [['Una octava', 0], ['Dos octavas', 4]],
    tab: `e 3:0 2:2 1:2 1:5 1:2 2:2 | 2:0 2:3 1:2 1:7 1:2 2:3 | 4:0 3:2 2:2 1:1 2:2 3:2 | 3:0 2:2 1:2 1:5 1:2 2:2 |
          e 3:0 3:3 2:2 1:2 1:5 1:9 | 1:9 1:5 1:2 2:2 3:3 3:0 | 4:0 4:4 3:2 2:0 2:2 1:1 | h 3:0~ q r`,
  },
  {
    id: 'bajo-corrida-tololoche', instrument: 'bass', bpm: 110, timeSig: [2, 4], difficulty: 4,
    title: { es: 'Corrida de tololoche', en: 'Tololoche Run' },
    description: { es: 'Semicorcheas cromáticas. Empieza al 60% en modo práctica y deja que suba la velocidad.', en: 'Chromatic sixteenths. Start at 60% in practice mode and let the speed climb.' },
    sections: [['Corrida', 0], ['Remate', 4]],
    tab: `s 3:0 3:2 3:3 3:4 2:0 2:2 2:3 2:5 | 1:2 1:3 1:2 2:5 2:3 2:2 2:0 3:4 | e 2:0 3:0 2:0 2:2 |
          s 2:3 2:2 2:0 3:4 3:3 3:2 3:0 4:4 | q 3:0 4:0 | s 4:0 4:1 4:2 4:3 4:4 3:0 3:1 3:2 |
          s 3:3 3:2 3:3 3:4 e 2:0 2:2 | e 4:0 4:4 q 3:0~`,
  },
];

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'src', 'content', 'charts');
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith('.json')) unlinkSync(join(outDir, f));

for (const r of RIFFS) {
  const strings = r.instrument === 'guitar' ? 6 : 4;
  const barSec = (60 / r.bpm) * r.timeSig[0];
  const chart = {
    id: r.id,
    title: r.title,
    description: r.description,
    instrument: r.instrument,
    tuning: new Array(strings).fill(0),
    bpm: r.bpm,
    timeSig: r.timeSig,
    difficulty: r.difficulty,
    sections: r.sections.map(([name, bar]) => ({ name, start: round(bar * barSec) })),
    notes: parseTab(r.tab, r.bpm, r.timeSig[0], r.id),
  };
  writeFileSync(join(outDir, `${r.id}.json`), JSON.stringify(chart, null, 1) + '\n');
  console.log(`${r.id}: ${chart.notes.length} notes`);
}
