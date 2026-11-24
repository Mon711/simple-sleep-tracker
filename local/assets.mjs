import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

export function readAssets(directory) {
  const assets = new Map();
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const contentType = types[extname(path)];
    if (!contentType) throw new Error('Unexpected type in the browser build.');
    const key = '/' + relative(directory, path).split(sep).join('/');
    assets.set(key, { bytes: readFileSync(path), contentType });
  }
  return assets;
}
