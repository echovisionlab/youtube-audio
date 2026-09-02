import { describe, expect, it } from 'vitest';
import { createMemoryYoutubeAudioSourceStore } from './memory-store.js';
import type { YoutubeAudioSourceRecord } from './contracts.js';

describe('memory source store', () => {
  it('stores, replaces, reads, and deletes records', async () => {
    const store = createMemoryYoutubeAudioSourceStore();
    const first = record('first');
    const replacement = record('replacement');

    await expect(store.get(first.id)).resolves.toBeNull();
    await store.put(first);
    await expect(store.get(first.id)).resolves.toBe(first);
    await store.put(replacement);
    await expect(store.get(first.id)).resolves.toBe(replacement);
    await store.delete(first.id);
    await expect(store.get(first.id)).resolves.toBeNull();
  });
});

function record(title: string): YoutubeAudioSourceRecord {
  return {
    expiresAt: 2_000,
    id: 'source-id',
    subject: 'user-1',
    upstream: {
      contentType: 'audio/mp4',
      expiresAt: null,
      fileName: `${title}.m4a`,
      size: 3,
      title,
      url: 'https://example.googlevideo.com/source',
      videoId: 'dQw4w9WgXcQ',
    },
  };
}
