/** The window: a login screen, the exercise list, one exercise's detail with
 *  the person's submissions, and the preview of a folder before it is sent.
 *
 *  Plain DOM. Every string from the registry or the disk goes in through
 *  `textContent`, never as HTML, so a student named `<img onerror=…>` is a
 *  student with an odd name. All decisions about wording are in view.ts.
 */

import type { Project } from '@yukibana/cli';
import type { BundlePreview } from './bridge.js';
import { bytes, exerciseCards, sendable, submissionRows, type ExerciseCard } from './view.js';

const api = window.yukibana;

type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<{ class: string; title: string; onclick: () => void; disabled: boolean }> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class !== undefined) node.className = props.class;
  if (props.title !== undefined) node.title = props.title;
  if (props.onclick !== undefined) node.addEventListener('click', props.onclick);
  if (props.disabled === true && node instanceof HTMLButtonElement) node.disabled = true;
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c);
  }
  return node;
}

/** The children worth adding: a `cond && el(…)` that was false is skipped. */
const kids = (...children: Child[]): (Node | string)[] => children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false);

const root = document.getElementById('app') ?? document.body;
const state: {
  projects: Project[];
  selected: string | null;
  preview: BundlePreview | null;
  shown: { path: string; text: string | null } | null;
  message: { kind: 'ok' | 'error'; text: string } | null;
} = { projects: [], selected: null, preview: null, shown: null, message: null };

