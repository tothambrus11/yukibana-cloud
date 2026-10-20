/** `yukibana-update:` URIs: one version of one file in an open update.
 *
 *  `yukibana-update:/<planId>/<side>/<path>`. The diff and merge editors
 *  open these like any file, so the merge editor never edits the student's
 *  file directly: its result is saved to the plan in the backend, and only
 *  Apply writes the folder, together with everything else, in one step.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, Event, URI } from '@theia/core';
import type { Resource, ResourceResolver } from '@theia/core/lib/common/resource';
import { UpdateService, type Side } from '../common/update-protocol';

export const UPDATE_SCHEME = 'yukibana-update';

export namespace UpdateUri {
  export function of(planId: string, side: Side, path: string): URI {
    return new URI().withScheme(UPDATE_SCHEME).withPath(`/${planId}/${side}/${path}`);
  }

  export function parse(uri: URI): { planId: string; side: Side; path: string } | undefined {
    if (uri.scheme !== UPDATE_SCHEME) return undefined;
    const [, planId, side, ...rest] = uri.path.toString().split('/');
    if (planId === undefined || (side !== 'base' && side !== 'mine' && side !== 'theirs' && side !== 'result') || rest.length === 0) return undefined;
    return { planId, side, path: rest.join('/') };
  }
}

/** Says when the student saved a merge result, so the widget can tick the
 *  file. */
@injectable()
export class UpdateEvents {
  protected readonly savedEmitter = new Emitter<{ planId: string; path: string }>();
  readonly onDidSaveResult: Event<{ planId: string; path: string }> = this.savedEmitter.event;

  fireSaved(planId: string, path: string): void {
    this.savedEmitter.fire({ planId, path });
  }
}

@injectable()
export class UpdateResourceResolver implements ResourceResolver {
  @inject(UpdateService) protected readonly service!: UpdateService;
  @inject(UpdateEvents) protected readonly events!: UpdateEvents;

  readonly priority = 10;

  resolve(uri: URI): Resource {
    const parsed = UpdateUri.parse(uri);
    if (parsed === undefined) throw new Error(`not a ${UPDATE_SCHEME} URI: ${uri}`);
    const { planId, side, path } = parsed;
    const changed = new Emitter<void>();
    const resource: Resource = {
      uri,
      readContents: () => this.service.content(planId, side, path),
      dispose: () => changed.dispose(),
      onDidChangeContents: changed.event,
      ...(side === 'result'
        ? {
            // Saved only on purpose ("Complete Merge" or Ctrl+S): an
            // autosaved half-merge would show as done in the widget.
            autosaveable: false,
            saveContents: async (content: string) => {
              await this.service.saveResult(planId, path, content);
              this.events.fireSaved(planId, path);
            },
          }
        : { readOnly: true }),
    };
    return resource;
  }
}
