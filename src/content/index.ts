import type { Chart, Instrument } from '../chart/types';

const modules = import.meta.glob<Chart>('./charts/*.json', { eager: true, import: 'default' });

export const CHARTS: Chart[] = Object.values(modules).sort(
  (a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id),
);

export const chartsFor = (instrument: Instrument): Chart[] => CHARTS.filter((c) => c.instrument === instrument);
export const chartById = (id: string): Chart | undefined => CHARTS.find((c) => c.id === id);
