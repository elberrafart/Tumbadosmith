export const freqToMidi = (f: number): number => 69 + 12 * Math.log2(f / 440);
export const midiToFreq = (m: number): number => 440 * 2 ** ((m - 69) / 12);

const LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOLFEGE = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

export type NoteNaming = 'letter' | 'solfege';

export function noteName(midi: number, naming: NoteNaming = 'letter', withOctave = true): string {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const name = (naming === 'solfege' ? SOLFEGE : LETTERS)[pc];
  return withOctave ? name + (Math.floor(m / 12) - 1) : name;
}

/** Nearest semitone and how far off it is, in cents. */
export function centsOff(freq: number): { midi: number; cents: number } {
  const exact = freqToMidi(freq);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100 };
}
