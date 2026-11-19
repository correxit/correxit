# @correxit/contracts

Plugin types and Lumino tokens for integrating with [Correxit](https://correx.it)
in JupyterLab.

`Distributor`, `Collector`, `Registrar`, `Submitter`, and `Unlocker` use plain
data: notebook JSON, identifiers, scores, credentials, and resource bytes. They
do not depend on Correxit's internal models or JupyterLab widgets.

This package follows Semantic Versioning and is released independently from
Correxit, so plugins can depend on the contracts they use without tracking
every Correxit release.

## Installation

```bash
jlpm add @correxit/contracts
```

In your JupyterLab extension's `package.json`, configure:

```json
{
  "jupyterlab": {
    "sharedPackages": {
      "@correxit/contracts": {
        "singleton": true
      }
    }
  }
}
```

Correxit and your plugin must share the same token instances. The singleton
setting enables that sharing; Correxit must also be installed in JupyterLab.

See the [integration guide](https://github.com/correxit/correxit/blob/main/docs/plugins.md)
for payloads, provider replacement, and examples.

## License

Copyright (c) 2026, A. T. Darian.

This package follows the same public-license schedule as Correxit. It is
licensed under the [GNU Affero General Public License version 3 only](LICENSE)
(`AGPL-3.0-only`). At 00:00 UTC on 1 January 2028, it will also become available
under `BSD-3-Clause`; releases made from that time forward will use
`BSD-3-Clause`. Rights already granted under the AGPL remain in effect.

See Correxit's [licensing policy](https://github.com/correxit/correxit/blob/main/README.md#license)
and [contribution terms](https://github.com/correxit/correxit/blob/main/CONTRIBUTING.md).
