import type { Presenter } from '../application/loop/ports';
import type { Simulation } from '../application/simulation';

/**
 * Placeholder presenter for stage 0: draws the bodycam on-screen display as
 * DOM text. Replaced by the WebGL renderer in stage 1.
 */
export class OsdPresenter implements Presenter {
  private readonly osd: HTMLElement;
  private lastRenderedTick = -1;

  constructor(
    root: HTMLElement,
    private readonly simulation: Simulation,
  ) {
    this.osd = document.createElement('div');
    this.osd.className = 'osd';
    this.osd.dataset['testid'] = 'osd';
    root.append(this.osd);
  }

  present(_alpha: number): void {
    const t = this.simulation.tick;
    if (t === this.lastRenderedTick) return;
    this.lastRenderedTick = t;
    this.osd.dataset['tick'] = String(t);
    const seconds = Math.floor(t / this.simulation.tickRate);
    const frames = t % this.simulation.tickRate;
    const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const mm = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    const ff = String(frames).padStart(2, '0');
    this.osd.textContent = `● REC  ${hh}:${mm}:${ss}:${ff}  WAR`;
  }
}
