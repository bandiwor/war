import { GameLoop } from '../application/loop/game-loop';
import { createEmptyWorld } from '../application/scenes/empty-world';
import { seed } from '../domain/core/brand';
import { KeyboardMouseInput } from '../infrastructure/browser/keyboard-input';
import { RafFrameSource } from '../infrastructure/browser/raf-frame-source';
import { OsdPresenter } from './osd-presenter';

/** Browser composition root: the only place concrete adapters are wired together. */
function bootstrap(): void {
  const root = document.getElementById('app');
  if (root === null) throw new Error('#app missing');
  const params = new URLSearchParams(window.location.search);
  const runSeed = seed(Number(params.get('seed') ?? '1337') >>> 0);

  const { simulation } = createEmptyWorld(runSeed);
  const input = new KeyboardMouseInput(root);
  const presenter = new OsdPresenter(root, simulation);
  const loop = new GameLoop({ simulation, frames: new RafFrameSource(), input, presenter });
  loop.start();

  if (import.meta.env.DEV) {
    // Dynamic import inside a DEV-only branch: Vite removes it (and the whole
    // debug package) from production builds.
    void import('./debug/debug-menu').then(({ installDebugMenu }) => {
      installDebugMenu({ root, simulation, loop });
    });
  }
}

bootstrap();
