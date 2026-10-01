# YouTube audio

Server-side YouTube audio source resolution and authenticated byte-range
proxying for applications that perform browser-local audio processing.

```sh
pnpm add @echovisionlab/youtube-audio
```

The browser receives a same-origin opaque source URL, not the upstream media
URL. Integrators must authenticate every resolve and range request, derive the
subject from the server-side session, and store short-lived source records in a
shared subject-bound store.

```ts
import { createYoutubeAudioService } from "@echovisionlab/youtube-audio";
import { createYoutubeJsAudioProvider } from "@echovisionlab/youtube-audio/youtube-js";

const service = createYoutubeAudioService({
  provider: createYoutubeJsAudioProvider(),
  sourceStore,
  makeSourceUrl: (id) => `/api/youtube-audio/${id}`,
});
```

See [DISCLOSURE.md](DISCLOSURE.md) for access and use conditions.

`createYoutubeJsAudioProvider()` is exported separately so browser bundles do
not accidentally pull the unofficial InnerTube client into application code.
It rejects live/upcoming video and any source without a finite audio-only byte
length. The adapter tries the `VISIONOS` and `YTKIDS` YouTube.js clients in
order, accepting a source only after exact one-byte reads succeed at the
beginning, middle, and end of the file. This keeps source preparation bounded
for long public videos while rejecting URLs that resolve but later fail random
access. Callers may override `client` when required. YouTube.js and the upstream
private API can change independently; keep
resolution failures observable and update this package rather than adding
fallback scraping to the web application.

Each caller's wait for YouTube.js client creation, video metadata, and URL
deciphering ends promptly when its `AbortSignal` is aborted; shared client
creation continues for other callers. The pinned YouTube.js APIs do not accept
an abort signal for `Innertube.create()`, `getBasicInfo()`, or `decipher()`, so
aborting a caller does not stop the underlying library work.

The exported `createMemoryYoutubeAudioSourceStore()` is process-local. It prunes
expired records during put, get, and delete operations; inject `now` when a
deterministic clock is needed. It does not evict unexpired records, so use a
shared store with an explicit capacity policy for long-lived multi-process
services.

## Development

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm package:verify
pnpm package:pack
YOUTUBE_VIDEO_ID=<authorized-video-id> pnpm smoke:youtube-range
```

## Release

The initial package version requires an interactive npm publish with 2FA. Later
versions publish directly from GitHub Actions using npm trusted publishing,
with OIDC authentication and no manual approval step.

## License

PolyForm Noncommercial 1.0.0. Commercial use requires a separate license from
Echo Vision Lab. See [LICENSE.md](LICENSE.md).
