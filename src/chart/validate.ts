import type { Chart } from './types';

const TECHS = new Set(['hammer', 'pull', 'slide', 'palm']);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isText = (v: unknown) =>
  !!v && typeof v === 'object' && typeof (v as { es: unknown }).es === 'string' && typeof (v as { en: unknown }).en === 'string';

/** Returns a list of problems; empty means the chart is valid. */
export function validateChart(c: unknown): string[] {
  const errs: string[] = [];
  if (!c || typeof c !== 'object') return ['chart is not an object'];
  const ch = c as Partial<Chart>;
  if (typeof ch.id !== 'string' || !/^[a-z0-9-]+$/.test(ch.id)) errs.push('id must be kebab-case');
  if (!isText(ch.title)) errs.push('title needs es and en');
  if (ch.description !== undefined && !isText(ch.description)) errs.push('description needs es and en');
  if (ch.instrument !== 'guitar' && ch.instrument !== 'bass') errs.push('instrument must be guitar or bass');
  const strings = ch.instrument === 'guitar' ? 6 : 5;
  if (!Array.isArray(ch.tuning) || !ch.tuning.every(isNum)) errs.push('tuning must be numbers');
  if (!isNum(ch.bpm) || ch.bpm < 20 || ch.bpm > 320) errs.push('bpm out of range');
  if (!Array.isArray(ch.timeSig) || ch.timeSig.length !== 2 || !ch.timeSig.every(isNum)) errs.push('timeSig must be [n, d]');
  if (!isNum(ch.difficulty) || ch.difficulty < 1 || ch.difficulty > 5) errs.push('difficulty must be 1-5');
  if (!Array.isArray(ch.sections) || ch.sections.length === 0) errs.push('needs at least one section');
  else {
    ch.sections.forEach((s, i) => {
      if (typeof s.name !== 'string' || !isNum(s.start)) errs.push(`section ${i} malformed`);
      if (i > 0 && s.start <= ch.sections![i - 1].start) errs.push(`section ${i} not after previous`);
    });
  }
  if (!Array.isArray(ch.notes) || ch.notes.length === 0) return [...errs, 'needs notes'];
  let last = -Infinity;
  ch.notes.forEach((n, i) => {
    const at = `note ${i}`;
    if (!isNum(n.t) || n.t < 0) errs.push(`${at}: bad time`);
    if (n.t < last) errs.push(`${at}: notes must be sorted by time`);
    last = n.t;
    if (!Number.isInteger(n.string) || n.string < 1 || n.string > strings) errs.push(`${at}: bad string`);
    if (!Number.isInteger(n.fret) || n.fret < 0 || n.fret > 24) errs.push(`${at}: bad fret`);
    if (!isNum(n.dur) || n.dur < 0) errs.push(`${at}: bad dur`);
    if (n.tech && (!Array.isArray(n.tech) || !n.tech.every((t) => TECHS.has(t)))) errs.push(`${at}: unknown technique`);
    if (n.slideTo !== undefined && (!Number.isInteger(n.slideTo) || n.slideTo < 0 || n.slideTo > 24)) errs.push(`${at}: bad slideTo`);
  });
  return errs;
}
