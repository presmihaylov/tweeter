import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestRenderer } from '@opentui/core/testing'
import { attachmentLines, composerHeading, createMainScreen, helpGroups } from '../src/app/mainScreen.ts'
import { imageLimitFor, imageRefusal, sendDraft, type DraftSender } from '../src/app/terminalApp.ts'
import { isImagePasteKey } from '../src/app/keyEvents.ts'
import { draftText, imageToken, nextImageNumber } from '../src/state/attachments.ts'
import { attachImage, closeComposer, deleteFromDraft, draftImages, initialAppState, insertIntoDraft, moveComposerCaret, openComposer, type AppState } from '../src/state/store.ts'
import { clipboardReaders, imageFromFile, imageMimeFor } from '../src/media/clipboardImage.ts'
import { TwitterClient } from '../src/twitter/client.ts'
import { imageAttachCap, imageBytesLimit, gifBytesLimit } from '../src/twitter/constants.ts'
import { jsonResponse } from './helpers.ts'
import type { Fetcher } from '../src/utils/fetcher.ts'
import type { PostResult } from '../src/twitter/types.ts'

const uploadUrl = 'https://upload.test/i/media/upload.json'
const graphQLBase = 'https://x.com/i/api/graphql'

// A 1x1 red PNG, written here rather than taken from anywhere.
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

const bytes = (length: number): Uint8Array => new Uint8Array(length)

const writing = (text = ''): AppState => {
  const open = openComposer(initialAppState(), 'post')
  return text === '' ? open : insertIntoDraft(open, text)
}

const paste = (state: AppState, data = png): AppState => attachImage(state, { name: 'clipboard', mime: 'image/png', data })

const tempQueryIdPath = async (): Promise<string> =>
  join(await mkdtemp(join(tmpdir(), 'tweeter-qid-')), 'queryIds.json')

const clientWith = async (fetchMock: Fetcher): Promise<TwitterClient> =>
  new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase, uploadUrl, queryIdPath: await tempQueryIdPath(), sleep: async () => undefined })

const createdBody = (tweetId: string): unknown => ({
  data: {
    create_tweet: {
      tweet_results: {
        result: {
          rest_id: tweetId,
          core: { user_results: { result: { rest_id: 'u1', legacy: { screen_name: 'me', name: 'Me' } } } },
          legacy: { full_text: 'hi', conversation_id_str: tweetId }
        }
      }
    }
  }
})

describe('the token that stands for a picture', () => {
  test('counts up from the tokens the draft already holds', () => {
    expect(nextImageNumber('')).toBe(1)
    expect(nextImageNumber('[Image 1] hi')).toBe(2)
    expect(nextImageNumber('[Image 1] and [Image 2]')).toBe(3)
  })

  test('never repeats a number a deleted picture used', () => {
    expect(nextImageNumber('[Image 2] alone')).toBe(3)
    expect(imageToken(3)).toBe('[Image 3]')
  })

  test('comes out of the words X is sent', () => {
    expect(draftText('look [Image 1] at this')).toBe('look at this')
    expect(draftText('[Image 1]')).toBe('')
    expect(draftText('[Image 1] [Image 2] two of them')).toBe('two of them')
  })

  test('leaves the line breaks the reader typed', () => {
    expect(draftText('one [Image 1]\ntwo')).toBe('one\ntwo')
  })
})

