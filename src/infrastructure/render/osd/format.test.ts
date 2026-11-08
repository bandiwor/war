import { describe, expect, it } from 'vitest';
import { formatClock, formatTimecode } from './format';

describe('OSD formatting', () => {
  it('clock starts at 21:40:00 on the incident night and wraps at midnight', () => {
    expect(formatClock(0)).toBe('21:40:00');
    expect(formatClock(65.9)).toBe('21:41:05');
    expect(formatClock(2 * 3600 + 20 * 60)).toBe('00:00:00');
  });
  it('timecode is HH:MM:SS:FF at 30 fps and clamps negatives', () => {
    expect(formatTimecode(0)).toBe('00:00:00:00');
    expect(formatTimecode(3723.5)).toBe('01:02:03:15');
    expect(formatTimecode(-4)).toBe('00:00:00:00');
  });
});
