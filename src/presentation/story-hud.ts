import type { StoryRuntime } from '../application/story/story-system';
import type { GameEvents } from '../domain/events/bus';
import type { StoryNote } from '../domain/story/engine';

/**
 * The story on screen, in the bodycam's own language: subtitles for radio
 * calls and recordings (with the channel), short status toasts (objectives,
 * logs found, saves), a chapter card, the "use" prompt, the journal (J) and
 * the ending. Plain DOM over the canvas; all text goes in as textContent.
 */
export interface StoryHudActions {
  /** Load the latest save (the ending screen, the journal). */
  loadLatest(): void;
  newGame(): void;
}

const TOAST_SECONDS = 4;
const CHAPTER_SECONDS = 5;

function div(className: string, text = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  if (text !== '') d.textContent = text;
  return d;
}

export class StoryHud {
  readonly root = div('story-hud');
  private readonly subtitle = div('story-subtitle');
  private readonly channel = div('story-channel');
  private readonly line = div('story-line');
  private readonly toasts = div('story-toasts');
  private readonly prompt = div('story-prompt');
  private readonly chapterCard = div('story-chapter');
  private readonly journal = div('story-journal');
  private readonly ending = div('story-ending');
  private lineLeft = 0;
  private chapterLeft = 0;
  private readonly toastTimers: { el: HTMLElement; left: number }[] = [];
  /** Text of the last few toasts (tests). */
  readonly recent: string[] = [];

