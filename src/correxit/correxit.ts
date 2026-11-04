import * as Contracts from '@correxit/contracts';
import { Token } from '@lumino/coreutils';
import { Workbook } from '.';
import { commands as COMMANDS, CommandIDs as COMMAND_IDS } from './commands';
import * as description from './description';
import * as error from './error';
import { Icons as ICONS } from './icons';

/** Tokens and contracts for composing Correxit JupyterLab plugins. */
export namespace Correxit {
  export import Collector = Contracts.Collector;
  export const COLLECTOR = Contracts.COLLECTOR;

  export import Distributor = Contracts.Distributor;
  export const DISTRIBUTOR = Contracts.DISTRIBUTOR;

  export import Identifier = Contracts.Identifier;
  export import Notebook = Contracts.Notebook;

  export type Injector = (workbook: Workbook | null) => void;

  export type Monitor = AsyncIterable<Workbook | null>;

  export import Registrar = Contracts.Registrar;
  export const REGISTRAR = Contracts.REGISTRAR;

  export import Registration = Contracts.Registration;
  export import Resource = Contracts.Resource;
  export import Secret = Contracts.Secret;

  export import Submitter = Contracts.Submitter;
  export const SUBMITTER = Contracts.SUBMITTER;

  export import Unlocker = Contracts.Unlocker;
  export const UNLOCKER = Contracts.UNLOCKER;

  export const CORRECTOR = 'correxit:corrector';

  export const DESCRIPTION = {
    COLLECTOR: description.COLLECTOR,
    DISTRIBUTOR: description.DISTRIBUTOR,
    CORRECTOR: description.CORRECTOR,
    MONITOR: description.MONITOR,
    REGISTRAR: description.REGISTRAR,
    SUBMITTER: description.SUBMITTER,
    UI: description.UI,
    UNLOCKER: description.UNLOCKER
  };

  export namespace Error {
    export import Decrypt   = error.Decrypt;
    export import Encrypt   = error.Encrypt;
    export import Seal      = error.Seal;
    export import Unseal    = error.Unseal;
    export import Mismatch  = error.Mismatch;
    export import Invalid   = error.Invalid;
    export import Certify   = error.Certify;
    export import Lock      = error.Lock;
    export import Submit    = error.Submit;
    export import Revise    = error.Revise;
    export import Unlock    = error.Unlock;
    export import Save      = error.Save;
    export import Fetch     = error.Fetch;
    export import Plugin    = error.Plugin;
    export import interpret = error.interpret;
    export import reason    = error.reason;
  }

  export const GALATA = 'correxit:galata';
  export import CommandIDs = COMMAND_IDS;
  export const commands = COMMANDS;
  export import Icons = ICONS;

  export const MONITOR = 'correxit:monitor';
  export const Monitor = new Token<Monitor>(MONITOR);

  export const NO_CORREXIT_METADATA = new TypeError('no correxit metadata');
  export const TOOLBARS = 'correxit:toolbars';
  export const UI = 'correxit:ui';
}
