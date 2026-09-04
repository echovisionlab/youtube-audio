import { Innertube, Platform } from 'youtubei.js';
import { YoutubeAudioError } from './errors.js';
export function createYoutubeJsAudioProvider(options = {}) {
    let clientPromise;
    const clientTypes = options.client === undefined
        ? ['VISIONOS', 'YTKIDS']
        : [options.client];
    const fetcher = options.fetcher ?? fetch;
    return {
        async resolve(video, signal) {
            throwIfAborted(signal);
            const innertube = await getInnertube();
            throwIfAborted(signal);
            let lastError;
            for (const clientType of clientTypes) {
                try {
                    const info = await innertube.getBasicInfo(video.videoId, videoInfoOptions(clientType));
                    throwIfAborted(signal);
                    if (info.basic_info.is_live || info.basic_info.is_upcoming) {
                        throw new YoutubeAudioError('UNSUPPORTED_VIDEO', 'Live and upcoming YouTube videos are not supported.');
                    }
                    const format = info.chooseFormat({
                        ...videoInfoOptions(clientType),
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
                catch (error) {
                    throwIfAborted(signal);
                    lastError = error;
                }
            }
            rethrowYoutubeJsError(lastError, signal);
        },
    };
    function getInnertube() {
        clientPromise ??= options.innertube === undefined
            ? Innertube.create(options.innertubeConfig)
            : Promise.resolve(options.innertube);
        return clientPromise;
    }
}
async function decipherFormat(format, innertube) {
    try {
        return await format.decipher(innertube.session.player);
    }
    catch (error) {
        if (!isMissingJavascriptEvaluator(error)) {
            throw error;
        }
        Platform.shim.eval = async (data) => new Function(data.output)();
        return format.decipher(innertube.session.player);
    }
}
async function validateRandomAccessSource(source, fetcher, signal) {
    const positions = new Set([0, Math.floor((source.size - 1) / 2), source.size - 1]);
    for (const position of positions) {
        throwIfAborted(signal);
        const response = await fetcher(source.url, {
            headers: { Range: `bytes=${position}-${position}` },
            ...(signal === undefined ? {} : { signal }),
        });
        const expectedRange = `bytes ${position}-${position}/${source.size}`;
        const valid = response.status === 206 && response.headers.get('content-range') === expectedRange;
        await response.body?.cancel().catch(() => undefined);
        if (!valid) {
            throw new YoutubeAudioError('UPSTREAM_FAILURE', 'YouTube did not provide a stable random-access audio source.');
        }
    }
}
function isMissingJavascriptEvaluator(error) {
    return error instanceof Error && error.message.includes('provide your own JavaScript evaluator');
}
function toUpstreamSource(video, title, format) {
    if (typeof title !== 'string' ||
        title.trim().length === 0 ||
        typeof format.url !== 'string' ||
        format.url.length === 0 ||
        !Number.isSafeInteger(format.content_length) ||
        (format.content_length ?? 0) < 1 ||
        !format.has_audio ||
        format.has_video) {
        throw new YoutubeAudioError('UNSUPPORTED_VIDEO', 'YouTube did not provide a finite audio-only source.');
    }
    const contentType = format.mime_type.split(';', 1)[0]?.trim();
    if (contentType === undefined || !contentType.startsWith('audio/')) {
        throw new YoutubeAudioError('UNSUPPORTED_VIDEO', 'YouTube did not provide a supported audio content type.');
    }
    const upstreamUrl = new URL(format.url);
    return Object.freeze({
        contentType,
        expiresAt: readExpiry(upstreamUrl),
        fileName: `${sanitizeFileName(title)}.${extensionFor(contentType)}`,
        size: format.content_length,
        title: title.trim(),
        url: upstreamUrl.href,
        videoId: video.videoId,
    });
}
function videoInfoOptions(client) {
    return { client };
}
function readExpiry(url) {
    const seconds = Number(url.searchParams.get('expire'));
    if (!Number.isSafeInteger(seconds) || seconds < 1) {
        return null;
    }
    return seconds * 1_000;
}
function extensionFor(contentType) {
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
function sanitizeFileName(title) {
    const sanitized = title
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 120);
    return sanitized.length === 0 ? 'youtube-audio' : sanitized;
}
function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new YoutubeAudioError('REQUEST_ABORTED', 'The audio request was aborted.');
    }
}
function rethrowYoutubeJsError(error, signal) {
    throwIfAborted(signal);
    if (error instanceof YoutubeAudioError) {
        throw error;
    }
    throw new YoutubeAudioError('UPSTREAM_FAILURE', 'YouTube.js could not resolve the audio source.');
}
//# sourceMappingURL=youtube-js.js.map