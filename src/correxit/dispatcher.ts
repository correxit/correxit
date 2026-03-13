import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Token } from '@lumino/coreutils';
import { ISecretsManager, SecretsManager } from 'jupyter-secrets-manager';

type Dispatcher<T> = T | [value: T, dispose: () => void];
type Provider = 'manual' | 'moodle';
type Provision = {
  moodle: () => { token: string; url: string };
  provider: () => Provider;
};
type State = { active: Provider; secret: string; url: string };

export function dispatch<T>(
  id: string,
  description: string,
  provides: Token<T>,
  create: (app: JupyterFrontEnd, provision: Provision) => Dispatcher<T>
): JupyterFrontEndPlugin<T> {
  return SecretsManager.sign(id, token => {
    if (!token) throw new Error('Secrets manager token unavailable');
    let deactivator: (() => void) | undefined;
    const state: State = { active: 'manual', secret: '', url: '' };
    const provision: Provision = {
      moodle: () => ({ token: state.secret, url: state.url }),
      provider: () => state.active
    };
    return {
      id,
      description,
      autoStart: true,
      requires: [ISecretsManager],
      optional: [ISettingRegistry],
      provides,
      activate: async (
        app: JupyterFrontEnd,
        secrets: ISecretsManager,
        registry: ISettingRegistry | null
      ): Promise<T> => {
        const created = create(app, provision);
        const [plugin, deactivate] = Array.isArray(created)
          ? created
          : [created, undefined];
        const stored = await secrets.get(token, id, 'moodle-token');
        if (stored?.value) state.secret = stored.value;
        if (!registry) return plugin;
        try {
          const subscriber = { id, secrets, state, token };
          const unsubscribe = await subscribe({ registry, ...subscriber });
          deactivator = () => {
            unsubscribe();
            deactivate?.();
          };
        } catch (reason) {
          console.warn(id, 'settings error', reason);
        }
        return plugin;
      },
      deactivate: () => deactivator?.()
    };
  });
}

function anonymize(
  plugin: ISettingRegistry.IPlugin,
  id: string,
  token: symbol,
  state: State,
  secrets: ISecretsManager
): ISettingRegistry.IPlugin {
  const raw = JSON.parse(plugin.raw);
  const found = raw.moodle?.token;
  if (found) {
    const secret = { namespace: id, id: 'moodle-token', value: found };
    state.secret = found;
    raw.moodle = { ...raw.moodle, token: '' };
    plugin.raw = JSON.stringify(raw);
    secrets.set(token, id, 'moodle-token', secret);
  }
  if (state.secret && plugin.data?.composite) {
    const composite = plugin.data.composite as any;
    composite.moodle = { ...composite.moodle, token: state.secret };
  }
  return plugin;
}

async function subscribe({ id, registry, secrets, state, token }: {
  registry: ISettingRegistry,
  id: string,
  token: symbol,
  state: State,
  secrets: ISecretsManager
}): Promise<() => void> {
  const compose: ISettingRegistry.IPlugin.Transform =
     plugin => anonymize(plugin, id, token, state, secrets);
  registry.transform(id, { compose });

  const loaded = await registry.load(id);
  const reconfigure = () => {
    const composite = loaded.composite as {
      moodle: { token: string; url: string };
      provider: Provider;
    };
    state.active = composite.provider;
    state.url = composite.moodle.url;
    if (composite.moodle.token) state.secret = composite.moodle.token;
  };
  loaded.changed.connect(reconfigure);
  reconfigure();
  return () => loaded.changed.disconnect(reconfigure);
}
