import { describe, expect, it } from 'vitest';
import { YoutubeAudioError } from './errors.js';

describe('YoutubeAudioError', () => {
  it('carries a stable public code and name', () => {
    const error = new YoutubeAudioError('INVALID_REQUEST', 'bad request');

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'bad request',
      name: 'YoutubeAudioError',
    });
  });
});
