// Browser audio plumbing: cable input → analyzer worklet, monitoring, and an
// output bus for backing tracks and the demo player. Not part of the portable core.

import workletUrl from './worklet.ts?worker&url';
import type { AnalyzerMessage } from './analyzer';
import type { WorkletCommand } from './worklet';
import type { Instrument } from '../chart/types';

export type MicState = 'off' | 'on' | 'denied' | 'unsupported' | 'error';
type Listener = (msgs: AnalyzerMessage[]) => void;

export class AudioEngine {
  ctx: AudioContext | null = null;
  /** Fires 'mic' whenever micState changes. */
  readonly events = new EventTarget();
  private _micState: MicState = 'off';
  deviceLabel = '';
  /** Backing tracks and clicks go here. */
  music!: GainNode;
  /** Synthesized demo notes go here; they reach the analyzer and the speakers. */
  demoBus!: GainNode;
  private node: AudioWorkletNode | null = null;
  private input!: GainNode;
  private monitor!: GainNode;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private listeners = new Set<Listener>();
  private instrument: Instrument = 'guitar';
  private gateDb = -50;
  private starting: Promise<AudioContext> | null = null;

  get micState(): MicState {
    return this._micState;
  }

  set micState(s: MicState) {
    this._micState = s;
    this.events.dispatchEvent(new Event('mic'));
  }

  /** Must first be called from a user gesture (iPad Safari only starts audio on a tap). */
  ensureContext(): Promise<AudioContext> {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume();
      return Promise.resolve(this.ctx);
    }
    if (this.starting) return this.starting;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    void ctx.resume();
    // iOS 16.4+: keep the input route alive while playing back.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'play-and-record';
    this.starting = this.setup(ctx);
    return this.starting;
  }

  private async setup(ctx: AudioContext): Promise<AudioContext> {
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'tumbado-analyzer', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e: MessageEvent<AnalyzerMessage[]>) => this.listeners.forEach((l) => l(e.data));
    this.input = ctx.createGain();
    this.monitor = ctx.createGain();
    this.monitor.gain.value = 0;
    this.music = ctx.createGain();
    this.demoBus = ctx.createGain();
    const sink = ctx.createGain();
    sink.gain.value = 0; // the analyzer must be pulled by the graph, but stays silent
    this.input.connect(node);
    this.input.connect(this.monitor).connect(ctx.destination);
    this.demoBus.connect(node);
    this.demoBus.connect(ctx.destination);
    this.music.connect(ctx.destination);
    node.connect(sink).connect(ctx.destination);
    this.node = node;
    this.ctx = ctx;
    this.post({ type: 'config', instrument: this.instrument });
    this.post({ type: 'gate', db: this.gateDb });
    return ctx;
  }

  private post(cmd: WorkletCommand): void {
    this.node?.port.postMessage(cmd);
  }

  async startMic(deviceId: string | null): Promise<MicState> {
    await this.ensureContext();
    if (!navigator.mediaDevices?.getUserMedia) return (this.micState = 'unsupported');
    this.stopMic();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          // Voice processing wrecks instrument signals; turn all of it off.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      const name = (err as DOMException).name;
      // A remembered device that is no longer plugged in: fall back to the default.
      if (deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) return this.startMic(null);
      return (this.micState = name === 'NotAllowedError' ? 'denied' : 'error');
    }
    const track = this.stream.getAudioTracks()[0];
    this.deviceLabel = track?.label ?? '';
    this.source = this.ctx!.createMediaStreamSource(this.stream);
    this.source.connect(this.input);
    return (this.micState = 'on');
  }

  stopMic(): void {
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source = null;
    this.stream = null;
    if (this.micState === 'on') this.micState = 'off';
  }

  get activeDeviceId(): string | null {
    return this.stream?.getAudioTracks()[0]?.getSettings().deviceId ?? null;
  }

  async listInputs(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  setInstrument(instrument: Instrument): void {
    this.instrument = instrument;
    this.post({ type: 'config', instrument });
  }

  setGateDb(db: number): void {
    this.gateDb = db;
    this.post({ type: 'gate', db });
  }

  setInputGain(gain: number): void {
    if (this.input) this.input.gain.value = gain;
  }

  setMonitor(on: boolean, volume: number): void {
    if (this.monitor) this.monitor.gain.value = on ? volume : 0;
  }

  setMusicVolume(volume: number): void {
    if (this.music) this.music.gain.value = volume;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Time from scheduling a sound to it leaving the speaker, seconds. */
  get outputLatency(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  }
}

export const engine = new AudioEngine();
