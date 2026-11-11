import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { StoryRuntime } from '../../../application/story/story-system';
import { CAMPAIGN } from '../../../domain/story/campaign';
import { StoryProps } from './story-props';

describe('story props', () => {
  it('builds one prop per interactable, haloes what can be used, lights running generators', () => {
    const story = new StoryRuntime(CAMPAIGN);
    const props = new StoryProps(story);
    expect(props.stats.props).toBe(CAMPAIGN.interactables.length);
    let meshes = 0;
    props.group.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBeGreaterThan(CAMPAIGN.interactables.length * 2);
    props.update(0);
    const usableAtStart = props.stats.usable;
    expect(usableAtStart).toBeGreaterThan(0);
    // Start the substation quest and run generator A: its lamp turns on, its halo goes.
    story.engine.restore({
      ...story.engine.snapshot(),
      quests: [['substation', 'active']],
      used: ['generatorA'],
      flags: [['power.genA', 1]],
    });
    props.update(1);
    const gen = props.group.getObjectByName('story:generatorA');
    const lit = gen?.children.some(
      (c) =>
        c instanceof THREE.Mesh &&
        c.material instanceof THREE.MeshStandardMaterial &&
        c.material.emissiveIntensity === 4,
    );
    expect(lit).toBe(true);
    props.dispose();
  });
});
