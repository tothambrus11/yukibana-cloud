/** The update widget: what the release changes, grouped as the student has
 *  to think about it, and the one Apply.
 *
 *  The words are this prototype's; the decisions are `planUpdate`'s.
 */

import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { MessageService, URI } from '@theia/core';
import { ApplicationShell, NavigatableWidget, OpenerService, Saveable, open } from '@theia/core/lib/browser';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import { MergeEditor, MergeEditorOpenerOptions, MergeEditorUri } from '@theia/scm/lib/browser/merge-editor/merge-editor';
import { UpdateService, type FileView, type UpdateView } from '../common/update-protocol';
import { UpdateEvents, UpdateUri, UPDATE_SCHEME } from './update-resource';

@injectable()
export class UpdateWidget extends ReactWidget {
  static readonly ID = 'yukibana-update';
  static readonly LABEL = 'Assignment update';

  @inject(UpdateService) protected readonly service!: UpdateService;
  @inject(UpdateEvents) protected readonly events!: UpdateEvents;
  @inject(OpenerService) protected readonly openerService!: OpenerService;
  @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
  @inject(MessageService) protected readonly messages!: MessageService;

  protected view: UpdateView | null = null;
  protected skip = new Set<string>();
  protected chosen = new Map<string, 'mine' | 'theirs'>();
  protected merged = new Set<string>();
  protected warningsSeen = false;
  protected busy = false;

  @postConstruct()
  protected init(): void {
    this.id = UpdateWidget.ID;
    this.title.label = UpdateWidget.LABEL;
    this.title.caption = UpdateWidget.LABEL;
    this.title.iconClass = 'codicon codicon-cloud-download';
    this.title.closable = true;
    this.addClass('yukibana-update');
    this.toDispose.push(this.events.onDidSaveResult(({ planId, path }) => {
      if (planId === this.view?.planId) {
        this.merged.add(path);
        this.update();
      }
    }));
    this.update();
  }

  open(view: UpdateView): void {
    this.view = view;
    this.skip = new Set();
    this.chosen = new Map();
    this.merged = new Set();
    this.warningsSeen = false;
    this.title.label = `Update to ${view.to}`;
    this.update();
  }

  protected render(): React.ReactNode {
    const v = this.view;
    if (v === null) return <div className='yukibana-update-empty'>No update is open.</div>;
    const of = (g: FileView['group']) => v.files.filter((f) => f.group === g);
    const warnings = of('warning');
    const automatic = of('automatic');
    const ready = of('ready');
    const needsYou = of('needsYou');
    return (
      <div className='yukibana-update-body'>
        <h2>Update {v.from} → {v.to}</h2>
        {v.notes !== null && (
          <blockquote className='yukibana-update-notes'>
            <div className='yukibana-update-caption'>From your teacher</div>
            {v.notes}
          </blockquote>
        )}
        {warnings.length > 0 && (
          <section className='yukibana-update-warning'>
            <h3><span className='codicon codicon-warning' /> Your work in these files will be replaced</h3>
            <p>
              The teacher made these files read-only. Your changes in them would be replaced at grading anyway; a copy is kept so
              you can move your work elsewhere.
            </p>
            {warnings.map((f) => this.row(f, <span className='codicon codicon-warning' />))}
            <label className='yukibana-update-ack'>
              <input type='checkbox' checked={this.warningsSeen} onChange={(e) => { this.warningsSeen = e.currentTarget.checked; this.update(); }} />
              I have seen what will be replaced
            </label>
          </section>
        )}
        {automatic.length > 0 && (
          <section>
            <h3>Updated automatically (read-only)</h3>
            {automatic.map((f) => this.row(f, <span className='codicon codicon-check' />, f.studentChanged ? <span className='yukibana-update-note'>your changes here are replaced</span> : null))}
          </section>
        )}
        {ready.length > 0 && (
          <section>
            <h3>Ready to apply (you have not touched these)</h3>
            {ready.map((f) => this.row(f, (
              <input type='checkbox' checked={!this.skip.has(f.path)} onChange={(e) => { if (e.currentTarget.checked) this.skip.delete(f.path); else this.skip.add(f.path); this.update(); }} />
            ), <span className='yukibana-update-note'>{f.kind === 'add' ? 'new file' : f.kind === 'delete' ? 'removed by your teacher' : ''}</span>))}
          </section>
        )}
        {needsYou.length > 0 && (
          <section>
            <h3>Needs you (you and your teacher both changed these)</h3>
            {needsYou.map((f) => this.needsYouRow(f))}
          </section>
        )}
        {v.files.length === 0 && <p>Nothing in your folder changes.</p>}
        <div className='yukibana-update-actions'>
          <button className='theia-button main' disabled={this.busy || (warnings.length > 0 && !this.warningsSeen)} onClick={() => this.apply()}>Apply</button>
          <button className='theia-button secondary' disabled={this.busy} onClick={() => this.close()}>Later</button>
        </div>
      </div>
    );
  }

