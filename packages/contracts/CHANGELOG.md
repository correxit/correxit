# @correxit/contracts Changelog

## 1.0.0

Initial release of `@correxit/contracts`.

- Extracted stable, data-only plugin contracts (`Collector`, `Distributor`, `Registrar`, `Submitter`, `Unlocker`) and Lumino tokens into a dedicated package.
- Removed `Workbook` and internal model dependencies from plugin signatures.
- Split `Unlocker` into key-custody generator `request()` and author-key persistence `store()`, dropping `unlock()` from the external contract so Correxit handles all decryption and cryptographic verification internally.
- Added singleton Lumino tokens for runtime plugin resolution.

