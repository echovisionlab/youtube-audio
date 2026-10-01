import { describe, expect, it } from 'vitest';
import { createMemoryYoutubeAudioSourceStore } from './memory-store.js';
import type { YoutubeAudioSourceRecord } from './contracts.js';

describe('memory source store', () => {
  it('stores, replaces, reads, and deletes records', async () => {
    const store = createMemoryYoutubeAudioSourceStore({ now: () => 0 });
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

  it('prunes expired records on each operation without evicting live records', async () => {
    let currentTime = 0;
    const store = createMemoryYoutubeAudioSourceStore({ now: () => currentTime });
    const expiring = record('expiring', 'expired-id', 10);
    const live = record('live', 'live-id', 100);
    await store.put(expiring);
    await store.put(live);

    currentTime = 10;
    await expect(store.get('live-id')).resolves.toBe(live);
    await expect(store.get('expired-id')).resolves.toBeNull();

    await store.put(record('already-expired', 'already-expired-id', 10));
    await expect(store.get('already-expired-id')).resolves.toBeNull();

    const anotherExpiring = record('another-expiring', 'another-expired-id', 20);
    currentTime = 15;
    await store.put(anotherExpiring);
    currentTime = 20;
    await store.delete('live-id');
    await expect(store.get('another-expired-id')).resolves.toBeNull();
    await expect(store.get('live-id')).resolves.toBeNull();
  });

  it('skips full-map expiry scans until the earliest record expires', async () => {
    const recordCount = 200;
    let currentTime = 0;
    let expiryReads = 0;
    const store = createMemoryYoutubeAudioSourceStore({ now: () => currentTime });

    for (let index = 0; index < recordCount; index += 1) {
      const source = record(`source-${index}`, `source-${index}`, 100);
      Object.defineProperty(source, 'expiresAt', {
        get() {
          expiryReads += 1;
          return 100;
        },
      });
      await store.put(source);
    }

    expect(expiryReads).toBe(recordCount);
    currentTime = 100;
    await store.get('unrelated-trigger');
    expect(expiryReads).toBe(recordCount * 2);
    await expect(store.get('source-0')).resolves.toBeNull();
  });
});

function record(
  title: string,
  id = 'source-id',
  expiresAt = 2_000,
): YoutubeAudioSourceRecord {
  return {
    expiresAt,
    id,
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
