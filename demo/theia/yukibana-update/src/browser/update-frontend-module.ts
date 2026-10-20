import '../../src/browser/style/update.css';
import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution, ResourceResolver } from '@theia/core';
import { FrontendApplicationContribution, KeybindingContribution, LabelProviderContribution, ServiceConnectionProvider, WidgetFactory } from '@theia/core/lib/browser';
import { UPDATE_SERVICE_PATH, UpdateService } from '../common/update-protocol';
import { DiffComputer } from '@theia/core/lib/common/diff';
import { UpdateContribution } from './update-contribution';
import { UpdateDiffComputer } from './update-diff-computer';
import { UpdateLabels } from './update-labels';
import { UpdateEvents, UpdateResourceResolver } from './update-resource';
import { UpdateWidget } from './update-widget';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
  bind(UpdateService).toDynamicValue((ctx) => ServiceConnectionProvider.createProxy<UpdateService>(ctx.container, UPDATE_SERVICE_PATH)).inSingletonScope();
  bind(UpdateEvents).toSelf().inSingletonScope();
  bind(UpdateResourceResolver).toSelf().inSingletonScope();
  bind(ResourceResolver).toService(UpdateResourceResolver);
  bind(UpdateLabels).toSelf().inSingletonScope();
  bind(LabelProviderContribution).toService(UpdateLabels);
  // Every diff goes through this; it hands everything but an update's
  // files back to Monaco's.
  bind(UpdateDiffComputer).toSelf().inSingletonScope();
  rebind(DiffComputer).toService(UpdateDiffComputer);

  bind(UpdateWidget).toSelf();
  bind(WidgetFactory).toDynamicValue((ctx) => ({ id: UpdateWidget.ID, createWidget: () => ctx.container.get(UpdateWidget) })).inSingletonScope();

  bind(UpdateContribution).toSelf().inSingletonScope();
  for (const id of [CommandContribution, MenuContribution, KeybindingContribution, FrontendApplicationContribution]) bind(id).toService(UpdateContribution);
});
