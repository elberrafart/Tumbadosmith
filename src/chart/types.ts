// Chart data model. Pure data, no DOM — kept portable for a future Swift port.

export type Instrument = 'guitar' | 'bass';
export type Technique = 'hammer' | 'pull' | 'slide' | 'palm';

export interface ChartNote {
  /** Seconds from chart start (at 100% speed). */
  t: number;
  /** 1 = highest-pitched string. */
  string: number;
  fret: number;
  /** Sustain length in seconds; 0 for a plain pick. */
  dur: number;
  tech?: Technique[];
  /** Destination fret for slides. */
  slideTo?: number;
}

export interface ChartSection {
  name: string;
  start: number;
}

export interface LocalizedText {
  es: string;
  en: string;
}

export interface Chart {
  id: string;
  title: LocalizedText;
  description?: LocalizedText;
  instrument: Instrument;
  /** Semitone offsets per string relative to standard tuning (string 1 first). */
  tuning: number[];
  bpm: number;
  timeSig: [number, number];
  difficulty: 1 | 2 | 3 | 4 | 5;
  sections: ChartSection[];
  notes: ChartNote[];
}
