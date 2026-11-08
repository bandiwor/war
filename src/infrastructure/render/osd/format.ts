/** Recorder text formatting. In-world date/clock: the incident night, 21:40 start. */
export const IN_WORLD_DATE = '2031-10-14';
export const START_SECONDS = 21 * 3600 + 40 * 60;

export function formatClock(simTime: number): string {
  const total = START_SECONDS + Math.floor(simTime);
  const hh = String(Math.floor(total / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor(total / 60) % 60).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatTimecode(simTime: number, fps = 30): string {
  const t = Math.max(0, simTime);
  const frames = Math.floor((t * fps) % fps);
  const s = Math.floor(t);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}
