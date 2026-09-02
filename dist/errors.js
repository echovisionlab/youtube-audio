export class YoutubeAudioError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'YoutubeAudioError';
        this.code = code;
    }
}
//# sourceMappingURL=errors.js.map