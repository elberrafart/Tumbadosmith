// Canvas renderer for the 3D-perspective note highway.

import type { TargetGroup } from '../chart/timeline';
import type { GroupState, Judgment } from '../chart/scorer';
import type { Chart, ChartNote } from '../chart/types';

/** Colours by string, lowest string first (Rocksmith-style order). */
const STRING_COLORS = ['#ff3b5c', '#ffd23f', '#2fa8ff', '#ff8a1f', '#3dff8b', '#c86bff'];
const LOW_B_COLOR = '#ff5fd2';

export function stringColor(string: number, strings: number): string {
  const fromLow = strings - string; // 0 = lowest string
  if (strings === 5) return fromLow === 0 ? LOW_B_COLOR : STRING_COLORS[fromLow - 1];
  return STRING_COLORS[fromLow] ?? '#fff';
}

export interface HighwayView {
  /** Chart time currently audible. */
  now: number;
  /** Chart seconds visible ahead of the now line. */
  lookahead: number;
  groups: TargetGroup[];
  states: GroupState[];
  chart: Chart;
  strings: number;
  lowStringOnTop: boolean;
  /** Labels for each string, string 1 first. */
  stringLabels: string[];
  loop: { a: number; b: number } | null;
}

interface Effect {
  x: number;
  y: number;
  born: number;
  judgment: Judgment;
  color: string;
}

const DEPTH = 5; // perspective strength: far end is drawn at 1 / (1 + DEPTH) scale

export class Highway {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private camCenter = 3;
  private camWidth = 7;
  private lastNow = 0;
  private effects: Effect[] = [];
  private labels: Record<Judgment, string>;

  constructor(private canvas: HTMLCanvasElement, labels: Record<Judgment, string>) {
    this.ctx = canvas.getContext('2d')!;
    this.labels = labels;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── geometry ──────────────────────────────────────────────
  private get vp() {
    return { x: this.w / 2, y: this.h * 0.04 };
  }
  private get laneTop() {
    return this.h * 0.6;
  }
  private get laneBottom() {
    return this.h * 0.85;
  }
  private get floorY() {
    return this.laneBottom + this.h * 0.05;
  }
  private get fretW() {
    return (this.w * 0.94) / this.camWidth;
  }
  /** Screen x of a fret line at the now plane. */
  private fretX(f: number): number {
    return this.w / 2 + (f - this.camCenter) * this.fretW;
  }
  private laneIndex(string: number, strings: number, lowOnTop: boolean): number {
    return lowOnTop ? strings - string : string - 1;
  }
  private laneY(string: number, v: HighwayView): number {
    const i = this.laneIndex(string, v.strings, v.lowStringOnTop);
    return this.laneTop + (i * (this.laneBottom - this.laneTop)) / Math.max(1, v.strings - 1);
  }
  private scale(d: number): number {
    return 1 / (1 + Math.max(-0.15, d) * DEPTH);
  }
  private project(x: number, y: number, d: number): [number, number, number] {
    const s = this.scale(d);
    const vp = this.vp;
    return [vp.x + (x - vp.x) * s, vp.y + (y - vp.y) * s, s];
  }

  private stringColor(string: number, strings: number): string {
    return stringColor(string, strings);
  }

  /** Visual feedback for a judgment at the now line. */
  flash(group: TargetGroup, judgment: Judgment, v: HighwayView, at: number): void {
    for (const n of group.notes) {
      const x = n.fret === 0 ? this.w / 2 : this.fretX(n.fret - 0.5);
      this.effects.push({ x, y: this.laneY(n.string, v), born: at, judgment, color: this.stringColor(n.string, v.strings) });
      if (judgment !== 'miss') break; // one label per chord
    }
  }

  private updateCamera(v: HighwayView, dt: number): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (const g of v.groups) {
      if (g.t < v.now - 0.1) continue;
      if (g.t > v.now + v.lookahead * 0.75) break;
      for (const n of g.notes) {
        const top = Math.max(n.fret, n.slideTo ?? 0);
        const bottom = Math.min(n.fret, n.slideTo ?? n.fret);
        if (top === 0) continue;
        lo = Math.min(lo, Math.max(1, bottom));
        hi = Math.max(hi, top);
      }
    }
    if (lo === Infinity) return;
    const targetW = Math.min(14, Math.max(6, hi - lo + 3));
    const targetC = (lo + hi) / 2 - 0.5;
    const k = Math.min(1, dt * 2.5);
    this.camWidth += (targetW - this.camWidth) * k;
    this.camCenter += (targetC - this.camCenter) * k;
  }

