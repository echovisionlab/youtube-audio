import { Innertube, type Types } from 'youtubei.js';
import type { YoutubeAudioProvider } from './contracts.js';
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
export declare function createYoutubeJsAudioProvider(options?: CreateYoutubeJsAudioProviderOptions): YoutubeAudioProvider;
//# sourceMappingURL=youtube-js.d.ts.map