  constructor(
    host: HTMLElement,
    private readonly story: StoryRuntime,
    private readonly actions: StoryHudActions,
  ) {
    this.root.dataset['testid'] = 'story-hud';
    this.subtitle.append(this.channel, this.line);
    this.subtitle.hidden = true;
    this.prompt.hidden = true;
    this.chapterCard.hidden = true;
    this.journal.hidden = true;
    this.journal.dataset['testid'] = 'journal';
    this.ending.hidden = true;
    this.ending.dataset['testid'] = 'ending';
    this.prompt.dataset['testid'] = 'story-prompt';
    this.subtitle.dataset['testid'] = 'subtitle';
    this.root.append(
      this.chapterCard,
      this.toasts,
      this.prompt,
      this.subtitle,
      this.journal,
      this.ending,
    );
    host.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyJ' && !e.repeat) this.toggleJournal();
    });
  }

  consume(events: GameEvents): void {
    for (let i = 0; i < events.story.size; i++) {
      const note = events.story.at(i)?.note;
      if (note !== undefined) this.show(note);
    }
  }

  toast(text: string): void {
    const t = div('story-toast', text);
    this.toasts.append(t);
    this.toastTimers.push({ el: t, left: TOAST_SECONDS });
    this.recent.push(text);
    if (this.recent.length > 20) this.recent.shift();
  }

  private show(note: StoryNote): void {
    const data = this.story.data;
    switch (note.kind) {
      case 'line': {
        const channel =
          note.source === 'radio'
            ? (data.radio.find((r) => r.id === note.id)?.channel ?? 'RADIO')
            : `REC · ${data.logs.find((l) => l.id === note.id)?.title ?? ''}`;
        this.channel.textContent = channel;
        this.line.textContent = `${note.line.speaker}: ${note.line.text}`;
        this.subtitle.hidden = false;
        this.lineLeft = note.line.seconds;
        break;
      }
      case 'quest': {
        const q = data.quests.find((x) => x.id === note.quest);
        if (q === undefined) break;
        if (note.status === 'active') this.toast(`NEW TASK  ${q.title}`);
        else if (note.status === 'done') this.toast(`DONE  ${q.title}`);
        else if (note.status === 'failed') this.toast(`FAILED  ${q.title}`);
        break;
      }
      case 'objective': {
        const o = data.quests
          .find((x) => x.id === note.quest)
          ?.objectives.find((x) => x.id === note.objective);
        if (o !== undefined) this.toast(`✓ ${o.text}`);
        break;
      }
      case 'log': {
        const l = data.logs.find((x) => x.id === note.log);
        if (l !== undefined) this.toast(`FOUND  ${l.title}  [J]`);
        break;
      }
      case 'chapter': {
        const c = data.chapters.find((x) => x.id === note.chapter);
        if (c === undefined) break;
        this.chapterCard.replaceChildren(div('story-chapter-title', c.title), div('', c.summary));
        this.chapterCard.hidden = false;
        this.chapterLeft = CHAPTER_SECONDS;
        break;
      }
      case 'ending':
        this.showEnding(note.ending);
        break;
      case 'supply':
        this.toast(`+${String(note.amount)} ${note.ammo}`);
        break;
      case 'battery':
        this.toast('FRESH BATTERY');
        break;
      case 'spawn':
      case 'used':
        break;
    }
  }

  /** Per frame: timers, and the prompt for what is in reach of (x, z). */
  update(dt: number, x: number, z: number): void {
    if (this.lineLeft > 0) {
      this.lineLeft -= dt;
      if (this.lineLeft <= 0) this.subtitle.hidden = true;
    }
    if (this.chapterLeft > 0) {
      this.chapterLeft -= dt;
      if (this.chapterLeft <= 0) this.chapterCard.hidden = true;
    }
    for (let i = this.toastTimers.length - 1; i >= 0; i--) {
      const t = this.toastTimers[i];
      if (t === undefined) continue;
      t.left -= dt;
      if (t.left <= 0) {
        t.el.remove();
        this.toastTimers.splice(i, 1);
      }
    }
    const thing = this.story.usableAt(x, z);
    this.prompt.hidden = thing === null;
    if (thing !== null) this.prompt.textContent = `[E] ${thing.label}`;
  }

  get journalOpen(): boolean {
    return !this.journal.hidden;
  }

  toggleJournal(): void {
    if (this.journal.hidden) this.renderJournal();
    this.journal.hidden = !this.journal.hidden;
  }

  private renderJournal(): void {
    const e = this.story.engine;
    const data = this.story.data;
    const chapter = data.chapters.find((c) => c.id === e.chapter);
    const parts: HTMLElement[] = [
      div('story-journal-title', `JOURNAL · ${chapter?.title ?? ''}`),
      div('story-journal-summary', chapter?.summary ?? ''),
    ];
    for (const q of data.quests) {
      const status = e.status(q.id);
      if (status === 'inactive') continue;
      const box = div(`story-quest ${status}`);
      box.append(
        div(
          'story-quest-title',
          `${status === 'done' ? '✓' : status === 'failed' ? '✗' : '•'} ${q.title}`,
        ),
      );
      if (status === 'active') {
        box.append(div('story-quest-summary', q.summary));
        for (const o of q.objectives) {
          const done = e.objectives.has(`${q.id}.${o.id}`);
          box.append(div(`story-objective${done ? ' done' : ''}`, `${done ? '☑' : '☐'} ${o.text}`));
        }
      }
      parts.push(box);
    }
    if (e.logs.length > 0) parts.push(div('story-journal-title', 'LOGS'));
    for (const id of e.logs) {
      const l = data.logs.find((x) => x.id === id);
      if (l === undefined) continue;
      const box = div('story-log');
      box.append(div('story-log-title', `${l.title} — ${l.author}, ${l.date}`));
      for (const line of l.lines)
        box.append(div('story-log-line', `${line.speaker}: ${line.text}`));
      parts.push(box);
    }
    parts.push(div('story-journal-hint', '[J] close'));
    this.journal.replaceChildren(...parts);
  }

  private showEnding(id: string): void {
    const end = this.story.data.endings.find((x) => x.id === id);
    if (end === undefined) return;
    const load = document.createElement('button');
    load.type = 'button';
    load.textContent = 'Load last save';
    load.addEventListener('click', () => {
      this.actions.loadLatest();
    });
    const again = document.createElement('button');
    again.type = 'button';
    again.textContent = 'New game';
    again.addEventListener('click', () => {
      this.actions.newGame();
    });
    this.ending.replaceChildren(
      div('story-ending-title', `ENDING · ${end.title.toUpperCase()}`),
      ...end.epilogue.map((p) => div('story-ending-line', p)),
      div('story-ending-buttons'),
    );
    this.ending.lastElementChild?.append(load, again);
    this.ending.hidden = false;
    document.exitPointerLock();
  }
}
