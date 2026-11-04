# @correxit/contracts

Stable plugin contracts and Lumino tokens for [Correxit](https://correx.it) JupyterLab extensions.

## Design

`@correxit/contracts` defines the integration surface between Correxit and external plugins
(`Distributor`, `Collector`, `Registrar`, `Submitter`, and `Unlocker`).

- **Data-only payloads:** Plugin interfaces operate purely on JSON-serializable payloads,
  identifiers, and Lumino tokens—never on internal Correxit models or JupyterLab widgets.
- **Slower-moving & dependable:** Modeled after `@jupyterlab/rendermime-interfaces`, this
  package follows strict Semantic Versioning and evolves by adding new tokens rather
  than breaking existing interfaces.
- **Singleton tokens:** All plugins and Correxit must share a single instance of this package
  via JupyterLab module federation (`singleton: true`).

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
        "bundled": false,
        "singleton": true
      }
    }
  }
}
```

## License

BSD-3-Clause
