import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateYoutubeAudioServiceOptions,
  YoutubeAudioProvider,
  YoutubeAudioSourceRecord,
  YoutubeAudioSourceStore,
  YoutubeAudioUpstreamSource,
} from './contracts.js';
import { YoutubeAudioError } from './errors.js';
import { createMemoryYoutubeAudioSourceStore } from './memory-store.js';
import { createYoutubeAudioService } from './service.js';

const VIDEO_ID = 'dQw4w9WgXcQ';
const NOW = 1_700_000_000_000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('youtube audio service', () => {
  it('provides bounded server defaults when optional dependencies are omitted', async () => {
    const before = Date.now();
    const service = createYoutubeAudioService({
      makeSourceUrl: (id) => `https://example.test/source/${id}`,
      provider: { resolve: async () => source({ expiresAt: null }) },
      sourceStore: createMemoryYoutubeAudioSourceStore(),
    });

    const resolved = await service.resolve(request());

    expect(resolved.sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolved.expiresAt).toBeGreaterThanOrEqual(before + 10 * 60_000);
    expect(resolved.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
  });

  it('resolves, proxies an exact range, and revokes an owned source', async () => {
    const upstream = source({
      expiresAt: NOW + 20 * 60_000,
      headers: { 'User-Agent': 'youtube-audio' },
    });
    const fetch = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => rangeResponse([20, 30], 'bytes 1-2/4'));
    const store = createMemoryYoutubeAudioSourceStore();
    const provider: YoutubeAudioProvider = {
      resolve: vi.fn(async () => upstream),
    };
    const service = createService({ fetch, provider, sourceStore: store });

    const resolved = await service.resolve({
      subject: ' user-1 ',
      url: `https://youtu.be/${VIDEO_ID}`,
    });

    expect(resolved).toEqual({
      contentType: 'audio/mp4',
      expiresAt: NOW + 10 * 60_000,
      input: {
        http: {
          credentials: 'include',
          size: 4,
          url: 'https://example.test/api/tools/youtube-audio/source-id-123',
        },
        name: 'Source title.m4a',
      },
      sourceId: 'source-id-123',
      title: 'Source title',
      videoId: VIDEO_ID,
    });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.input)).toBe(true);
    expect(Object.isFrozen(resolved.input.http)).toBe(true);
    expect(provider.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: VIDEO_ID }),
      undefined,
    );

    const response = await service.read({
      range: 'bytes=1-2',
      sourceId: resolved.sourceId,
      subject: 'user-1',
    });
    expect(response.status).toBe(206);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([20, 30]);
    expect(response.headers.get('content-range')).toBe('bytes 1-2/4');
    expect(response.headers.get('content-length')).toBe('2');
    expect(response.headers.get('content-type')).toBe('audio/mp4');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(upstream.url);
    expect(init).toMatchObject({ cache: 'no-store', method: 'GET', redirect: 'follow' });
    expect(new Headers(init?.headers).get('range')).toBe('bytes=1-2');
    expect(new Headers(init?.headers).get('user-agent')).toBe(
      'youtube-audio',
    );

    await service.revoke({ sourceId: resolved.sourceId, subject: 'user-1' });
    await expect(service.read({
      range: 'bytes=0-0',
      sourceId: resolved.sourceId,
      subject: 'user-1',
    })).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await expect(service.revoke({
      sourceId: resolved.sourceId,
      subject: 'user-1',
    })).resolves.toBeUndefined();
  });

  it('uses the earlier upstream expiry and freezes copied headers', async () => {
    const upstream = source({
      expiresAt: NOW + 60_000,
      headers: { Referer: 'https://www.youtube.com/' },
    });
    const store = createMemoryYoutubeAudioSourceStore();
    const service = createService({
      provider: { resolve: async () => upstream },
      sourceStore: store,
    });

    const resolved = await service.resolve(request());
    const record = await store.get(resolved.sourceId);

    expect(resolved.expiresAt).toBe(NOW + 60_000);
    expect(record?.upstream).not.toBe(upstream);
    expect(Object.isFrozen(record?.upstream)).toBe(true);
    expect(Object.isFrozen(record?.upstream.headers)).toBe(true);
  });

  it('uses the configured TTL when the upstream has no expiry', async () => {
    const service = createService({
      provider: { resolve: async () => source({ expiresAt: null }) },
      sourceTtlMs: 1_000,
    });

    await expect(service.resolve(request())).resolves.toMatchObject({
      expiresAt: NOW + 1_000,
    });
  });

  it('enforces subject ownership for reads and revocation', async () => {
    const service = createService();
    const resolved = await service.resolve(request());

    await expect(service.read({
      range: 'bytes=0-0',
      sourceId: resolved.sourceId,
      subject: 'user-2',
    })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(service.revoke({
      sourceId: resolved.sourceId,
      subject: 'user-2',
    })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('deletes expired sources before rejecting them', async () => {
    let current = NOW;
    const store = createMemoryYoutubeAudioSourceStore();
    const service = createService({ now: () => current, sourceStore: store });
    const resolved = await service.resolve(request());
    current = resolved.expiresAt;

    await expect(service.read({
      range: 'bytes=0-0',
      sourceId: resolved.sourceId,
      subject: 'user-1',
    })).rejects.toMatchObject({ code: 'SOURCE_EXPIRED' });
    await expect(store.get(resolved.sourceId)).resolves.toBeNull();
  });

  it.each([
    '',
    'x'.repeat(257),
  ])('requires an authenticated subject %#', async (subject) => {
    const service = createService();
    await expect(service.resolve({ ...request(), subject })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(service.read({
      range: 'bytes=0-0',
      sourceId: 'source-id-123',
      subject,
    })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it.each([999, 1.5, 3_600_001])('rejects invalid source TTL %s', (sourceTtlMs) => {
    expect(() => createService({ sourceTtlMs })).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  });

  it.each([
    'bad',
    'x'.repeat(129),
  ])('rejects invalid source IDs %#', async (sourceId) => {
    const service = createService();
    await expect(service.read({
      range: 'bytes=0-0',
      sourceId,
      subject: 'user-1',
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(service.revoke({ sourceId, subject: 'user-1' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it.each([
    '/relative',
    'file:///tmp/source',
    'https://user:pass@www.Echo Vision Lab/source',
  ])('rejects an invalid consumer source URL %s', async (sourceUrl) => {
    const service = createService({ makeSourceUrl: () => sourceUrl });
    await expect(service.resolve(request())).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it.each([
    ['bad URL', { url: '/relative' }],
    ['non-HTTPS URL', { url: 'http://example.com/source' }],
    ['embedded credentials', { url: 'https://user:pass@example.com/source' }],
    ['video mismatch', { videoId: 'aaaaaaaaaaa' }],
    ['fractional size', { size: 1.5 }],
    ['empty size', { size: 0 }],
    ['empty content type', { contentType: '' }],
    ['empty file name', { fileName: '' }],
    ['empty title', { title: '' }],
    ['fractional expiry', { expiresAt: NOW + 1.5 }],
    ['expired upstream', { expiresAt: NOW }],
  ] as const)('rejects invalid upstream metadata: %s', async (_label, change) => {
    const service = createService({
      provider: { resolve: async () => source(change) },
    });

    await expect(service.resolve(request())).rejects.toMatchObject({
      code: 'INVALID_UPSTREAM_RESPONSE',
    });
  });

  it('preserves classified provider failures and normalizes unknown failures', async () => {
    const classified = new YoutubeAudioError('UNSUPPORTED_VIDEO', 'unsupported');
    const classifiedService = createService({
      provider: { resolve: async () => Promise.reject(classified) },
    });
    const unknownService = createService({
      provider: { resolve: async () => Promise.reject(new Error('secret')) },
    });

    await expect(classifiedService.resolve(request())).rejects.toBe(classified);
    await expect(unknownService.resolve(request())).rejects.toMatchObject({
      code: 'UPSTREAM_FAILURE',
      message: 'YouTube audio resolution failed.',
    });
  });

  it('rejects pre-aborted and provider-aborted resolution', async () => {
    const pre = new AbortController();
    pre.abort();
    const provider = { resolve: vi.fn(async () => source()) };
    await expect(createService({ provider }).resolve({
      ...request(),
      signal: pre.signal,
    })).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(provider.resolve).not.toHaveBeenCalled();

    const during = new AbortController();
    const duringService = createService({
      provider: {
        async resolve() {
          during.abort();
          throw new Error('aborted upstream');
        },
      },
    });
    await expect(duringService.resolve({
      ...request(),
      signal: during.signal,
    })).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  });

  it.each([
    'bytes=0-',
    'bytes=-1',
    'bytes=0-0,2-2',
    'bytes=2-1',
    'bytes=0-4',
    `bytes=${Number.MAX_SAFE_INTEGER + 1}-${Number.MAX_SAFE_INTEGER + 1}`,
  ])('rejects unsupported or out-of-bounds ranges %s', async (range) => {
    const service = createService();
    const resolved = await service.resolve(request());

    await expect(service.read({
      range,
      sourceId: resolved.sourceId,
      subject: 'user-1',
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('normalizes fetch failures without exposing the upstream URL', async () => {
    const service = createService({
      fetch: vi.fn(async () => Promise.reject(new Error('token=secret'))),
    });
    const resolved = await service.resolve(request());

    await expect(service.read({
      range: 'bytes=0-0',
      sourceId: resolved.sourceId,
      subject: 'user-1',
    })).rejects.toEqual(expect.objectContaining({
      code: 'UPSTREAM_FAILURE',
      message: 'The upstream audio range request failed.',
    }));
  });

  it('maps fetch cancellation to REQUEST_ABORTED', async () => {
    const controller = new AbortController();
    const service = createService({
      fetch: vi.fn(async () => {
        controller.abort();
        throw new Error('aborted');
      }),
    });
    const resolved = await service.resolve(request());

    await expect(service.read({
      range: 'bytes=0-0',
      signal: controller.signal,
      sourceId: resolved.sourceId,
      subject: 'user-1',
    })).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  });

  it.each([
    ['failed status', new Response(null, { status: 403 }), 'UPSTREAM_FAILURE'],
    ['ignored range', new Response(new Uint8Array([1]), { status: 200 }), 'INVALID_UPSTREAM_RESPONSE'],
    ['wrong range', rangeResponse([1], 'bytes 1-1/4'), 'INVALID_UPSTREAM_RESPONSE'],
    ['empty body', new Response(null, {
      headers: { 'Content-Range': 'bytes 0-0/4' },
      status: 206,
    }), 'INVALID_UPSTREAM_RESPONSE'],
  ] as const)('rejects an upstream %s', async (_label, response, code) => {
    const service = createService({ fetch: vi.fn(async () => response) });
    const resolved = await service.resolve(request());

    await expect(service.read({
      range: 'bytes=0-0',
      sourceId: resolved.sourceId,
      subject: 'user-1',
    })).rejects.toMatchObject({ code });
  });

  it.each([
    { Range: 'bytes=0-0' },
    { 'X-Bad': 'line\nbreak' },
  ])('rejects invalid provider-owned headers %#', async (headers) => {
    const service = createService({
      provider: { resolve: async () => source({ headers }) },
    });
    const resolved = await service.resolve(request());

    await expect(service.read({
      range: 'bytes=0-0',
      sourceId: resolved.sourceId,
      subject: 'user-1',
    })).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
  });
});

function createService(
  overrides: Partial<CreateYoutubeAudioServiceOptions> = {},
) {
  return createYoutubeAudioService({
    createSourceId: () => 'source-id-123',
    fetch: vi.fn(async () => rangeResponse([10], 'bytes 0-0/4')),
    makeSourceUrl: (id) => `https://example.test/api/tools/youtube-audio/${id}`,
    now: () => NOW,
    provider: { resolve: async () => source() },
    sourceStore: createMemoryYoutubeAudioSourceStore(),
    ...overrides,
  });
}

function request() {
  return { subject: 'user-1', url: VIDEO_ID } as const;
}

function source(
  overrides: Partial<YoutubeAudioUpstreamSource> = {},
): YoutubeAudioUpstreamSource {
  return {
    contentType: 'audio/mp4',
    expiresAt: NOW + 20 * 60_000,
    fileName: 'Source title.m4a',
    size: 4,
    title: 'Source title',
    url: 'https://rr1.googlevideo.com/videoplayback?expire=1700001200',
    videoId: VIDEO_ID,
    ...overrides,
  };
}

function rangeResponse(bytes: readonly number[], contentRange: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Range': contentRange },
    status: 206,
  });
}
