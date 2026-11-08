import type { RoomAcoustics } from '../../domain/audio/acoustics';
import type { AmbientMix } from '../../domain/audio/mix';
import type { DistantKind } from '../../domain/audio/zones';

/** What the soundscape needs from an audio backend (Web Audio in the browser, a recorder in tests). */
export interface AudioPort {
  setListener(x: number, y: number, z: number, yaw: number): void;
  setMix(mix: AmbientMix): void;
  setAcoustics(acoustics: RoomAcoustics): void;
  /** A one-shot far away; `occlusion` already accounts for walls between source and listener. */
  playDistant(
    kind: DistantKind,
    x: number,
    y: number,
    z: number,
    occlusion: { gain: number; cutoffHz: number },
  ): void;
}