  render(v: HighwayView, wallTime: number): void {
    const dt = Math.min(0.1, Math.max(0, Math.abs(v.now - this.lastNow)));
    this.lastNow = v.now;
    this.updateCamera(v, dt || 0.016);
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);

    this.drawFloor(v);
    this.drawStrings(v);

    // Far notes first so near ones draw on top.
    const visible: number[] = [];
    for (let i = 0; i < v.groups.length; i++) {
      const g = v.groups[i];
      if (g.t + g.dur < v.now - 0.25) continue;
      if (g.t > v.now + v.lookahead) break;
      visible.push(i);
    }
    for (let k = visible.length - 1; k >= 0; k--) this.drawGroup(v.groups[visible[k]], v.states[visible[k]], v);

    this.drawEffects(wallTime);
  }

  private drawFloor(v: HighwayView): void {
    const c = this.ctx;
    const floorY = this.floorY;
    const firstFret = Math.floor(this.camCenter - this.camWidth / 2) - 1;
    const lastFret = Math.ceil(this.camCenter + this.camWidth / 2) + 1;

    // Fret lanes: highlight slots that have upcoming notes.
    const busy = new Set<number>();
    for (const g of v.groups) {
      if (g.t < v.now) continue;
      if (g.t > v.now + 1.2) break;
      for (const n of g.notes) if (n.fret > 0) busy.add(n.fret);
    }
    for (let f = Math.max(1, firstFret); f <= lastFret; f++) {
      if (!busy.has(f)) continue;
      const [x0, y0] = this.project(this.fretX(f - 1), floorY, 0);
      const [x1] = this.project(this.fretX(f), floorY, 0);
      const [x2, y2] = this.project(this.fretX(f), floorY, 1);
      const [x3] = this.project(this.fretX(f - 1), floorY, 1);
      const grad = c.createLinearGradient(0, y0, 0, y2);
      grad.addColorStop(0, 'rgba(25, 227, 255, 0.16)');
      grad.addColorStop(1, 'rgba(25, 227, 255, 0)');
      c.fillStyle = grad;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y0);
      c.lineTo(x2, y2);
      c.lineTo(x3, y2);
      c.fill();
    }

    // Beat and bar lines.
    const spb = 60 / v.chart.bpm;
    const perBar = v.chart.timeSig[0];
    const left = this.fretX(firstFret);
    const right = this.fretX(lastFret);
    const firstBeat = Math.ceil(v.now / spb);
    for (let b = firstBeat; b * spb < v.now + v.lookahead; b++) {
      const d = (b * spb - v.now) / v.lookahead;
      const [xa, ya, s] = this.project(left, floorY, d);
      const [xb] = this.project(right, floorY, d);
      const bar = ((b % perBar) + perBar) % perBar === 0;
      c.strokeStyle = bar ? `rgba(255, 46, 136, ${0.55 * (1 - d)})` : `rgba(255, 255, 255, ${0.12 * (1 - d)})`;
      c.lineWidth = (bar ? 3 : 1.5) * s;
      c.beginPath();
      c.moveTo(xa, ya);
      c.lineTo(xb, ya);
      c.stroke();
    }

    // Loop markers on the floor.
    if (v.loop) {
      for (const t of [v.loop.a, v.loop.b]) {
        const d = (t - v.now) / v.lookahead;
        if (d < 0 || d > 1) continue;
        const [xa, ya, s] = this.project(left, floorY, d);
        const [xb] = this.project(right, floorY, d);
        c.strokeStyle = 'rgba(255, 204, 51, 0.9)';
        c.lineWidth = 4 * s;
        c.beginPath();
        c.moveTo(xa, ya);
        c.lineTo(xb, ya);
        c.stroke();
      }
    }

    // Fret lines and numbers.
    c.textAlign = 'center';
    c.textBaseline = 'top';
    for (let f = Math.max(0, firstFret); f <= lastFret; f++) {
      const x = this.fretX(f);
      const [x0, y0] = this.project(x, floorY, 0);
      const [x1, y1] = this.project(x, floorY, 1);
      c.strokeStyle = 'rgba(180, 160, 255, 0.28)';
      c.lineWidth = f === 0 ? 4 : 1.5;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
      if (f >= 1) {
        const mid = this.fretX(f - 0.5);
        const inlay = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].includes(f);
        c.fillStyle = busy.has(f) ? '#19e3ff' : inlay ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.4)';
        c.font = `700 ${Math.round(Math.min(22, this.fretW * 0.32))}px system-ui, sans-serif`;
        c.fillText(String(f), mid, floorY + 6);
      }
    }
  }

  private drawStrings(v: HighwayView): void {
    const c = this.ctx;
    const left = this.w * 0.02;
    const right = this.w * 0.98;
    for (let s = 1; s <= v.strings; s++) {
      const y = this.laneY(s, v);
      const gauge = 1 + ((s - 1) / Math.max(1, v.strings - 1)) * 2.5;
      c.strokeStyle = this.stringColor(s, v.strings);
      c.globalAlpha = 0.85;
      c.lineWidth = gauge;
      c.shadowColor = c.strokeStyle;
      c.shadowBlur = 8;
      c.beginPath();
      c.moveTo(left, y);
      c.lineTo(right, y);
      c.stroke();
      c.shadowBlur = 0;
      c.globalAlpha = 1;
      c.fillStyle = this.stringColor(s, v.strings);
      c.font = '700 13px system-ui, sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'bottom';
      c.fillText(v.stringLabels[s - 1] ?? '', left, y - 3);
    }
  }

  private noteX(fret: number): number {
    return fret === 0 ? this.w / 2 : this.fretX(fret - 0.5);
  }

  private drawGroup(g: TargetGroup, st: GroupState, v: HighwayView): void {
    const c = this.ctx;
    const d = (g.t - v.now) / v.lookahead;
    const hit = st.judgment === 'perfect' || st.judgment === 'good';
    const missed = st.judgment === 'miss';
    const fade = d < 0 ? Math.max(0, 1 + d / 0.06) : 1;

    // Sustain tails (drawn for hit notes too while they ring).
    for (const n of g.notes) {
      if (n.dur <= 0) continue;
      const d0 = Math.max(0, d);
      const d1 = (g.t + n.dur - v.now) / v.lookahead;
      if (d1 <= 0) continue;
      const y = this.laneY(n.string, v);
      const steps = 10;
      const half = (this.fretW * 0.16);
      const pts: [number, number, number][] = [];
      for (let k = 0; k <= steps; k++) {
        const dd = d0 + ((Math.min(1, d1) - d0) * k) / steps;
        const progress = n.dur > 0 ? (dd * v.lookahead + v.now - g.t) / n.dur : 0;
        const fret = n.slideTo !== undefined ? n.fret + (n.slideTo - n.fret) * Math.max(0, Math.min(1, progress)) : n.fret;
        pts.push(this.project(this.noteX(fret), y, dd));
      }
      c.fillStyle = this.stringColor(n.string, v.strings);
      c.globalAlpha = missed ? 0.15 : hit ? 0.7 : 0.45;
      c.beginPath();
      pts.forEach(([x, yy, s], k) => (k === 0 ? c.moveTo(x - half * s, yy) : c.lineTo(x - half * s, yy)));
      for (let k = pts.length - 1; k >= 0; k--) c.lineTo(pts[k][0] + half * pts[k][2], pts[k][1]);
      c.fill();
      c.globalAlpha = 1;
    }

    if (hit && d < 0) return; // hit gems vanish into the burst effect
    if (fade <= 0) return;

    // Chord frame behind the gems.
    if (g.isChord) {
      const ys = g.notes.map((n) => this.laneY(n.string, v));
      const xs = g.notes.map((n) => this.noteX(n.fret));
      const pad = this.fretW * 0.45;
      const [x0, y0, s] = this.project(Math.min(...xs) - pad, Math.min(...ys) - 14, d);
      const [x1, y1] = this.project(Math.max(...xs) + pad, Math.max(...ys) + 14, d);
      c.globalAlpha = fade * (missed ? 0.3 : 1);
      c.fillStyle = 'rgba(255, 255, 255, 0.07)';
      c.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      c.lineWidth = 2 * s;
      roundRect(c, x0, y0, x1 - x0, y1 - y0, 8 * s);
      c.fill();
      c.stroke();
      c.globalAlpha = 1;
    }

    // Technique labels once per chord, on its top gem.
    const top = g.isChord ? g.notes.reduce((a, b) => (this.laneY(a.string, v) < this.laneY(b.string, v) ? a : b)) : g.notes[0];
    for (const n of g.notes) this.drawGem(n, n === top, d, fade, missed, v);
  }

  private drawGem(n: ChartNote, showTech: boolean, d: number, fade: number, missed: boolean, v: HighwayView): void {
    const c = this.ctx;
    const y0 = this.laneY(n.string, v);
    const color = missed ? '#5a5566' : this.stringColor(n.string, v.strings);
    const laneGap = (this.laneBottom - this.laneTop) / Math.max(1, v.strings - 1);
    c.globalAlpha = fade;

    if (n.fret === 0) {
      // Open string: a bar across the visible window.
      const [xa, y, s] = this.project(this.fretX(this.camCenter - this.camWidth / 2 + 0.3), y0, d);
      const [xb] = this.project(this.fretX(this.camCenter + this.camWidth / 2 - 0.3), y0, d);
      const hh = laneGap * 0.32 * s;
      c.fillStyle = color;
      c.globalAlpha = fade * 0.75;
      roundRect(c, xa, y - hh / 2, xb - xa, hh, hh / 2);
      c.fill();
      c.globalAlpha = fade;
      this.gemLabel('0', (xa + xb) / 2, y, s, laneGap);
      const tech = showTech ? techLabel(n) : '';
      if (tech) {
        c.fillStyle = '#ffffff';
        c.font = `800 ${Math.max(9, Math.round(laneGap * 0.36 * s))}px system-ui, sans-serif`;
        c.textBaseline = 'bottom';
        c.fillText(tech, (xa + xb) / 2, y - hh / 2 - 2 * s);
      }
    } else {
      const [x, y, s] = this.project(this.noteX(n.fret), y0, d);
      // Drop line and floor shadow: shows which string a far-away gem belongs to.
      if (d > 0.02) {
        const [fx, fy] = this.project(this.noteX(n.fret), this.floorY, d);
        c.strokeStyle = color;
        c.globalAlpha = fade * 0.45;
        c.lineWidth = Math.max(1, 3 * s);
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(fx, fy);
        c.stroke();
        c.fillStyle = color;
        c.beginPath();
        c.ellipse(fx, fy, this.fretW * 0.3 * s, 4 * s, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = fade;
      }
      const gw = this.fretW * 0.72 * s;
      const gh = laneGap * 0.62 * s;
      c.shadowColor = color;
      c.shadowBlur = missed ? 0 : 14 * s;
      c.fillStyle = color;
      roundRect(c, x - gw / 2, y - gh / 2, gw, gh, gh * 0.3);
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 2 * s;
      c.stroke();
      this.gemLabel(String(n.fret), x, y, s, laneGap);

      const tech = showTech ? techLabel(n) : '';
      if (tech) {
        c.fillStyle = '#ffffff';
        c.font = `800 ${Math.max(9, Math.round(laneGap * 0.36 * s))}px system-ui, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'bottom';
        c.fillText(tech, x, y - gh / 2 - 2 * s);
      }
    }
    c.globalAlpha = 1;
  }

  private gemLabel(text: string, x: number, y: number, s: number, laneGap: number): void {
    const c = this.ctx;
    c.fillStyle = '#0b0710';
    c.font = `900 ${Math.max(8, Math.round(laneGap * 0.44 * s))}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, x, y + 1);
  }

  private drawEffects(wall: number): void {
    const c = this.ctx;
    this.effects = this.effects.filter((e) => wall - e.born < 0.7);
    for (const e of this.effects) {
      const age = (wall - e.born) / 0.7;
      if (e.judgment === 'miss') {
        c.strokeStyle = `rgba(255, 59, 92, ${1 - age})`;
        c.lineWidth = 3;
        const r = 10;
        c.beginPath();
        c.moveTo(e.x - r, e.y - r);
        c.lineTo(e.x + r, e.y + r);
        c.moveTo(e.x + r, e.y - r);
        c.lineTo(e.x - r, e.y + r);
        c.stroke();
        continue;
      }
      c.strokeStyle = e.color;
      c.globalAlpha = 1 - age;
      c.lineWidth = 4 * (1 - age) + 1;
      c.beginPath();
      c.arc(e.x, e.y, 12 + age * 46, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = e.judgment === 'perfect' ? '#ffcc33' : '#ffffff';
      c.font = `900 ${e.judgment === 'perfect' ? 24 : 20}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      c.fillText(this.labels[e.judgment], e.x, e.y - 24 - age * 40);
      c.globalAlpha = 1;
    }
  }
}

function techLabel(n: ChartNote): string {
  if (!n.tech) return '';
  const parts: string[] = [];
  if (n.tech.includes('hammer')) parts.push('H');
  if (n.tech.includes('pull')) parts.push('P');
  if (n.tech.includes('palm')) parts.push('PM');
  if (n.tech.includes('slide') && n.slideTo !== undefined) parts.push(n.slideTo > n.fret ? '↗' : '↘');
  return parts.join(' ');
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}
