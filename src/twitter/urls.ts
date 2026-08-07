// x.com ignores the handle segment and redirects to the canonical one, so a stale
// or missing handle still resolves.
export const statusUrl = (handle: string, tweetId: string): string =>
  `https://x.com/${handle || 'i'}/status/${tweetId}`
