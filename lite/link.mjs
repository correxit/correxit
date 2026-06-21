import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

const ext = resolve('correxit/labextension');
const dest = resolve('lite/_output/extensions/@quantstack/correxit');
const manifest = resolve('lite/_output/jupyter-lite.json');
const stable = resolve(ext, 'static/remoteEntry.js');

// Replace the copied extension with a symlink to the dev build.
rmSync(dest, { recursive: true, force: true });
symlinkSync(ext, dest);

// Patch the manifest so JupyterLite loads the current remoteEntry hash.
const pkg = JSON.parse(readFileSync(join(ext, 'package.json'), 'utf8'));
const load = pkg.jupyterlab._build.load;
const target = load.replace(/^static\//, '');

rmSync(stable, { force: true });
symlinkSync(target, stable);

const lite = JSON.parse(readFileSync(manifest, 'utf8'));
const entry = lite['jupyter-config-data'].federated_extensions.find(
  e => e.name === '@quantstack/correxit'
);

if (entry) {
  entry.load = 'static/remoteEntry.js';
  writeFileSync(manifest, JSON.stringify(lite, null, 2) + '\n');
}