describe('what a paste does to the draft', () => {
  test('writes the token at the caret and keeps the bytes beside it', () => {
    const state = paste(writing('look'))
    expect(state.composer.draft).toBe('look [Image 1] ')
    expect(state.composer.caret).toBe(state.composer.draft.length)
    expect(draftImages(state)).toHaveLength(1)
    expect(draftImages(state)[0]?.data).toEqual(png)
  })

  test('a second picture takes the next token', () => {
    const state = paste(paste(writing()))
    expect(state.composer.draft).toBe('[Image 1] [Image 2] ')
    expect(draftImages(state).map((image) => image.token)).toEqual(['[Image 1]', '[Image 2]'])
  })

  test('the pictures come in the order their tokens stand in the draft', () => {
    const two = paste(paste(writing()))
    const moved = insertIntoDraft(moveComposerCaret(two, 'start'), '[Image 2] ')
    // The draft now names the second picture first, so it goes on the tweet first.
    expect(draftImages(moved).map((image) => image.token)).toEqual(['[Image 2]', '[Image 1]'])
  })

  test('deleting the token drops the picture', () => {
    let state = paste(writing())
    expect(draftImages(state)).toHaveLength(1)
    for (let press = 0; press < '[Image 1] '.length; press += 1) {
      state = deleteFromDraft(state, -1)
    }
    expect(state.composer.draft).toBe('')
    expect(draftImages(state)).toHaveLength(0)
  })

  test('closing the drawer takes the pictures with it', () => {
    expect(closeComposer(paste(writing())).composer.images).toBeUndefined()
  })

  test('the token is not part of the 280 characters', () => {
    expect(composerHeading(paste(writing('hi')))).toContain('2/280')
  })
})

describe('what the drawer refuses', () => {
  test('a search prompt takes no picture', () => {
    expect(imageRefusal({ mode: 'search', attached: 0, bytes: 10, mime: 'image/png' })).toBe('a search takes no image')
  })

  test('a fifth picture', () => {
    expect(imageRefusal({ mode: 'post', attached: imageAttachCap - 1, bytes: 10, mime: 'image/png' })).toBeUndefined()
    expect(imageRefusal({ mode: 'post', attached: imageAttachCap, bytes: 10, mime: 'image/png' })).toContain('4 images')
  })

  test('a picture over the weight X takes', () => {
    expect(imageRefusal({ mode: 'reply', attached: 0, bytes: imageBytesLimit + 1, mime: 'image/png' })).toContain('the limit is')
    expect(imageRefusal({ mode: 'reply', attached: 0, bytes: imageBytesLimit + 1, mime: 'image/gif' })).toBeUndefined()
    expect(imageLimitFor('image/gif')).toBe(gifBytesLimit)
    expect(imageLimitFor('image/png')).toBe(imageBytesLimit)
  })
})

