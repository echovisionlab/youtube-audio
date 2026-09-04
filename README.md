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

## Responsible use

This package is dual-use software, not a public download service. Access must
be restricted to signed-in users. Use it only for media you own or are
authorized to acquire and process, and obtain all required copyright and rights
clearances. Echo Vision Lab does not encourage infringement or unauthorized
copying. See [DISCLOSURE.md](DISCLOSURE.md).

YouTube and its private APIs can change independently. Keep failures observable
and review YouTube's terms and applicable law for your integration.

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
