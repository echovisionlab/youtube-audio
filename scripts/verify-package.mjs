import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = await import('../dist/index.js');
const adapter = await import('../dist/youtube-js.js');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

assert.equal(typeof root.createYoutubeAudioService, 'function');
assert.equal(typeof root.createMemoryYoutubeAudioSourceStore, 'function');
assert.equal(typeof root.parseYoutubeVideoUrl, 'function');
assert.equal(typeof adapter.createYoutubeJsAudioProvider, 'function');
assert.deepEqual(packageJson.exports, {
  '.': { types: './dist/index.d.ts', import: './dist/index.js' },
  './youtube-js': { types: './dist/youtube-js.d.ts', import: './dist/youtube-js.js' },
});
