import type { Ring } from '../../infrastructure/render/ring';

/** Tiny DOM helpers for the debug UI (no framework: keeps the dev bundle small). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

export function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
): { row: HTMLElement; input: HTMLInputElement } {
  const row = el('label', 'debug-slider');
  const input = el('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = el('span', 'debug-value', formatValue(value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = formatValue(v);
    onInput(v);
  });
  row.append(el('span', 'debug-label', label), input, out);
  return { row, input };
}

function formatValue(v: number): string {
  return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3);
}

/** Frame-time graph with a budget line. */
export function sparkline(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; draw(ring: Ring, budget: number): void } {
  const canvas = el('canvas', 'debug-spark');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  return {
    canvas,
    draw(ring, budget) {
      if (g === null) return;
      const max = budget * 2.5;
      g.clearRect(0, 0, width, height);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(0, 0, width, height);
      const y = (v: number): number => height - Math.min(1, v / max) * height;
      g.strokeStyle = '#d33';
      g.beginPath();
      g.moveTo(0, y(budget));
      g.lineTo(width, y(budget));
      g.stroke();
      g.fillStyle = '#9fd';
      const n = Math.min(ring.count, width);
      for (let i = 0; i < n; i++) {
        const v = ring.recent(i);
        g.fillStyle = v > budget ? '#f74' : '#9fd';
        g.fillRect(width - 1 - i, y(v), 1, height - y(v));
      }
    },
  };
}
