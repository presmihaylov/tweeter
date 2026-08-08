import type { MentionUser } from '../types.ts'
import { getBool, getFlag, getMap, getSlice, getStr } from '../../utils/guards.ts'

// The typeahead read is the old REST API, so it answers with a flat list of users rather than
// with a timeline. X puts the two relationship flags in a block of their own here, and sends a
// 0 in its place for an account it has nothing to say about.
export const parseTypeaheadUsers = (body: unknown): MentionUser[] => {
  const users: MentionUser[] = []
  for (const raw of getSlice(body, 'users') ?? []) {
    const handle = getStr(raw, 'screen_name')
    if (handle === '') {
      continue
    }
    const social = getMap(raw, 'social_context')
    const following = getFlag(social, 'following')
    const followedBy = getFlag(social, 'followed_by')
    users.push({
      id: getStr(raw, 'id_str'),
      handle,
      name: getStr(raw, 'name') || handle,
      ...(getBool(raw, 'ext_is_blue_verified') || getBool(raw, 'verified') ? { verified: true } : {}),
      ...(following === undefined ? {} : { following }),
      ...(followedBy === undefined ? {} : { followedBy })
    })
  }
  return users
}
