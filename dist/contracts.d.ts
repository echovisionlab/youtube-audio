export interface YoutubeVideoReference {
    readonly canonicalUrl: string;
    readonly videoId: string;
}
export interface YoutubeAudioUpstreamSource {
    readonly contentType: string;
    readonly expiresAt: number | null;
    readonly fileName: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly size: number;
    readonly title: string;
    readonly url: string;
    readonly videoId: string;
}
export interface YoutubeAudioProvider {
    resolve(video: YoutubeVideoReference, signal?: AbortSignal): Promise<YoutubeAudioUpstreamSource>;
}
export interface YoutubeAudioSourceRecord {
    readonly expiresAt: number;
    readonly id: string;
    readonly subject: string;
    readonly upstream: YoutubeAudioUpstreamSource;
}
export interface YoutubeAudioSourceStore {
    delete(id: string): Promise<void>;
    get(id: string): Promise<YoutubeAudioSourceRecord | null>;
    put(source: YoutubeAudioSourceRecord): Promise<void>;
}
export interface YoutubeAudioTranscoderInput {
    readonly http: {
        readonly credentials: 'include';
        readonly size: number;
        readonly url: string;
    };
    readonly name: string;
}
export interface ResolvedYoutubeAudio {
    readonly contentType: string;
    readonly expiresAt: number;
    readonly input: YoutubeAudioTranscoderInput;
    readonly sourceId: string;
    readonly title: string;
    readonly videoId: string;
}
export interface ResolveYoutubeAudioRequest {
    readonly signal?: AbortSignal;
    readonly subject: string;
    readonly url: string;
}
export interface ReadYoutubeAudioRequest {
    readonly range: string;
    readonly signal?: AbortSignal;
    readonly sourceId: string;
    readonly subject: string;
}
export interface RevokeYoutubeAudioRequest {
    readonly sourceId: string;
    readonly subject: string;
}
export interface CreateYoutubeAudioServiceOptions {
    readonly createSourceId?: () => string;
    readonly fetch?: typeof fetch;
    readonly makeSourceUrl: (sourceId: string) => string;
    readonly now?: () => number;
    readonly provider: YoutubeAudioProvider;
    readonly sourceStore: YoutubeAudioSourceStore;
    readonly sourceTtlMs?: number;
}
export interface YoutubeAudioService {
    read(request: ReadYoutubeAudioRequest): Promise<Response>;
    resolve(request: ResolveYoutubeAudioRequest): Promise<ResolvedYoutubeAudio>;
    revoke(request: RevokeYoutubeAudioRequest): Promise<void>;
}
//# sourceMappingURL=contracts.d.ts.map