import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Token } from '@lumino/coreutils';
import { ISecretsManager, SecretsManager } from 'jupyter-secrets-manager';

type Provider = 'manual' | 'moodle';
type Provision = {
  moodle: () => { token: string; url: string };
  provider: () => Provider;
};
type State = { active: Provider; secret: string; url: string };

export function dispatch<Plugin>(
  id: string,
  description: string,
  provides: Token<Plugin>,
  create: (app: JupyterFrontEnd, provision: Provision) => [Plugin, () => void]
): JupyterFrontEndPlugin<Plugin> {
  return SecretsManager.sign(id, token => {
    if (!token) throw new Error('Secrets manager token unavailable');
    let deactivator = () => {};
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
      ): Promise<Plugin> => {
        const [plugin, deactivate] = create(app, provision);
        const stored = await secrets.get(token, id, 'moodle-token');
        if (stored?.value) state.secret = stored.value;
        if (!registry) return plugin;
        try {
          const subscriber = { id, secrets, state, token };
          const unsubscribe = await subscribe({ registry, ...subscriber });
          deactivator = () => {
            unsubscribe();
            deactivate();
          };
        } catch (reason) {
          console.warn(id, 'settings error', reason);
        }
        return plugin;
      },
      deactivate: () => deactivator()
    };
  });
}

function anonymize({ id, plugin, secrets, state, token }: {
  id: string,
  plugin: ISettingRegistry.IPlugin,
  secrets: ISecretsManager,
  state: State,
  token: symbol
}): ISettingRegistry.IPlugin {
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
  id: string,
  registry: ISettingRegistry,
  secrets: ISecretsManager,
  state: State,
  token: symbol
}): Promise<() => void> {
  registry.transform(id, {
    compose: plugin => anonymize({ id, plugin, secrets, state, token })
  });

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