describe('the picture on the way to X', () => {
  test('goes up in three steps and gives back the id X made', async () => {
    const steps: string[] = []
    const client = await clientWith(async (input) => {
      const url = new URL(input.toString())
      const command = url.searchParams.get('command') ?? ''
      steps.push(command)
      if (command === 'INIT') {
        return jsonResponse({ media_id_string: '77', expires_after_secs: 86400 })
      }
      if (command === 'APPEND') {
        return new Response('', { status: 204 })
      }
      return jsonResponse({ media_id_string: '77' }, { status: 201 })
    })
    const result = await client.uploadImage({ data: png, mime: 'image/png' })
    expect(result).toEqual({ ok: true, mediaId: '77' })
    expect(steps).toEqual(['INIT', 'APPEND', 'FINALIZE'])
  })

  test('tells INIT what it is sending', async () => {
    let init: URLSearchParams | undefined
    const client = await clientWith(async (input) => {
      const url = new URL(input.toString())
      if (url.searchParams.get('command') === 'INIT') {
        init = url.searchParams
        return jsonResponse({ media_id_string: '77' })
      }
      return new Response('', { status: 204 })
    })
    await client.uploadImage({ data: png, mime: 'image/png' })
    expect(init?.get('total_bytes')).toBe(String(png.length))
    expect(init?.get('media_type')).toBe('image/png')
    expect(init?.get('media_category')).toBe('tweet_image')
  })

  test('an animation is a different category to X', async () => {
    let category = ''
    const client = await clientWith(async (input) => {
      const url = new URL(input.toString())
      if (url.searchParams.get('command') === 'INIT') {
        category = url.searchParams.get('media_category') ?? ''
        return jsonResponse({ media_id_string: '78' })
      }
      return new Response('', { status: 204 })
    })
    await client.uploadImage({ data: png, mime: 'image/gif' })
    expect(category).toBe('tweet_gif')
  })

  test('waits while X is still processing, and takes the id once it is done', async () => {
    const answers = ['pending', 'in_progress', 'succeeded']
    let polls = 0
    const client = await clientWith(async (input) => {
      const command = new URL(input.toString()).searchParams.get('command') ?? ''
      if (command === 'INIT') {
        return jsonResponse({ media_id_string: '79' })
      }
      if (command === 'APPEND') {
        return new Response('', { status: 204 })
      }
      if (command === 'FINALIZE') {
        return jsonResponse({ media_id_string: '79', processing_info: { state: answers[0], check_after_secs: 1 } })
      }
      polls += 1
      return jsonResponse({ media_id_string: '79', processing_info: { state: answers[polls], check_after_secs: 1 } })
    })
    expect(await client.uploadImage({ data: png, mime: 'image/gif' })).toEqual({ ok: true, mediaId: '79' })
    expect(polls).toBe(2)
  })

  test('says why when X refuses the bytes', async () => {
    const client = await clientWith(async () => jsonResponse({ errors: [{ code: 324, message: 'media type unsupported' }] }, { status: 400 }))
    const result = await client.uploadImage({ data: png, mime: 'image/png' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('media type unsupported')
      expect(result.status).toBe(400)
    }
  })

  test('a picture X could not process is not sent as a tweet', async () => {
    const client = await clientWith(async (input) => {
      const command = new URL(input.toString()).searchParams.get('command') ?? ''
      if (command === 'INIT') {
        return jsonResponse({ media_id_string: '80' })
      }
      if (command === 'FINALIZE') {
        return jsonResponse({ processing_info: { state: 'failed', error: { message: 'the file is broken' } } })
      }
      return new Response('', { status: 204 })
    })
    const result = await client.uploadImage({ data: png, mime: 'image/gif' })
    expect(result).toEqual({ ok: false, error: 'the file is broken' })
  })
})

describe('the tweet that carries the pictures', () => {
  const captureVariables = async (send: (client: TwitterClient) => Promise<PostResult>): Promise<Record<string, unknown>> => {
    let variables: Record<string, unknown> = {}
    const client = await clientWith(async (input, init) => {
      if (input.toString().includes('/CreateTweet')) {
        variables = (JSON.parse(String(init?.body)) as { variables: Record<string, unknown> }).variables
        return jsonResponse(createdBody('999'))
      }
      return jsonResponse({})
    })
    await send(client)
    return variables
  }

  test('names every id X gave back, in order', async () => {
    const variables = await captureVariables((client) => client.postTweet({ text: 'two pictures', mediaIds: ['11', '22'] }))
    expect(variables.media).toEqual({
      media_entities: [{ media_id: '11', tagged_users: [] }, { media_id: '22', tagged_users: [] }],
      possibly_sensitive: false
    })
  })

  test('a tweet with no picture names none', async () => {
    const variables = await captureVariables((client) => client.postTweet({ text: 'words alone' }))
    expect(variables.media).toEqual({ media_entities: [], possibly_sensitive: false })
  })

  test('a reply and a quote carry them too', async () => {
    const reply = await captureVariables((client) => client.replyToTweet({ tweetId: '42', text: 'hi', mediaIds: ['11'] }))
    expect(reply.media).toEqual({ media_entities: [{ media_id: '11', tagged_users: [] }], possibly_sensitive: false })
    const quote = await captureVariables((client) => client.quoteTweet({ tweetId: '42', handle: 'alice', text: 'hi', mediaIds: ['11'] }))
    expect(quote.media).toEqual({ media_entities: [{ media_id: '11', tagged_users: [] }], possibly_sensitive: false })
  })

  test('the drawer hands the ids to whichever call the mode picks', async () => {
    const seen: string[][] = []
    const ok: PostResult = { ok: true, tweetId: '1' }
    const client: DraftSender = {
      replyToTweet: async (args) => { seen.push(args.mediaIds ?? []); return ok },
      quoteTweet: async (args) => { seen.push(args.mediaIds ?? []); return ok },
      postTweet: async (args) => { seen.push(args.mediaIds ?? []); return ok },
      uploadImage: async () => ({ ok: true, mediaId: 'm1' })
    }
    const target = { id: '42', text: 'hello', author: { handle: 'alice', name: 'Alice' }, media: [], metrics: {} }
    await sendDraft({ client, mode: 'post', text: 'hi', mediaIds: ['11'], onRetry: () => undefined })
    await sendDraft({ client, mode: 'reply', target, text: 'hi', mediaIds: ['22'], onRetry: () => undefined })
    await sendDraft({ client, mode: 'quote', target, text: 'hi', mediaIds: ['33'], onRetry: () => undefined })
    expect(seen).toEqual([['11'], ['22'], ['33']])
  })
})

describe('the pictures on the screen', () => {
  test('one row for each, with the token that names it', () => {
    const state = paste(paste(writing('hi')))
    const lines = attachmentLines(draftImages(state), 80)
    expect(lines[0]).toContain('2 images')
    expect(lines[1]).toContain('[Image 1]')
    expect(lines[2]).toContain('[Image 2]')
  })

  test('a draft with no picture takes no rows', () => {
    expect(attachmentLines([], 80)).toEqual([])
  })

  test('a long row is cut to the drawer', () => {
    const state = attachImage(writing(), { name: 'a-very-long-file-name-from-somewhere-else.png', mime: 'image/png', data: bytes(4096) })
    for (const line of attachmentLines(draftImages(state), 30)) {
      expect(line.length).toBeLessThanOrEqual(30)
    }
  })

  test('the weight is on the row, so the reader knows what is going up', () => {
    const state = attachImage(writing(), { name: 'clipboard', mime: 'image/png', data: bytes(2048) })
    expect(attachmentLines(draftImages(state), 80)[1]).toContain('2 KB')
  })

  test('the drawer shows the token and the row under it', async () => {
    const harness = await createTestRenderer({ width: 120, height: 40 })
    const screen = createMainScreen(harness.renderer)
    const state = paste(writing('look at this'))
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    const frame = harness.captureCharFrame()
    expect(frame).toContain('[Image 1]')
    expect(frame).toContain('1 image')
  })

  test('the key list says which key pastes one', () => {
    const keys = helpGroups.flatMap((group) => group.entries.map((entry) => entry.keys))
    expect(keys).toContain('Ctrl+V')
  })
})

describe('the clipboard the paste key reads', () => {
  test('Ctrl+V is the press, and a plain V is not', () => {
    expect(isImagePasteKey({ name: 'v', ctrl: true, sequence: '' })).toBe(true)
    expect(isImagePasteKey({ name: '', ctrl: true, sequence: '' })).toBe(true)
    expect(isImagePasteKey({ name: 'v', ctrl: false, sequence: 'v' })).toBe(false)
    expect(isImagePasteKey({ name: 'c', ctrl: true, sequence: '' })).toBe(false)
  })

  test('each platform has its own way to read the clipboard', () => {
    expect(clipboardReaders('darwin')[0]?.command).toBe('osascript')
    expect(clipboardReaders('linux').map((reader) => reader.command)).toEqual(['wl-paste', 'xclip'])
    expect(clipboardReaders('win32')).toEqual([])
  })

  test('a copied file keeps what it is', async () => {
    expect(imageMimeFor('/tmp/a.PNG')).toBe('image/png')
    expect(imageMimeFor('/tmp/a.jpeg')).toBe('image/jpeg')
    expect(imageMimeFor('/tmp/a.txt')).toBeUndefined()
    const path = join(await mkdtemp(join(tmpdir(), 'tweeter-image-')), 'shot.png')
    await writeFile(path, png)
    const found = await imageFromFile(path)
    expect(found?.mime).toBe('image/png')
    expect(found?.name).toBe('shot.png')
    expect(found?.data).toEqual(png)
  })

  test('a file that is not a picture is not read', async () => {
    expect(await imageFromFile('/tmp/notes.txt')).toBeUndefined()
    expect(await imageFromFile('/tmp/there-is-no-such-file.png')).toBeUndefined()
  })
})
