const path = require('path');
const webpack = require('webpack');

const root = path.resolve(__dirname, '..');
const dependencies = require(path.join(root, 'package.json')).dependencies;

const external = ({ request }, callback) => {
  if (!request || request.startsWith('.') || path.isAbsolute(request)) {
    callback();
    return;
  }
  if (request in dependencies) {
    callback(null, request);
    return;
  }
  callback();
};

const config = {
  devtool: 'source-map',
  entry: path.join(root, 'lib', 'node.js'),
  experiments: { outputModule: true },
  externals: external,
  externalsType: 'module',
  mode: 'none',
  output: {
    chunkFormat: 'module',
    environment: { module: true },
    filename: 'node.mjs',
    library: { type: 'module' },
    module: true,
    path: path.join(root, 'lib')
  },
  target: 'node20'
};

webpack(config, (error, stats) => {
  if (error) {
    console.error(error);
    process.exitCode = 1;
    return;
  }

  const info = stats.toJson({ all: false, errors: true, warnings: true });
  for (const warning of info.warnings || []) console.warn(warning.message);
  for (const error of info.errors || []) console.error(error.message);
  if (stats.hasErrors()) process.exitCode = 1;
});
