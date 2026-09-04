import { Innertube, Platform, type Types } from 'youtubei.js';
import type {
  YoutubeAudioProvider,
  YoutubeAudioUpstreamSource,
  YoutubeVideoReference,
} from './contracts.js';
import { YoutubeAudioError } from './errors.js';

export interface CreateYoutubeJsAudioProviderOptions {
  /** Optional YouTube.js session, useful when the application owns its cache. */
  readonly innertube?: Innertube;
  /** Used only when `innertube` is omitted. */
  readonly innertubeConfig?: Types.InnerTubeConfig;
  /** Optional YouTube client override. */
  readonly client?: Types.InnerTubeClient;
  /** Test seam for validating random-access media reads. */
  readonly fetcher?: typeof fetch;
  /** Optional container preference such as `m4a` or `webm`. */
  readonly format?: string;
}

const DEFAULT_CLIENT_TYPES: readonly Types.InnerTubeClient[] = [
  'VISIONOS',
  'YTKIDS',
];

export function createYoutubeJsAudioProvider(
  options: CreateYoutubeJsAudioProviderOptions = {},
): YoutubeAudioProvider {
  let clientPromise: Promise<Innertube> | undefined;
  const clientTypes: readonly Types.InnerTubeClient[] = options.client === undefined
    ? DEFAULT_CLIENT_TYPES
    : [options.client];
  const fetcher = options.fetcher ?? fetch;

  return {
    async resolve(video, signal) {
      throwIfAborted(signal);
      let innertube: Innertube;
      try {
        innertube = await getInnertube();
      } catch (error) {
        rethrowYoutubeJsError(error, signal);
      }
      throwIfAborted(signal);
      let lastError: unknown;
      for (const clientType of clientTypes) {
        try {
          return await resolveWithClient(innertube, video, clientType, signal);
        } catch (error) {
          throwIfAborted(signal);
          lastError = error;
        }
      }
      rethrowYoutubeJsError(lastError, signal);
    },
  };

  function getInnertube(): Promise<Innertube> {
    if (clientPromise === undefined) {
      const creating = options.innertube === undefined
        ? Innertube.create(options.innertubeConfig)
        : Promise.resolve(options.innertube);
      clientPromise = creating.catch((error: unknown) => {
        // A transient initialization failure must not poison this provider for
        // every later request or retain the rejected promise indefinitely.
        clientPromise = undefined;
        throw error;
      });
    }
    return clientPromise;
  }

  async function resolveWithClient(
    innertube: Innertube,
    video: YoutubeVideoReference,
    clientType: Types.InnerTubeClient,
    signal?: AbortSignal,
  ): Promise<YoutubeAudioUpstreamSource> {
    const infoOptions = videoInfoOptions(clientType);
    const info = await innertube.getBasicInfo(video.videoId, infoOptions);
    throwIfAborted(signal);
    if (info.basic_info.is_live || info.basic_info.is_upcoming) {
      throw new YoutubeAudioError(
        'UNSUPPORTED_VIDEO',
        'Live and upcoming YouTube videos are not supported.',
      );
    }
    const format = info.chooseFormat({
      ...infoOptions,
      format: options.format ?? 'any',
      quality: 'best',
      type: 'audio',
    });
    format.url = await decipherFormat(format, innertube);
    throwIfAborted(signal);
    const source = toUpstreamSource(video, info.basic_info.title, format);
    await validateRandomAccessSource(source, fetcher, signal);
    return source;
  }
}

async function decipherFormat(
  format: Awaited<ReturnType<Innertube['getStreamingData']>>,
  innertube: Innertube,
): Promise<string> {
  try {
    return await format.decipher(innertube.session.player);
  } catch (error) {
    if (!isMissingJavascriptEvaluator(error)) {
      throw error;
    }
    Platform.shim.eval = async (data: Types.BuildScriptResult) =>
      new Function(data.output)();
    return format.decipher(innertube.session.player);
  }
}

async function validateRandomAccessSource(
  source: YoutubeAudioUpstreamSource,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<void> {
  const positions = new Set([
    0,
    Math.floor((source.size - 1) / 2),
    source.size - 1,
  ]);
  for (const position of positions) {
    throwIfAborted(signal);
    const response = await fetcher(source.url, {
      headers: { Range: `bytes=${position}-${position}` },
      ...(signal === undefined ? {} : { signal }),
    });
    const expectedRange = `bytes ${position}-${position}/${source.size}`;
    const valid =
      response.status === 206 &&
      response.headers.get('content-range') === expectedRange;
    // The probe needs headers only; cancelling promptly avoids retaining an
    // upstream response stream when clients return more than the requested byte.
    await response.body?.cancel().catch(() => undefined);
    if (!valid) {
      throw new YoutubeAudioError(
        'UPSTREAM_FAILURE',
        'YouTube did not provide a stable random-access audio source.',
      );
    }
  }
}

function isMissingJavascriptEvaluator(error: unknown): boolean {
  return error instanceof Error && error.message.includes('provide your own JavaScript evaluator');
}

function toUpstreamSource(
  video: YoutubeVideoReference,
  title: string | undefined,
  format: Awaited<ReturnType<Innertube['getStreamingData']>>,
): YoutubeAudioUpstreamSource {
  if (
    typeof title !== 'string' ||
    title.trim().length === 0 ||
    typeof format.url !== 'string' ||
    format.url.length === 0 ||
    !Number.isSafeInteger(format.content_length) ||
    (format.content_length ?? 0) < 1 ||
    !format.has_audio ||
    format.has_video
  ) {
    throw new YoutubeAudioError(
      'UNSUPPORTED_VIDEO',
      'YouTube did not provide a finite audio-only source.',
    );
  }
  const contentType = format.mime_type.split(';', 1)[0]?.trim();
  if (contentType === undefined || !contentType.startsWith('audio/')) {
    throw new YoutubeAudioError(
      'UNSUPPORTED_VIDEO',
      'YouTube did not provide a supported audio content type.',
    );
  }
  const upstreamUrl = new URL(format.url);
  return Object.freeze({
    contentType,
    expiresAt: readExpiry(upstreamUrl),
    fileName: `${sanitizeFileName(title)}.${extensionFor(contentType)}`,
    size: format.content_length!,
    title: title.trim(),
    url: upstreamUrl.href,
    videoId: video.videoId,
  });
}

function videoInfoOptions(
  client: Types.InnerTubeClient,
): Types.GetVideoInfoOptions {
  return { client };
}

function readExpiry(url: URL): number | null {
  const seconds = Number(url.searchParams.get('expire'));
  if (!Number.isSafeInteger(seconds) || seconds < 1) {
    return null;
  }
  return seconds * 1_000;
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'audio/mp4':
      return 'm4a';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/webm':
      return 'webm';
    default:
      return 'audio';
  }
}

function sanitizeFileName(title: string): string {
  const sanitized = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  return sanitized.length === 0 ? 'youtube-audio' : sanitized;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new YoutubeAudioError('REQUEST_ABORTED', 'The audio request was aborted.');
  }
}

function rethrowYoutubeJsError(error: unknown, signal?: AbortSignal): never {
  throwIfAborted(signal);
  if (error instanceof YoutubeAudioError) {
    throw error;
  }
  throw new YoutubeAudioError(
    'UPSTREAM_FAILURE',
    'YouTube.js could not resolve the audio source.',
  );
}
