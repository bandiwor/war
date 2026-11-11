import type { GameEvents } from '../../domain/events/bus';
import type { AudioEngine } from './audio-engine';
import { synthesizeVoice, type VoiceChannel } from './dsp/radio-voice';

/**
 * Plays the story's lines as voices: radio calls on the chest radio, audio
 * logs and recordings as worn tape. Head-locked (the radio is on you),
 * slightly right, almost dry. Each line is synthesised once and cached.
 */
export class StoryAudio {
  private readonly cache = new Map<string, AudioBuffer>();
  played = 0;

  constructor(
    private readonly engine: AudioEngine,
    private readonly seed: number,
  ) {}

  consume(events: GameEvents): void {
    for (let i = 0; i < events.story.size; i++) {
      const note = events.story.at(i)?.note;
      if (note?.kind !== 'line') continue;
      const channel: VoiceChannel = note.source === 'radio' ? 'radio' : 'tape';
      const key = `${channel}|${note.line.speaker}|${note.line.text}`;
      let buffer = this.cache.get(key);
      if (buffer === undefined) {
        buffer = this.engine.toBuffer(
          synthesizeVoice(
            note.line.speaker,
            note.line.seconds,
            channel,
            this.engine.context.sampleRate,
            this.seed + this.cache.size,
          ),
        );
        this.cache.set(key, buffer);
      }
      this.engine.playLocal(buffer, channel === 'radio' ? 0.55 : 0.7, 1, 0.15, 0.05);
      this.played++;
    }
  }
}
