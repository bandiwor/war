import type { GameLoop } from '../../application/loop/game-loop';
import type { Simulation } from '../../application/simulation';

/** Marker string checked by scripts/check-bundle.mjs to prove tree-shaking. */
export const DEBUG_MENU_MARKER = 'WAR_DEBUG_MENU';

export interface DebugMenuDeps {
  readonly root: HTMLElement;
  readonly simulation: Simulation;
  readonly loop: GameLoop;
}

/**
 * Minimal stage-0 debug panel (toggle with `~`): tick, state hash, pause and
 * single-step. Later stages register more panels here.
 */
export function installDebugMenu({ root, simulation, loop }: DebugMenuDeps): void {
  const panel = document.createElement('div');
  panel.className = 'debug-menu';
  panel.dataset['testid'] = 'debug-menu';
  panel.dataset['marker'] = DEBUG_MENU_MARKER;
  panel.hidden = true;

  const info = document.createElement('pre');
  const pause = button('Pause', () => {
    loop.setPaused(!loop.isPaused);
    pause.textContent = loop.isPaused ? 'Resume' : 'Pause';
  });
  const step = button('Step', () => {
    loop.stepOnce();
  });
  panel.append(info, pause, step);
  root.append(panel);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') {
      panel.hidden = !panel.hidden;
      e.preventDefault();
    }
  });

  const refresh = (): void => {
    if (!panel.hidden) {
      info.textContent = [
        `seed   ${String(simulation.seed)}`,
        `tick   ${String(simulation.tick)}`,
        `hash   ${simulation.stateHash()}`,
        `order  ${simulation.systemOrder.join(' → ')}`,
      ].join('\n');
    }
    requestAnimationFrame(refresh);
  };
  requestAnimationFrame(refresh);
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
