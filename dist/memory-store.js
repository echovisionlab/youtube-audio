export function createMemoryYoutubeAudioSourceStore() {
    const sources = new Map();
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
//# sourceMappingURL=memory-store.js.map