/** The command, and the banner when an update is waiting.
 *
 *  The real trigger is the registry's Realtime event for a new release
 *  (and a check when the project opens); the prototype checks when the
 *  workspace opens and on the command.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandRegistry, MessageService } from '@theia/core';
import { AbstractViewContribution, FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { UpdateService } from '../common/update-protocol';
import { UpdateWidget } from './update-widget';

export const CHECK_FOR_UPDATE: Command = { id: 'yukibana.update.check', category: 'Yukibana', label: 'Check for Assignment Update' };

@injectable()
export class UpdateContribution extends AbstractViewContribution<UpdateWidget> implements FrontendApplicationContribution {
  @inject(UpdateService) protected readonly service!: UpdateService;
  @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
  @inject(MessageService) protected readonly messages!: MessageService;

  constructor() {
    super({ widgetId: UpdateWidget.ID, widgetName: UpdateWidget.LABEL, defaultWidgetOptions: { area: 'main' } });
  }

  async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
    await this.workspace.roots;
    void this.check(false);
  }

  override registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands);
    commands.registerCommand(CHECK_FOR_UPDATE, { execute: () => this.check(true) });
  }

  /** Plans the update and offers it. `asked`: the student ran the command,
   *  so "nothing to do" and problems are worth saying too. */
  async check(asked: boolean): Promise<void> {
    const [root] = await this.workspace.roots;
    if (root === undefined) {
      if (asked) this.messages.info('Open an assignment folder first.');
      return;
    }
    const checked = await this.service.check(root.resource.toString());
    if (checked.kind === 'problem') {
      if (asked) this.messages.warn(checked.problem);
      return;
    }
    if (checked.kind === 'upToDate') {
      if (asked) this.messages.info(`You are on the newest release, ${checked.release}.`);
      return;
    }
    const v = checked.view;
    const open = asked ? 'Open' : await this.messages.info(`Update available: ${v.to}${v.notes === null ? '' : ` · ${v.notes.split('\n')[0]}`}`, 'Open');
    if (open !== 'Open') return;
    const widget = await this.openView({ activate: true, reveal: true });
    widget.open(v);
  }
}
