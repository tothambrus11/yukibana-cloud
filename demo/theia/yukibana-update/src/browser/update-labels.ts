/** Names for `yukibana-update:` files in tabs and pane headers: the path in
 *  the student's folder and which version it is, never the plan id. */

import { injectable } from '@theia/core/shared/inversify';
import { URI } from '@theia/core';
import type { LabelProviderContribution } from '@theia/core/lib/browser';
import { UpdateUri } from './update-resource';

const VERSION = { base: 'release you started from', mine: 'your file before the update', theirs: 'new release', result: 'merge result, written on Apply' } as const;

@injectable()
export class UpdateLabels implements LabelProviderContribution {
  canHandle(element: object): number {
    return element instanceof URI && UpdateUri.parse(element) !== undefined ? 100 : 0;
  }

  getName(element: URI): string | undefined {
    return UpdateUri.parse(element)?.path.split('/').pop();
  }

  getLongName(element: URI): string | undefined {
    const u = UpdateUri.parse(element);
    return u === undefined ? undefined : `${u.path} (${VERSION[u.side]})`;
  }
}
