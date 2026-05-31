import type { AppMedia } from '../types.ts'
import { getFloat, getInt, getMap, getSlice, getStr } from '../../utils/guards.ts'

export const extractMedia = (result: unknown): AppMedia[] => {
  const legacy = getMap(result, 'legacy')
  const rawMedia = getSlice(getMap(legacy, 'extended_entities'), 'media') ?? getSlice(getMap(legacy, 'entities'), 'media') ?? []
  const media: AppMedia[] = []
  for (const item of rawMedia) {
    const mediaType = getStr(item, 'type')
    const mediaUrl = getStr(item, 'media_url_https')
    if (!isKnownMediaType(mediaType) || mediaUrl === '') {
      continue
    }
    const sizes = getMap(item, 'sizes')
    const large = getMap(sizes, 'large') ?? getMap(sizes, 'medium')
    const width = large ? getInt(large, 'w') : undefined
    const height = large ? getInt(large, 'h') : undefined
    const previewUrl = getMap(sizes, 'small') ? `${mediaUrl}:small` : undefined
    const altText = getStr(item, 'ext_alt_text') || undefined

    if (mediaType === 'photo') {
      media.push(stripUndefined({ type: 'photo', url: mediaUrl, previewUrl, width, height, altText }))
      continue
    }

    const videoInfo = getMap(item, 'video_info')
    const variants = getSlice(videoInfo, 'variants') ?? []
    let firstMp4 = ''
    let bestUrl = ''
    let bestBitrate = -1
    for (const variant of variants) {
      if (getStr(variant, 'content_type') !== 'video/mp4') {
        continue
      }
      const url = getStr(variant, 'url')
      if (url === '') {
        continue
      }
      if (firstMp4 === '') {
        firstMp4 = url
      }
      const bitrate = getFloat(variant, 'bitrate')
      if (bitrate > bestBitrate) {
        bestBitrate = bitrate
        bestUrl = url
      }
    }
    const duration = getFloat(videoInfo, 'duration_millis')
    media.push(stripUndefined({
      type: mediaType,
      url: mediaUrl,
      previewUrl,
      width,
      height,
      videoUrl: bestUrl || firstMp4 || undefined,
      durationMs: duration > 0 ? Math.trunc(duration) : undefined,
      altText
    }))
  }
  return media
}

const isKnownMediaType = (value: string): value is AppMedia['type'] => {
  return value === 'photo' || value === 'video' || value === 'animated_gif'
}

const stripUndefined = <T extends Record<string, unknown>>(value: T): T => {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as T
}
