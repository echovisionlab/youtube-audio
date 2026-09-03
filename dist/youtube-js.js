import { Innertube } from 'youtubei.js';
import { YoutubeAudioError } from './errors.js';
export function createYoutubeJsAudioProvider(options = {}) {
    let clientPromise;
    // The provider feeds a random-access browser transcoder. VISIONOS currently
    // returns direct audio sources that honor non-zero and end-of-file ranges;
    // IOS sources can resolve successfully while rejecting those reads with 403.
    const clientType = options.client ?? 'VISIONOS';
    return {
        async resolve(video, signal) {
            throwIfAborted(signal);
            const innertube = await getInnertube();
            throwIfAborted(signal);
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
                format.url = await format.decipher(innertube.session.player);
                throwIfAborted(signal);
                return toUpstreamSource(video, info.basic_info.title, format);
            }
            catch (error) {
                rethrowYoutubeJsError(error, signal);
            }
        },
    };
    function getInnertube() {
        clientPromise ??= options.innertube === undefined
            ? Innertube.create(options.innertubeConfig)
            : Promise.resolve(options.innertube);
        return clientPromise;
    }
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