  protected row(f: FileView, mark: React.ReactNode, extra: React.ReactNode = null): React.ReactNode {
    return (
      <div className='yukibana-update-row' key={f.path}>
        <span className='yukibana-update-mark'>{mark}</span>
        <span className='yukibana-update-path'>{f.path}</span>
        {extra}
        {f.diffable && <a className='yukibana-update-link' onClick={() => this.diff(f)}>view diff</a>}
      </div>
    );
  }

  protected needsYouRow(f: FileView): React.ReactNode {
    if (f.kind === 'merge') {
      const done = this.merged.has(f.path);
      const summary = `${f.changes} change${f.changes === 1 ? '' : 's'}, ${f.conflicts} conflict${f.conflicts === 1 ? '' : 's'}`;
      return this.row(
        { ...f, diffable: false },
        <span className={`codicon ${done ? 'codicon-pass-filled' : 'codicon-warning'}`} />,
        <>
          <span className='yukibana-update-note'>{done ? 'merged' : summary}</span>
          <a className='yukibana-update-link' onClick={() => this.merge(f)}>{done ? 'edit merge' : 'merge'}</a>
        </>,
      );
    }
    const pick = this.chosen.get(f.path) ?? 'mine';
    const set = (side: 'mine' | 'theirs') => () => { this.chosen.set(f.path, side); this.update(); };
    const why = f.reason === 'binary' ? 'not text: keep one side' : f.reason === 'deletedByTeacher' ? 'your teacher removed it, you changed it' : 'you removed it, your teacher changed it';
    const mineLabel = f.reason === 'deletedByStudent' ? 'keep it removed' : 'keep mine';
    const theirLabel = f.reason === 'deletedByTeacher' ? 'remove it' : 'take the teacher\'s';
    return this.row(f, <span className='codicon codicon-warning' />, (
      <span className='yukibana-update-note'>
        {why} ·{' '}
        <label><input type='radio' checked={pick === 'mine'} onChange={set('mine')} /> {mineLabel}</label>{' '}
        <label><input type='radio' checked={pick === 'theirs'} onChange={set('theirs')} /> {theirLabel}</label>
      </span>
    ));
  }

  protected async diff(f: FileView): Promise<void> {
    const v = this.view;
    if (v === null) return;
    const uri = DiffUris.encode(UpdateUri.of(v.planId, 'mine', f.path), UpdateUri.of(v.planId, 'theirs', f.path), `${f.path}: yours ↔ ${v.to}`);
    await open(this.openerService, uri);
  }

  /** Opens Theia's own three-way merge editor: base is the starter the
   *  folder came from, input 1 the student's file, input 2 the newest
   *  starter, and the result starts as `planUpdate`'s pre-merge (every clean
   *  teacher change applied, conflicts as the base had them), which the
   *  editor reads back as "teacher change taken" and "conflict unhandled". */
  protected async merge(f: FileView): Promise<void> {
    const v = this.view;
    if (v === null) return;
    const uri = MergeEditorUri.encode({
      baseUri: UpdateUri.of(v.planId, 'base', f.path),
      side1Uri: UpdateUri.of(v.planId, 'mine', f.path),
      side2Uri: UpdateUri.of(v.planId, 'theirs', f.path),
      resultUri: UpdateUri.of(v.planId, 'result', f.path),
    });
    const options: MergeEditorOpenerOptions = {
      widgetState: {
        side1State: { title: 'Yours', description: 'your file' },
        side2State: { title: `Teacher: ${v.to}`, description: 'what the new release changed' },
      },
    };
    const editor = await open(this.openerService, uri, options);
    if (editor instanceof MergeEditor) {
      editor.basePane.header.title.label = `Base: ${v.from}`;
      editor.title.label = `Merging: ${f.path}`;
    }
  }

  protected async apply(): Promise<void> {
    const v = this.view;
    if (v === null) return;
    const files = new Set(v.files.map((f) => f.path));
    const dirty = this.shell.widgets.filter((w) => Saveable.isDirty(w)).map((w) => NavigatableWidget.getUri(w)).filter((u) => u !== undefined);
    const root = new URI(v.workspace);
    const unsavedWork = dirty.filter((u) => files.has(root.relative(u)?.toString() ?? ''));
    if (unsavedWork.length > 0) {
      this.messages.warn(`Save ${unsavedWork.map((u) => u.path.base).join(', ')} first: the update was planned from the saved file.`);
      return;
    }
    const unsavedMerge = dirty.filter((u) => u.scheme === UPDATE_SCHEME || MergeEditorUri.isMergeEditorUri(u));
    if (unsavedMerge.length > 0) {
      this.messages.warn('A merge is still open with unsaved changes. Complete it, or close it to skip it.');
      return;
    }
    this.busy = true;
    this.update();
    try {
      const applied = await this.service.apply(v.planId, { skip: [...this.skip], chosen: Object.fromEntries(this.chosen), warningsSeen: this.warningsSeen });
      this.view = null;
      this.close();
      const n = applied.written.length + applied.deleted.length;
      const undo = await this.messages.info(`Updated to ${v.to}: ${n} file${n === 1 ? '' : 's'} changed.`, 'Undo');
      if (undo === 'Undo') {
        await this.service.undo(applied.backup);
        this.messages.info(`Back on ${v.from}.`);
      }
    } catch (e) {
      this.messages.error(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
      this.update();
    }
  }
}
