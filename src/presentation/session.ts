import type { ReplayRecorder } from '../application/replay/replay';
import { formatReplay, parseReplay, type Replay } from '../application/replay/replay';
import type { Sandbox } from '../application/scenes/sandbox';
import type { AudioEngine } from '../infrastructure/audio/audio-engine';
import type { FootstepPlayer } from '../infrastructure/audio/footstep-player';

/** Storage key for a replay handed from the debug menu to the next page load. */
export const SESSION_REPLAY_KEY = 'war.replay';

/**
 * The running game as the debug tools see it. Every live session records its
 * input from tick 0 (a cheap "black box"), so any bug can be saved as a replay
 * and reproduced exactly.
 */
export interface GameSession {
  readonly sandbox: Sandbox;
  readonly recorder: ReplayRecorder | null;
  readonly playing: Replay | null;
  readonly audio: AudioEngine | null;
  readonly footsteps: FootstepPlayer | null;
  footstepCount: number;
}

export function downloadReplay(session: GameSession): void {
  if (session.recorder === null) return;
  const text = formatReplay(session.recorder.finish());
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `war-${String(session.sandbox.simulation.seed)}-t${String(session.sandbox.simulation.tick)}.replay.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Validates a replay file, stores it, and reloads into playback mode. */
export async function playReplayFile(file: File): Promise<void> {
  const replay = parseReplay(JSON.parse(await file.text()));
  storeAndPlay(formatReplay(replay));
}

export function storeAndPlay(replayText: string): void {
  try {
    sessionStorage.setItem(SESSION_REPLAY_KEY, replayText);
  } catch {
    throw new Error('Replay too large for session storage');
  }
  const url = new URL(window.location.href);
  url.searchParams.set('replay', 'session');
  window.location.href = url.toString();
}

export function loadSessionReplay(): Replay | null {
  try {
    const text = sessionStorage.getItem(SESSION_REPLAY_KEY);
    return text === null ? null : parseReplay(JSON.parse(text));
  } catch (error) {
    console.warn('Ignoring invalid session replay', error);
    return null;
  }
}
