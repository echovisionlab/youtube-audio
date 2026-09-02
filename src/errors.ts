export type YoutubeAudioErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_UPSTREAM_RESPONSE'
  | 'REQUEST_ABORTED'
  | 'SOURCE_EXPIRED'
  | 'SOURCE_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'UNSUPPORTED_VIDEO'
  | 'UPSTREAM_FAILURE';

export class YoutubeAudioError extends Error {
  readonly code: YoutubeAudioErrorCode;

  constructor(code: YoutubeAudioErrorCode, message: string) {
    super(message);
    this.name = 'YoutubeAudioError';
    this.code = code;
  }
}