function say(kind: 'ok' | 'error', text: string): void {
  state.message = { kind, text };
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function boot(): Promise<void> {
  const s = await api.status();
  if (s.me === null) {
    renderLogin(s.registry);
  } else {
    await loadExercises();
    renderMain(s.me.fullName ?? s.me.githubLogin ?? s.me.email ?? 'you', s.persistent);
  }
  window.yukibanaDemo.rendered();
}

function renderLogin(registry: string, error?: string): void {
  const input = el('input');
  input.value = registry;
  input.setAttribute('aria-label', 'Registry address');
  const button = el('button', {
    onclick: () => {
      button.disabled = true;
      button.textContent = 'Waiting for the browser…';
      api.login(input.value.trim()).then(() => boot(), (e: unknown) => renderLogin(input.value, errorText(e)));
    },
  }, 'Log in with GitHub');
  root.replaceChildren(el('main', { class: 'login' },
    el('h1', {}, 'Yukibana'),
    el('p', {}, 'Your browser opens to sign in with GitHub, then comes back here.'),
    el('label', {}, 'Registry', input),
    button,
    error !== undefined && el('p', { class: 'error' }, error),
  ));
}

async function loadExercises(): Promise<void> {
  try {
    state.projects = await api.exercises();
    if (state.selected === null || !state.projects.some((p) => p.projectId === state.selected)) {
      state.selected = exerciseCards(state.projects, Date.now())[0]?.projectId ?? null;
    }
  } catch (e) {
    say('error', errorText(e));
  }
}

function renderMain(name: string, persistent: boolean): void {
  const cards = exerciseCards(state.projects, Date.now());
  const header = el('header', {},
    el('strong', {}, 'Yukibana'),
    el('span', { class: 'muted' }, `Logged in as ${name}${persistent ? '' : ' (until you quit: no keychain to keep the session in)'}`),
    el('button', { class: 'quiet', onclick: () => void api.logout().then(() => boot()) }, 'Log out'),
  );
  const list = el('nav', {},
    el('h2', {}, 'Open exercises'),
    cards.length === 0 && el('p', { class: 'muted' }, 'Nothing is open to you right now.'),
    ...cards.map((c) => card(c, name, persistent)),
  );
  const detail = el('section', { class: 'detail' });
  root.replaceChildren(header, el('div', { class: 'columns' }, list, detail));
  if (state.message !== null) header.after(el('p', { class: state.message.kind }, state.message.text));
  void renderDetail(detail);
}

function card(c: ExerciseCard, name: string, persistent: boolean): HTMLElement {
  return el('button', {
    class: `card ${c.tone}${c.projectId === state.selected ? ' selected' : ''}`,
    onclick: () => {
      state.selected = c.projectId;
      state.preview = null;
      state.shown = null;
      state.message = null;
      renderMain(name, persistent);
    },
  },
  el('span', { class: 'title' }, c.title),
  el('span', { class: 'muted' }, c.course),
  el('span', { class: `due ${c.tone}` }, c.due),
  el('span', { class: 'muted' }, c.mine));
}

async function renderDetail(into: HTMLElement): Promise<void> {
  const p = state.projects.find((x) => x.projectId === state.selected);
  if (p === undefined) {
    into.replaceChildren(el('p', { class: 'muted' }, 'Choose an exercise.'));
    return;
  }
  const [c] = exerciseCards([p], Date.now());
  const rerender = (): void => void renderDetail(into);
  const actions = el('div', { class: 'actions' },
    el('button', {
      disabled: !p.starterReady,
      title: p.starterReady ? 'Unpack the starter into a folder' : 'No starter has been released yet',
      onclick: () => void api.downloadStarter(p.projectId).then((folder) => {
        if (folder !== null) say('ok', `The starter is in ${folder}. Work there, then submit that folder.`);
        rerender();
      }, (e: unknown) => { say('error', errorText(e)); rerender(); }),
    }, 'Download starter…'),
    p.canSubmit && el('button', {
      onclick: () => void api.chooseFolder().then((preview) => {
        state.preview = preview;
        state.shown = null;
        rerender();
      }, (e: unknown) => { say('error', errorText(e)); rerender(); }),
    }, 'Submit a folder…'),
  );

  const subs = el('div', {}, el('p', { class: 'muted' }, 'Loading submissions…'));
  into.replaceChildren(...kids(
    el('h2', {}, p.title),
    el('p', { class: 'muted' }, `${c?.course ?? ''} · ${p.kind}`),
    el('p', { class: `due ${c?.tone ?? 'ok'}` }, c?.due ?? ''),
    state.message !== null && el('p', { class: state.message.kind }, state.message.text),
    actions,
    state.preview !== null && previewPane(state.preview, p, rerender),
    el('h3', {}, p.role === 'student' ? 'My submissions' : 'Submissions'),
    subs,
  ));

  try {
    const rows = submissionRows(await api.submissions(p.projectId));
    subs.replaceChildren(rows.length === 0
      ? el('p', { class: 'muted' }, 'Nothing submitted yet.')
      : el('table', {},
        el('thead', {}, el('tr', {}, ...(p.role === 'student' ? [] : [el('th', {}, 'Student')]), el('th', {}, 'Submitted'), el('th', {}, 'Size'), el('th', {}, ''))),
        el('tbody', {}, ...rows.map((r) => el('tr', {},
          ...(p.role === 'student' ? [] : [el('td', {}, r.author)]),
          el('td', {}, r.when), el('td', {}, r.size), el('td', { class: r.tags.includes('late') ? 'late' : '' }, r.tags)))),
      ));
  } catch (e) {
    subs.replaceChildren(el('p', { class: 'error' }, errorText(e)));
  }
}

function previewPane(b: BundlePreview, p: Project, rerender: () => void): HTMLElement {
  const verdict = sendable(b.problems, b.projectId, state.projects);
  const forThis = verdict.ok && verdict.projectId === p.projectId;
  const files = el('ul', { class: 'files' }, ...b.files.map((f) => el('li', {},
    el('button', {
      class: `link${state.shown?.path === f.path ? ' selected' : ''}`,
      onclick: () => void api.previewFile(b.bundleId, f.path).then((shown) => {
        state.shown = { path: shown.path, text: shown.text };
        rerender();
      }),
    }, f.path),
    el('span', { class: 'muted' }, ` ${bytes(f.size)}`))));
  const shown = state.shown;
  return el('div', { class: 'preview' },
    el('h3', {}, 'What will be sent'),
    el('p', { class: 'muted' }, `${b.folder}: ${b.files.length} files, ${bytes(b.totalBytes)}${b.skipped.length > 0 ? `; left out by yukibana.json: ${b.skipped.join(', ')}` : ''}`),
    el('div', { class: 'split' },
      files,
      el('pre', {}, shown === null ? 'Click a file to see what will be sent.' : (shown.text ?? '(not text; it is sent as it is)')),
    ),
    !verdict.ok && el('p', { class: 'error' }, verdict.why),
    verdict.ok && !forThis && el('p', { class: 'error' }, 'This folder is for another exercise; choose that exercise first.'),
    p.late && el('p', { class: 'late' }, 'The deadline has passed: this submission will be recorded as late.'),
    el('div', { class: 'actions' },
      el('button', {
        disabled: !forThis,
        onclick: () => void api.submit(b.bundleId, p.projectId).then(async (accepted) => {
          state.preview = null;
          state.shown = null;
          say('ok', `Submitted (${bytes(accepted.byteSize)}). Your newest submission is the one that counts.`);
          await loadExercises();
          rerender();
        }, (e: unknown) => { say('error', errorText(e)); rerender(); }),
      }, `Send ${b.files.length} files`),
      el('button', { class: 'quiet', onclick: () => { state.preview = null; state.shown = null; rerender(); } }, 'Cancel'),
    ));
}

boot().catch((e: unknown) => {
  root.replaceChildren(el('p', { class: 'error' }, errorText(e)));
  window.yukibanaDemo.rendered();
});
