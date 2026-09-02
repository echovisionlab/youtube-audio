import { Innertube, type Types } from 'youtubei.js';
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
  /** Optional container preference such as `m4a` or `webm`. */
  readonly format?: string;
}

export function createYoutubeJsAudioProvider(
  options: CreateYoutubeJsAudioProviderOptions = {},
): YoutubeAudioProvider {
  let clientPromise: Promise<Innertube> | undefined;
  const clientType = options.client ?? 'IOS';

  return {
    async resolve(video, signal) {
      throwIfAborted(signal);
      const innertube = await getInnertube();
      throwIfAborted(signal);
      try {
        const info = await innertube.getBasicInfo(
          video.videoId,
          videoInfoOptions(clientType),
        );
        throwIfAborted(signal);
        if (info.basic_info.is_live || info.basic_info.is_upcoming) {
          throw new YoutubeAudioError(
            'UNSUPPORTED_VIDEO',
            'Live and upcoming YouTube videos are not supported.',
          );
        }
        const format = info.chooseFormat({
          ...videoInfoOptions(clientType),
          format: options.format ?? 'any',
          quality: 'best',
          type: 'audio',
        });
        format.url = await format.decipher(innertube.session.player);
        throwIfAborted(signal);
        return toUpstreamSource(video, info.basic_info.title, format);
      } catch (error) {
        rethrowYoutubeJsError(error, signal);
      }
    },
  };

  function getInnertube(): Promise<Innertube> {
    clientPromise ??= options.innertube === undefined
      ? Innertube.create(options.innertubeConfig)
      : Promise.resolve(options.innertube);
    return clientPromise;
  }
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
