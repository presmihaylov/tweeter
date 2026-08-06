import { getInt, getMap, getSlice, getStr } from '../../utils/guards.ts'
import type { AppMedia, ArticleBlock, ArticleBody } from '../types.ts'

export const firstText = (...values: string[]): string => {
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed !== '') {
      return trimmed
    }
  }
  return ''
}

const articleResult = (result: unknown): Record<string, unknown> | undefined => {
  const article = getMap(result, 'article')
  if (!article) {
    return undefined
  }
  return getMap(getMap(article, 'article_results'), 'result') ?? article
}

// An article image is not a tweet photo: it arrives as a bare original with its own size
// and no thumbnail, so the pane has to draw the full file.
const imageOf = (entry: unknown): AppMedia | undefined => {
  const info = getMap(entry, 'media_info')
  const url = getStr(info, 'original_img_url')
  if (url === '') {
    return undefined
  }
  return {
    type: 'photo',
    url,
    width: getInt(info, 'original_img_width') || undefined,
    height: getInt(info, 'original_img_height') || undefined
  }
}

// X sends the body as Draft.js: a list of blocks, where an image is an "atomic" block whose
// entity range names an entry of the entity map, which in turn names a media id. Only that
// chain says where in the text an image belongs.
const bodyBlocks = (article: Record<string, unknown>): ArticleBlock[] => {
  const images = new Map<string, AppMedia>()
  for (const entry of getSlice(article, 'media_entities') ?? []) {
    const image = imageOf(entry)
    if (image) {
      images.set(getStr(entry, 'media_id'), image)
    }
  }
  const entities = new Map<string, Record<string, unknown>>()
  const contentState = getMap(article, 'content_state')
  for (const entry of getSlice(contentState, 'entityMap') ?? []) {
    const value = getMap(entry, 'value')
    if (value) {
      entities.set(getStr(entry, 'key'), value)
    }
  }
  const blocks: ArticleBlock[] = []
  // x.com opens an article with its cover, above the first paragraph.
  const cover = imageOf(getMap(article, 'cover_media'))
  if (cover) {
    blocks.push({ kind: 'image', media: cover })
  }
  for (const raw of getSlice(contentState, 'blocks') ?? []) {
    const type = getStr(raw, 'type')
    if (type === 'atomic') {
      const image = atomicImage(raw, entities, images)
      if (image) {
        blocks.push(image)
      }
      continue
    }
    const text = getStr(raw, 'text').trim()
    if (text === '') {
      continue
    }
    blocks.push({ kind: 'text', text, style: textStyle(type) })
  }
  return blocks
}

const textStyle = (type: string): 'header' | 'bullet' | undefined => {
  if (type.startsWith('header-')) {
    return 'header'
  }
  return type.endsWith('list-item') ? 'bullet' : undefined
}

const atomicImage = (
  raw: unknown,
  entities: Map<string, Record<string, unknown>>,
  images: Map<string, AppMedia>
): ArticleBlock | undefined => {
  for (const range of getSlice(raw, 'entityRanges') ?? []) {
    const entity = entities.get(String(getInt(range, 'key')))
    const data = getMap(entity, 'data')
    for (const item of getSlice(data, 'mediaItems') ?? []) {
      const media = images.get(getStr(item, 'mediaId'))
      if (media) {
        return { kind: 'image', media, caption: getStr(data, 'caption').trim() || undefined }
      }
    }
  }
  return undefined
}

// x.com draws an article as a headline card, not as a post, so the reader has to be told
// which one the pane holds. The title alone marks it; the body is already in the text.
export const extractArticle = (result: unknown): ArticleBody | undefined => {
  const article = articleResult(result)
  if (!article) {
    return undefined
  }
  const title = firstText(getStr(article, 'title'), getStr(getMap(result, 'article'), 'title'))
  const blocks = bodyBlocks(article)
  return blocks.length > 0 ? { title, blocks } : { title }
}

const blockText = (blocks: ArticleBlock[]): string =>
  blocks
    .filter((block): block is Extract<ArticleBlock, { kind: 'text' }> => block.kind === 'text')
    .map((block) => (block.style === 'bullet' ? `• ${block.text}` : block.text))
    .join('\n')

export const extractArticleText = (result: unknown): string => {
  const article = articleResult(result)
  if (!article) {
    return ''
  }
  const title = extractArticle(result)?.title ?? ''
  // The blocks are the live copy of the body. plain_text is a snapshot that a later edit
  // leaves behind, so it only answers when the blocks are missing.
  const body = firstText(
    blockText(extractArticle(result)?.blocks ?? []),
    getStr(article, 'plain_text'),
    getStr(getMap(article, 'body'), 'text'),
    getStr(article, 'text')
  )
  if (title !== '' && body !== '' && body !== title && !body.startsWith(title)) {
    return `${title}\n\n${body}`
  }
  return body || title
}
