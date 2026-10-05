import type { YoutubeAudioSourceStore } from './contracts.js';
export interface CreateMemoryYoutubeAudioSourceStoreOptions {
    readonly now?: () => number;
}
export declare function createMemoryYoutubeAudioSourceStore(options?: CreateMemoryYoutubeAudioSourceStoreOptions): YoutubeAudioSourceStore;
//# sourceMappingURL=memory-store.d.ts.map