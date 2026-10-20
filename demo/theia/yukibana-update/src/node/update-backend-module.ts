import * as os from 'node:os';
import * as path from 'node:path';
import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { UPDATE_SERVICE_PATH, UpdateService } from '../common/update-protocol';
import { FolderReleaseSource } from './release-source';
import { ReleaseSourceToken, UpdateServiceImpl } from './update-service';

export default new ContainerModule((bind) => {
  // The prototype's releases come from a folder (see release-source.ts);
  // the registry-backed source replaces this binding.
  bind(ReleaseSourceToken).toConstantValue(new FolderReleaseSource(process.env['YUKIBANA_RELEASES'] ?? path.join(os.homedir(), '.yukibana', 'releases')));
  bind(UpdateServiceImpl).toSelf().inSingletonScope();
  bind(UpdateService).toService(UpdateServiceImpl);
  bind(ConnectionHandler).toDynamicValue((ctx) => new RpcConnectionHandler(UPDATE_SERVICE_PATH, () => ctx.container.get(UpdateService))).inSingletonScope();
});
