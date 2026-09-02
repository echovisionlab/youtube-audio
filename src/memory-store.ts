import type {
  YoutubeAudioSourceRecord,
  YoutubeAudioSourceStore,
} from './contracts.js';

export function createMemoryYoutubeAudioSourceStore(): YoutubeAudioSourceStore {
  const sources = new Map<string, YoutubeAudioSourceRecord>();
  return {
    async delete(id) {
      sources.delete(id);
    },
    async get(id) {
      return sources.get(id) ?? null;
    },
    async put(source) {
      sources.set(source.id, source);
    },
  };
}
