# @correxit/contracts Changelog

## 1.0.0

Initial release of `@correxit/contracts`.

- Published `Collector`, `Distributor`, `Registrar`, `Submitter`, and `Unlocker`
  types and tokens independently from Correxit.
- Replaced internal model parameters with plain-data payloads.
- Changed `Unlocker.request()` to yield credentials through an async iterable.
  `store()` retains author keys; Correxit handles authentication and decryption.

See the [migration guide](https://github.com/correxit/correxit/blob/main/docs/plugins.md#migrating-existing-plugins)
for changes required in existing plugins.
