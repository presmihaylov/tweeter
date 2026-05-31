export const onboardingText = (): string => `birdtui first launch

No birdtui profile found and no birdgo config was importable.

To configure X cookies:
1. Open https://x.com in your browser and make sure you are logged in.
2. Open DevTools.
3. Go to Application / Storage -> Cookies -> https://x.com.
4. Copy cookie auth_token.
5. Copy cookie ct0.
6. Create ~/.config/birdtui/config.json with:

{
  "defaultProfile": "default",
  "profiles": {
    "default": {
      "authToken": "PASTE_AUTH_TOKEN",
      "ct0": "PASTE_CT0"
    }
  },
  "ui": { "defaultFeed": "following", "imageRenderer": "auto" }
}

Press q to quit after creating config, then rerun bird.
`
