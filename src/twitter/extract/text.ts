import { getMap, getStr } from '../../utils/guards.ts'

const firstText = (...values: string[]): string => {
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed !== '') {
      return trimmed
    }
  }
  return ''
}

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

export const extractArticleText = (result: unknown): string => {
  const article = getMap(result, 'article')
  if (!article) {
    return ''
  }
  const articleResult = getMap(getMap(article, 'article_results'), 'result') ?? article
  const title = firstText(getStr(articleResult, 'title'), getStr(article, 'title'))
  const body = firstText(
    getStr(articleResult, 'plain_text'),
    getStr(article, 'plain_text'),
    getStr(getMap(articleResult, 'body'), 'text'),
    getStr(articleResult, 'text'),
    getStr(article, 'text')
  )
  if (title !== '' && body !== '' && body !== title && !body.startsWith(title)) {
    return `${title}\n\n${body}`
  }
  return body || title
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
