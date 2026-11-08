import * as THREE from 'three';
import type { OsdState } from '../postfx/types';
import { IN_WORLD_DATE, formatClock, formatTimecode } from './format';

/**
 * Bodycam recorder overlay drawn with Canvas 2D (system monospace font, no
 * assets). Redrawn only when its text changes (at most once per displayed
 * frame of timecode). In-world date/clock: the incident night, 21:40 start.
 */
export const OSD_WIDTH = 1280;
export const OSD_HEIGHT = 720;
export class OsdCanvas {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private lastKey = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = OSD_WIDTH;
    this.canvas.height = OSD_HEIGHT;
    const g = this.canvas.getContext('2d');
    if (g === null) throw new Error('2D canvas unavailable');
    this.g = g;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
  }

  update(s: OsdState, blinkOn: boolean): void {
    const tc = formatTimecode(s.simTime);
    const key = `${tc}|${String(Math.round(s.battery * 100))}|${String(s.flashlightOn)}|${String(s.signalLost)}|${String(blinkOn)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const g = this.g;
    g.clearRect(0, 0, OSD_WIDTH, OSD_HEIGHT);
    g.font = '600 26px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
    g.textBaseline = 'top';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 3;

    if (blinkOn) {
      g.fillStyle = '#ff2a1f';
      g.beginPath();
      g.arc(52, 51, 10, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f2f2ee';
    g.fillText('REC', 72, 38);
    g.fillText(tc, 150, 38);
    g.textAlign = 'right';
    g.fillText(`${IN_WORLD_DATE}  ${formatClock(s.simTime)}`, OSD_WIDTH - 40, 38);
    g.font = '500 20px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
    g.fillText('WAR-BC03  UNIT 7', OSD_WIDTH - 40, 72);
    g.textAlign = 'left';

    // Battery gauge.
    const bx = 40;
    const by = OSD_HEIGHT - 70;
    g.strokeStyle = '#f2f2ee';
    g.lineWidth = 2;
    g.strokeRect(bx, by, 54, 24);
    g.fillStyle = '#f2f2ee';
    g.fillRect(bx + 54, by + 7, 5, 10);
    g.fillStyle = s.battery < 0.15 ? '#ff3b2b' : '#f2f2ee';
    g.fillRect(bx + 3, by + 3, Math.round(48 * Math.max(0, Math.min(1, s.battery))), 18);
    g.fillStyle = '#f2f2ee';
    g.fillText(`${String(Math.round(s.battery * 100))}%`, bx + 70, by + 2);
    g.fillText(s.flashlightOn ? 'LIGHT ON' : 'LIGHT OFF', bx + 150, by + 2);

    if (s.signalLost) {
      g.textAlign = 'center';
      g.font = '700 34px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
      g.fillStyle = '#ffffff';
      g.fillText('SIGNAL LOST', OSD_WIDTH / 2, OSD_HEIGHT / 2 - 17);
      g.textAlign = 'left';
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
