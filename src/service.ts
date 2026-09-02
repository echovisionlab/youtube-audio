import { randomUUID } from 'node:crypto';
import type {
  CreateYoutubeAudioServiceOptions,
  ReadYoutubeAudioRequest,
  ResolvedYoutubeAudio,
  ResolveYoutubeAudioRequest,
  RevokeYoutubeAudioRequest,
  YoutubeAudioService,
  YoutubeAudioSourceRecord,
  YoutubeAudioUpstreamSource,
} from './contracts.js';
import { YoutubeAudioError } from './errors.js';
import { parseYoutubeVideoUrl } from './youtube-url.js';

const DEFAULT_SOURCE_TTL_MS = 10 * 60 * 1_000;
const MAX_SOURCE_TTL_MS = 60 * 60 * 1_000;
const SUBJECT_MAX_LENGTH = 256;

export function createYoutubeAudioService(
  options: CreateYoutubeAudioServiceOptions,
): YoutubeAudioService {
  const sourceTtlMs = validateTtl(options.sourceTtlMs ?? DEFAULT_SOURCE_TTL_MS);
  const now = options.now ?? Date.now;
  const createSourceId = options.createSourceId ?? randomUUID;
  const fetchSource = options.fetch ?? fetch;

  return {
    async resolve(request) {
      return resolveSource(request);
    },
    async read(request) {
      return readSource(request);
    },
    async revoke(request) {
      await revokeSource(request);
    },
  };

  async function resolveSource(
    request: ResolveYoutubeAudioRequest,
  ): Promise<ResolvedYoutubeAudio> {
    const subject = validateSubject(request.subject);
    throwIfAborted(request.signal);
    const video = parseYoutubeVideoUrl(request.url);
    let upstream: YoutubeAudioUpstreamSource;
    try {
      upstream = await options.provider.resolve(video, request.signal);
    } catch (error) {
      rethrowProviderError(error, request.signal);
    }
    throwIfAborted(request.signal);
    validateUpstreamSource(upstream, video.videoId, now());

    const issuedAt = now();
    const ttlExpiry = issuedAt + sourceTtlMs;
    const expiresAt =
      upstream.expiresAt === null
        ? ttlExpiry
        : Math.min(ttlExpiry, upstream.expiresAt);
    const sourceId = validateSourceId(createSourceId());
    const sourceUrl = validateSourceUrl(options.makeSourceUrl(sourceId));
    const record: YoutubeAudioSourceRecord = Object.freeze({
      expiresAt,
      id: sourceId,
      subject,
      upstream: freezeUpstream(upstream),
    });
    await options.sourceStore.put(record);

    return Object.freeze({
      contentType: upstream.contentType,
      expiresAt,
      input: Object.freeze({
        http: Object.freeze({
          credentials: 'include' as const,
          size: upstream.size,
          url: sourceUrl,
        }),
        name: upstream.fileName,
      }),
      sourceId,
      title: upstream.title,
      videoId: upstream.videoId,
    });
  }

  async function readSource(request: ReadYoutubeAudioRequest): Promise<Response> {
    const subject = validateSubject(request.subject);
    const sourceId = validateSourceId(request.sourceId);
    throwIfAborted(request.signal);
    const record = await options.sourceStore.get(sourceId);
    if (record === null) {
      throw new YoutubeAudioError('SOURCE_NOT_FOUND', 'Audio source was not found.');
    }
    if (record.subject !== subject) {
      throw new YoutubeAudioError('UNAUTHORIZED', 'Audio source access is denied.');
    }
    if (record.expiresAt <= now()) {
      await options.sourceStore.delete(sourceId);
      throw new YoutubeAudioError('SOURCE_EXPIRED', 'Audio source has expired.');
    }
    const range = parseClosedRange(request.range, record.upstream.size);
    const headers = createUpstreamHeaders(record.upstream, range.header);
    let response: Response;
    try {
      response = await fetchSource(record.upstream.url, {
        cache: 'no-store',
        headers,
        method: 'GET',
        redirect: 'follow',
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch {
      throwIfAborted(request.signal);
      throw new YoutubeAudioError(
        'UPSTREAM_FAILURE',
        'The upstream audio range request failed.',
      );
    }
    throwIfAborted(request.signal);
    validateUpstreamRangeResponse(response, range, record.upstream.size);
    if (response.body === null) {
      throw new YoutubeAudioError(
        'INVALID_UPSTREAM_RESPONSE',
        'The upstream audio response has no body.',
      );
    }
    return new Response(response.body, {
      headers: {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${record.upstream.size}`,
        'Content-Type': record.upstream.contentType,
      },
      status: 206,
    });
  }

  async function revokeSource(
    request: RevokeYoutubeAudioRequest,
  ): Promise<void> {
    const subject = validateSubject(request.subject);
    const sourceId = validateSourceId(request.sourceId);
    const record = await options.sourceStore.get(sourceId);
    if (record === null) {
      return;
    }
    if (record.subject !== subject) {
      throw new YoutubeAudioError('UNAUTHORIZED', 'Audio source access is denied.');
    }
    await options.sourceStore.delete(sourceId);
  }
}

interface ClosedRange {
  readonly end: number;
  readonly header: string;
  readonly start: number;
}

function parseClosedRange(value: string, size: number): ClosedRange {
  const match = /^bytes=(\d+)-(\d+)$/.exec(value);
  if (match === null) {
    throw new YoutubeAudioError(
      'INVALID_REQUEST',
      'A single closed byte range is required.',
    );
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end >= size
  ) {
    throw new YoutubeAudioError(
      'INVALID_REQUEST',
      'The requested byte range is outside the audio source.',
    );
  }
  return { end, header: `bytes=${start}-${end}`, start };
}

function validateUpstreamRangeResponse(
  response: Response,
  range: ClosedRange,
  size: number,
): void {
  if (!response.ok) {
    throw new YoutubeAudioError(
      'UPSTREAM_FAILURE',
      `The upstream audio range request returned status ${response.status}.`,
    );
  }
  const expected = `bytes ${range.start}-${range.end}/${size}`;
  if (response.status !== 206 || response.headers.get('content-range') !== expected) {
    throw new YoutubeAudioError(
      'INVALID_UPSTREAM_RESPONSE',
      'The upstream server did not honor the exact audio byte range.',
    );
  }
}

function createUpstreamHeaders(
  source: YoutubeAudioUpstreamSource,
  range: string,
): Headers {
  let headers: Headers;
  try {
    headers = new Headers(source.headers);
  } catch {
    throw new YoutubeAudioError(
      'INVALID_UPSTREAM_RESPONSE',
      'The upstream audio request headers are invalid.',
    );
  }
  if (headers.has('range')) {
    throw new YoutubeAudioError(
      'INVALID_UPSTREAM_RESPONSE',
      'The upstream audio source must not override Range.',
    );
  }
  headers.set('Range', range);
  return headers;
}

function validateUpstreamSource(
  source: YoutubeAudioUpstreamSource,
  expectedVideoId: string,
  now: number,
): void {
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    throw invalidUpstream();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    source.videoId !== expectedVideoId ||
    !Number.isSafeInteger(source.size) ||
    source.size < 1 ||
    !isNonEmpty(source.contentType) ||
    !isNonEmpty(source.fileName) ||
    !isNonEmpty(source.title) ||
    (source.expiresAt !== null &&
      (!Number.isSafeInteger(source.expiresAt) || source.expiresAt <= now))
  ) {
    throw invalidUpstream();
  }
}

function freezeUpstream(
  source: YoutubeAudioUpstreamSource,
): YoutubeAudioUpstreamSource {
  return Object.freeze({
    ...source,
    ...(source.headers === undefined
      ? {}
      : { headers: Object.freeze({ ...source.headers }) }),
  });
}

function validateSubject(subject: string): string {
  const value = subject.trim();
  if (value.length === 0 || value.length > SUBJECT_MAX_LENGTH) {
    throw new YoutubeAudioError(
      'UNAUTHORIZED',
      'An authenticated subject is required.',
    );
  }
  return value;
}

function validateSourceId(sourceId: string): string {
  const value = sourceId.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    throw new YoutubeAudioError('INVALID_REQUEST', 'Audio source ID is invalid.');
  }
  return value;
}

function validateSourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new YoutubeAudioError(
      'INVALID_REQUEST',
      'makeSourceUrl must return an absolute HTTP(S) URL.',
    );
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new YoutubeAudioError(
      'INVALID_REQUEST',
      'makeSourceUrl must return an absolute HTTP(S) URL.',
    );
  }
  return url.href;
}

function validateTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_SOURCE_TTL_MS) {
    throw new YoutubeAudioError(
      'INVALID_REQUEST',
      `sourceTtlMs must be an integer from 1000 to ${MAX_SOURCE_TTL_MS}.`,
    );
  }
  return value;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new YoutubeAudioError('REQUEST_ABORTED', 'The audio request was aborted.');
  }
}

function rethrowProviderError(error: unknown, signal?: AbortSignal): never {
  throwIfAborted(signal);
  if (error instanceof YoutubeAudioError) {
    throw error;
  }
  throw new YoutubeAudioError(
    'UPSTREAM_FAILURE',
    'YouTube audio resolution failed.',
  );
}

function invalidUpstream(): YoutubeAudioError {
  return new YoutubeAudioError(
    'INVALID_UPSTREAM_RESPONSE',
    'The resolved YouTube audio source is invalid.',
  );
}

function isNonEmpty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
