import { describe, expect, it } from 'vitest';
import { parseYoutubeVideoUrl } from './youtube-url.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('parseYoutubeVideoUrl', () => {
  it.each([
    VIDEO_ID,
    `https://www.youtube.com/watch?v=${VIDEO_ID}&list=ignored`,
    `http://youtube.com/watch?v=${VIDEO_ID}`,
    `https://m.youtube.com/watch?v=${VIDEO_ID}`,
    `https://music.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtu.be/${VIDEO_ID}?si=ignored`,
    `https://www.youtube.com/shorts/${VIDEO_ID}`,
    `https://www.youtube.com/embed/${VIDEO_ID}`,
    `https://www.youtube.com/live/${VIDEO_ID}`,
    `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
  ])('parses and canonicalizes %s', (input) => {
    const result = parseYoutubeVideoUrl(input);

    expect(result).toEqual({
      canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      videoId: VIDEO_ID,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    '',
    'x'.repeat(2_049),
    'not a url',
    'ftp://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://evil.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/channel/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/',
    'https://www.youtube.com/shorts/bad',
  ])('rejects %s', (input) => {
    expect(() => parseYoutubeVideoUrl(input)).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  });
});
