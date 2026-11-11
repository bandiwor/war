import { describe, expect, it } from 'vitest';
import { bandEnergies, onsetRate, peak } from './analysis';
import { speakerPitch, synthesizeVoice } from './radio-voice';

const SR = 16000;

describe('story voices', () => {
  it('are deterministic, within full scale and as long as the line', () => {
    const a = synthesizeVoice('OVERWATCH', 3, 'radio', SR, 4);
    expect(Array.from(synthesizeVoice('OVERWATCH', 3, 'radio', SR, 4))).toEqual(Array.from(a));
    expect(peak(a)).toBeLessThanOrEqual(1);
    expect(peak(a)).toBeGreaterThan(0.5);
    expect(a.length / SR).toBeCloseTo(3 * 0.85, 1);
    expect(synthesizeVoice('x', 60, 'tape', SR, 1).length / SR).toBe(8);
  });

  it('a radio voice lives in the radio band; a tape is duller', () => {
    const e = bandEnergies(synthesizeVoice('OVERWATCH', 3, 'radio', SR, 1), SR);
    const total = e.reduce((s, v) => s + v, 0);
    const low = (e[0] ?? 0) + (e[1] ?? 0) + (e[2] ?? 0); // < ~180 Hz
    const mid = (e[4] ?? 0) + (e[5] ?? 0) + (e[6] ?? 0); // 500–2000 Hz
    expect(low / total).toBeLessThan(0.1);
    expect(mid / total).toBeGreaterThan(0.4);
    const tape = bandEnergies(synthesizeVoice('OVERWATCH', 3, 'tape', SR, 1), SR);
    const tTotal = tape.reduce((s, v) => s + v, 0);
    expect(((tape[7] ?? 0) + (tape[8] ?? 0)) / tTotal).toBeLessThan(
      ((e[7] ?? 0) + (e[8] ?? 0)) / total + 1e-6,
    );
  });

  it('speaks in syllables, and each speaker has their own pitch', () => {
    const rate = onsetRate(synthesizeVoice('KESTREL-1 (Reyes)', 4, 'tape', SR, 2), SR);
    expect(rate).toBeGreaterThan(1.5);
    expect(rate).toBeLessThan(9);
    expect(speakerPitch('OVERWATCH')).not.toBe(speakerPitch('KESTREL-1 (Reyes)'));
    expect(speakerPitch('WARDEN')).toBeLessThan(speakerPitch('OVERWATCH'));
  });
});
