export function createMemoryYoutubeAudioSourceStore(options = {}) {
    const sources = new Map();
    const now = options.now ?? Date.now;
    let earliestExpiry = Number.POSITIVE_INFINITY;
    return {
        async delete(id) {
            pruneExpired();
            sources.delete(id);
        },
        async get(id) {
            // Preserve the store contract: callers can still distinguish an expired
            // record from a missing one, while pruning it from the backing map.
            const source = sources.get(id) ?? null;
            pruneExpired();
            return source;
        },
        async put(source) {
            const currentTime = now();
            pruneExpired(currentTime);
            const expiresAt = source.expiresAt;
            if (expiresAt <= currentTime) {
                sources.delete(source.id);
                return;
            }
            sources.set(source.id, source);
            earliestExpiry = Math.min(earliestExpiry, expiresAt);
        },
    };
    function pruneExpired(currentTime = now()) {
        if (currentTime < earliestExpiry) {
            return;
        }
        let nextExpiry = Number.POSITIVE_INFINITY;
        for (const [id, source] of sources) {
            const expiresAt = source.expiresAt;
            if (expiresAt <= currentTime) {
                sources.delete(id);
            }
            else {
                nextExpiry = Math.min(nextExpiry, expiresAt);
            }
        }
        earliestExpiry = nextExpiry;
    }
}
//# sourceMappingURL=memory-store.js.map