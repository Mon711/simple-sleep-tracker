import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { readAssets } from '../local/assets.mjs';

const assets = Array.from(readAssets(resolve('dist/client')), ([path, asset]) =>
  [path, { base64: asset.bytes.toString('base64'), contentType: asset.contentType }],
);

await build({
  entryPoints: ['src/server/sites.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/server/index.js',
  minify: true,
  plugins: [{
    name: 'embed-vite-assets',
    setup(plugin) {
      plugin.onResolve({ filter: /^tracker:assets$/ }, args => ({ path: args.path, namespace: 'embedded' }));
      plugin.onLoad({ filter: /.*/, namespace: 'embedded' }, () => ({
        contents: 'const assets = new Map(' + JSON.stringify(assets) + ');\n' +
          'export function embeddedAsset(path) {\n' +
          '  const asset = assets.get(path);\n' +
          '  if (!asset) return undefined;\n' +
          '  return { body: Uint8Array.from(atob(asset.base64), c => c.charCodeAt(0)), contentType: asset.contentType };\n' +
          '}\n',
      }));
    },
  }],
});

mkdirSync('dist/.openai', { recursive: true });
cpSync('.openai/hosting.json', 'dist/.openai/hosting.json');
