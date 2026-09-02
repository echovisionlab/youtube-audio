import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('youtubei.js', () => ({
  Innertube: class Innertube {
    static create = mocks.create;
  },
}));

import { YoutubeAudioError } from './errors.js';
import { createYoutubeJsAudioProvider } from './youtube-js.js';

const VIDEO = Object.freeze({
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  videoId: 'dQw4w9WgXcQ',
});

beforeEach(() => {
  mocks.create.mockReset();
});

describe('YouTube.js provider', () => {
  it('lazily creates one client and resolves a finite audio-only source', async () => {
    const client = fakeClient();
    mocks.create.mockResolvedValue(client);
    const provider = createYoutubeJsAudioProvider({
      client: 'ANDROID',
      format: 'm4a',
      innertubeConfig: { lang: 'ko' },
    });

    const first = await provider.resolve(VIDEO);
    const second = await provider.resolve(VIDEO);

    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith({ lang: 'ko' });
    expect(client.getBasicInfo).toHaveBeenCalledWith(VIDEO.videoId, {
      client: 'ANDROID',
    });
    expect(client.chooseFormat).toHaveBeenCalledWith({
      client: 'ANDROID',
      format: 'm4a',
      quality: 'best',
      type: 'audio',
    });
    expect(client.decipher).toHaveBeenCalledWith(client.session.player);
    expect(first).toEqual({
      contentType: 'audio/mp4',
      expiresAt: 2_000_000_000_000,
      fileName: 'A _ title.m4a',
      size: 4,
      title: 'A / title',
      url: 'https://rr1.googlevideo.com/videoplayback?expire=2000000000',
      videoId: VIDEO.videoId,
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(second).toEqual(first);
  });

  it('uses an application-owned client and default format options', async () => {
    const client = fakeClient();
    const provider = createYoutubeJsAudioProvider({ innertube: client as never });

    await provider.resolve(VIDEO);

    expect(mocks.create).not.toHaveBeenCalled();
    expect(client.getBasicInfo).toHaveBeenCalledWith(VIDEO.videoId, {
      client: 'IOS',
    });
    expect(client.chooseFormat).toHaveBeenCalledWith({
      client: 'IOS',
      format: 'any',
      quality: 'best',
      type: 'audio',
    });
  });

  it.each([
    ['audio/webm', 'webm'],
    ['audio/ogg', 'ogg'],
    ['audio/x-custom', 'audio'],
  ])('maps %s to the %s extension', async (mimeType, extension) => {
    const provider = createYoutubeJsAudioProvider({
      innertube: fakeClient({ mime_type: `${mimeType}; codecs="opus"` }) as never,
    });

    await expect(provider.resolve(VIDEO)).resolves.toMatchObject({
      contentType: mimeType,
      fileName: `A _ title.${extension}`,
    });
  });

  it.each([
    ['missing expiry', 'https://rr1.googlevideo.com/source'],
    ['fractional expiry', 'https://rr1.googlevideo.com/source?expire=1.5'],
  ])('uses a null expiry for %s', async (_label, url) => {
    const provider = createYoutubeJsAudioProvider({
      innertube: fakeClient({ url }) as never,
    });

    await expect(provider.resolve(VIDEO)).resolves.toMatchObject({
      expiresAt: null,
    });
  });

  it('sanitizes Windows separators, trailing dots, long names, and empty names', async () => {
    const longTitle = `${'가'.repeat(130)}... `;
    const longProvider = createYoutubeJsAudioProvider({
      innertube: fakeClient({}, { title: longTitle }) as never,
    });
    const emptyProvider = createYoutubeJsAudioProvider({
      innertube: fakeClient({}, { title: '... ' }) as never,
    });

    const long = await longProvider.resolve(VIDEO);
    const empty = await emptyProvider.resolve(VIDEO);
    expect(long.fileName).toBe(`${'가'.repeat(120)}.m4a`);
    expect(empty.fileName).toBe('youtube-audio.m4a');
  });

  it.each([
    ['live', {}, { is_live: true }],
    ['upcoming', {}, { is_upcoming: true }],
    ['missing title', {}, { title: undefined }],
    ['empty title', {}, { title: ' ' }],
    ['missing URL', { url: undefined }, {}],
    ['empty URL', { url: '' }, {}],
    ['missing size', { content_length: undefined }, {}],
    ['fractional size', { content_length: 1.5 }, {}],
    ['empty size', { content_length: 0 }, {}],
    ['no audio', { has_audio: false }, {}],
    ['has video', { has_video: true }, {}],
    ['missing MIME', { mime_type: '' }, {}],
    ['non-audio MIME', { mime_type: 'video/mp4' }, {}],
  ] as const)(
    'rejects unsupported %s metadata',
    async (_label, formatOverrides, infoOverrides) => {
      const provider = createYoutubeJsAudioProvider({
        innertube: fakeClient(formatOverrides, infoOverrides) as never,
      });

      await expect(provider.resolve(VIDEO)).rejects.toMatchObject({
        code: 'UNSUPPORTED_VIDEO',
      });
    },
  );

  it('preserves package errors and normalizes unknown YouTube.js failures', async () => {
    const classified = new YoutubeAudioError('UNSUPPORTED_VIDEO', 'classified');
    const classifiedProvider = createYoutubeJsAudioProvider({
      innertube: fakeClient({}, {}, classified) as never,
    });
    const unknownProvider = createYoutubeJsAudioProvider({
      innertube: fakeClient({}, {}, new Error('secret')) as never,
    });

    await expect(classifiedProvider.resolve(VIDEO)).rejects.toBe(classified);
    await expect(unknownProvider.resolve(VIDEO)).rejects.toMatchObject({
      code: 'UPSTREAM_FAILURE',
      message: 'YouTube.js could not resolve the audio source.',
    });
  });

  it('honors cancellation before creation, after creation, and during resolution', async () => {
    const before = new AbortController();
    before.abort();
    const beforeProvider = createYoutubeJsAudioProvider();
    await expect(beforeProvider.resolve(VIDEO, before.signal)).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
    });
    expect(mocks.create).not.toHaveBeenCalled();

    const afterCreate = new AbortController();
    mocks.create.mockImplementationOnce(async () => {
      afterCreate.abort();
      return fakeClient();
    });
    await expect(
      createYoutubeJsAudioProvider().resolve(VIDEO, afterCreate.signal),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });

    const during = new AbortController();
    const client = fakeClient();
    client.getBasicInfo.mockImplementationOnce(async () => {
      during.abort();
      return {
        basic_info: {
          is_live: false,
          is_upcoming: false,
          title: 'Title',
        },
        chooseFormat: client.chooseFormat,
      };
    });
    await expect(
      createYoutubeJsAudioProvider({ innertube: client as never }).resolve(
        VIDEO,
        during.signal,
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  });
});

function fakeClient(
  formatOverrides: Record<string, unknown> = {},
  infoOverrides: Record<string, unknown> = {},
  failure?: unknown,
) {
  const format = {
    content_length: 4,
    has_audio: true,
    has_video: false,
    mime_type: 'audio/mp4; codecs="mp4a.40.2"',
    url: 'https://rr1.googlevideo.com/videoplayback?expire=2000000000',
    ...formatOverrides,
  };
  const decipher = vi.fn(async () => format.url ?? '');
  const chooseFormat = vi.fn(() => ({ ...format, decipher }));
  return {
    getBasicInfo: vi.fn(async () => {
      if (failure !== undefined) throw failure;
      return {
        basic_info: {
          is_live: false,
          is_upcoming: false,
          title: 'A / title',
          ...infoOverrides,
        },
        chooseFormat,
      };
    }),
    chooseFormat,
    decipher,
    session: { player: { id: 'player' } },
  };
}
