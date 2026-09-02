import { YoutubeAudioError } from './errors.js';
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
    'm.youtube.com',
    'music.youtube.com',
    'www.youtube-nocookie.com',
    'www.youtube.com',
    'youtube.com',
]);
const PATH_VIDEO_PREFIXES = new Set(['embed', 'live', 'shorts']);
export function parseYoutubeVideoUrl(input) {
    const value = input.trim();
    if (VIDEO_ID_PATTERN.test(value)) {
        return reference(value);
    }
    if (value.length === 0 || value.length > 2_048) {
        throw invalidUrl();
    }
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw invalidUrl();
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') ||
        url.username !== '' ||
        url.password !== '') {
        throw invalidUrl();
    }
    const host = url.hostname.toLowerCase();
    let videoId = null;
    if (host === 'youtu.be') {
        videoId = url.pathname.split('/').filter(Boolean)[0] ?? null;
    }
    else if (YOUTUBE_HOSTS.has(host)) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (url.pathname === '/watch') {
            videoId = url.searchParams.get('v');
        }
        else if (segments[0] !== undefined && PATH_VIDEO_PREFIXES.has(segments[0])) {
            videoId = segments[1] ?? null;
        }
    }
    if (videoId === null || !VIDEO_ID_PATTERN.test(videoId)) {
        throw invalidUrl();
    }
    return reference(videoId);
}
function reference(videoId) {
    return Object.freeze({
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        videoId,
    });
}
function invalidUrl() {
    return new YoutubeAudioError('INVALID_REQUEST', 'Provide a valid YouTube video URL or video ID.');
}
//# sourceMappingURL=youtube-url.js.map