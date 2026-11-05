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
for payloads, provider replacement, examples, and migration from the earlier API.

## License

[BSD-3-Clause](https://github.com/correxit/correxit/blob/main/packages/contracts/LICENSE)
