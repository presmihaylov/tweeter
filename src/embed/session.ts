// One way in for another app: the saved profile, and a client built from it. The CLI and
// the TUI each did these four lines themselves; an embedder should not have to know that
// the cookies live in a config file at all.
import { ConfigStore, getProfile } from '../config/store.ts'
import { TwitterClient } from '../twitter/client.ts'

export type TweeterSession = {
  /** The profile the client posts and reads as. */
  name: string
  client: TwitterClient
}

export class NoProfileError extends Error {
  constructor() {
    super('no tweeter profile configured; run `tweeter` once to set up cookies first')
    this.name = 'NoProfileError'
  }
}

/**
 * Open a session on Pres's own cookies. It never asks for a token: the config file is the
 * only source, so an embedder cannot post as anyone the TUI could not post as.
 */
export const openSession = async (profile?: string): Promise<TweeterSession> => {
  const config = await new ConfigStore().load()
  const selected = getProfile(config, profile)
  if (!selected) {
    throw new NoProfileError()
  }
  return {
    name: selected.name,
    client: new TwitterClient({
      authToken: selected.profile.authToken,
      ct0: selected.profile.ct0,
      cookieHeader: selected.profile.cookieHeader
    })
  }
}
