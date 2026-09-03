import assert from 'node:assert/strict';

import { createYoutubeJsAudioProvider } from '../dist/youtube-js.js';

const videoId = process.env.YOUTUBE_VIDEO_ID?.trim();
assert.match(
  videoId ?? '',
  /^[A-Za-z0-9_-]{11}$/,
  'Set YOUTUBE_VIDEO_ID to an 11-character YouTube video ID.',
);

const source = await createYoutubeJsAudioProvider().resolve({
  canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  videoId,
});
const ranges = [
  ['head', 0, Math.min(11, source.size - 1)],
  [
    'middle',
    Math.floor(source.size / 2),
    Math.min(source.size - 1, Math.floor(source.size / 2) + 11),
  ],
  ['tail', Math.max(0, source.size - 4), source.size - 1],
];
const checks = [];

for (const [label, start, end] of ranges) {
  const response = await fetch(source.url, {
    headers: { Range: `bytes=${start}-${end}` },
  });
  const bytes = await response.arrayBuffer();
  assert.equal(response.status, 206, `${label} range returned ${response.status}.`);
  assert.equal(
    response.headers.get('content-range'),
    `bytes ${start}-${end}/${source.size}`,
    `${label} range returned an unexpected Content-Range.`,
  );
  assert.equal(
    bytes.byteLength,
    end - start + 1,
    `${label} range returned an unexpected body length.`,
  );
  checks.push({ bytes: bytes.byteLength, label, status: response.status });
}

console.log(JSON.stringify({ checks, contentType: source.contentType, size: source.size }));
