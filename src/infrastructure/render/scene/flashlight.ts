import * as THREE from 'three';

/**
 * Chest-mounted LED flashlight: a shadow-casting spot with a procedural cookie
 * (hot centre, soft corona, faint reflector rings and lens imperfections).
 * Zombies fear this cone (stage 7), so it is a gameplay object, not decor.
 */
export function flashlightCookie(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const hot = Math.exp(-r * r * 9);
      const corona = 0.35 * Math.exp(-r * r * 2.2);
      const rings = 0.06 * Math.sin(r * 40) * Math.exp(-r * 2);
      const smudge = 0.05 * Math.sin(dx * 31 + dy * 17) * Math.sin(dy * 23 - dx * 7);
      const v = Math.max(0, Math.min(1, (hot + corona + rings + smudge) * (r < 1 ? 1 : 0)));
      const i = (y * size + x) * 4;
      // Slightly cool LED tint at the centre, warmer at the edge.
      data[i] = Math.round(255 * v * (0.97 + 0.03 * r));
      data[i + 1] = Math.round(255 * v * 0.98);
      data[i + 2] = Math.round(255 * v * (1 - 0.08 * r));
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class Flashlight {
  readonly light: THREE.SpotLight;
  private readonly cookie: THREE.DataTexture;
  private readonly forward = new THREE.Vector3();

  constructor(shadowMapSize: number) {
    this.cookie = flashlightCookie();
    this.light = new THREE.SpotLight(0xf4f6ff, 260, 40, 0.62, 0.4, 2);
    this.light.map = this.cookie;
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    this.light.shadow.camera.near = 0.2;
    this.light.shadow.camera.far = 40;
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.02;
  }

  /** Mount just below/right of the camera, aimed along its forward. */
  update(camera: THREE.Camera, on: boolean, battery: number, time: number): void {
    camera.getWorldDirection(this.forward);
    // Chest lights sit angled slightly down so the beam lands a few metres ahead.
    this.forward.y -= 0.12;
    this.forward.normalize();
    this.light.position.copy(camera.position).addScaledVector(camera.up, -0.08);
    this.light.position.x += 0.06;
    this.light.target.position.copy(this.light.position).addScaledVector(this.forward, 10);
    this.light.target.updateMatrixWorld();
    // Dying battery: dims and stutters below 15%.
    let k = 1;
    if (battery < 0.15) {
      k = 0.35 + battery * 4;
      if (Math.sin(time * 31) * Math.sin(time * 7.3) > 0.7) k *= 0.2;
    }
    this.light.visible = on && battery > 0;
    this.light.intensity = 260 * k;
  }

  dispose(): void {
    this.cookie.dispose();
    this.light.dispose();
  }
}
