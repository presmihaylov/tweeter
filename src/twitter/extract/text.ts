import { getMap, getStr } from '../../utils/guards.ts'
import { extractArticleText, firstText } from './article.ts'

export const extractNoteTweetText = (result: unknown): string => {
  const note = getMap(getMap(getMap(result, 'note_tweet'), 'note_tweet_results'), 'result')
  if (!note) {
    return ''
  }
  return firstText(
    getStr(note, 'text'),
    getStr(getMap(note, 'richtext'), 'text'),
    getStr(getMap(note, 'rich_text'), 'text'),
    getStr(getMap(note, 'content'), 'text'),
    getStr(getMap(getMap(note, 'content'), 'richtext'), 'text'),
    getStr(getMap(getMap(note, 'content'), 'rich_text'), 'text')
  )
}

export const extractTweetText = (result: unknown): string => {
  const article = extractArticleText(result)
  if (article) {
    return article
  }
  const note = extractNoteTweetText(result)
  if (note) {
    return note
  }
  return getStr(getMap(result, 'legacy'), 'full_text')
}
