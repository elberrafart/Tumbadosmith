// AudioWorklet wrapper around the pure Analyzer. Bundled on its own via `?worker&url`.

import { Analyzer, type AnalyzerMessage } from './analyzer';
import type { Instrument } from '../chart/types';

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

export type WorkletCommand =
  | { type: 'config'; instrument: Instrument }
  | { type: 'gate'; db: number };

class TumbadoAnalyzerProcessor extends AudioWorkletProcessor {
  private analyzer = new Analyzer(sampleRate, 'guitar');
  private gateDb = -50;
  private out: AnalyzerMessage[] = [];

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<WorkletCommand>) => {
      const cmd = e.data;
      if (cmd.type === 'config') {
        this.analyzer = new Analyzer(sampleRate, cmd.instrument);
        this.analyzer.setGateDb(this.gateDb);
      } else if (cmd.type === 'gate') {
        this.gateDb = cmd.db;
        this.analyzer.setGateDb(cmd.db);
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) {
      this.analyzer.process(channel, currentTime, this.out);
      if (this.out.length) {
        this.port.postMessage(this.out);
        this.out = [];
      }
    }
    return true;
  }
}

registerProcessor('tumbado-analyzer', TumbadoAnalyzerProcessor);
