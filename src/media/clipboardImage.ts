import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'

// What X takes on a tweet, by the extension the file carries. A clipboard picture always
// arrives as PNG, so this map is only for a file the reader copied.
export const imageMimes: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

export type ClipboardImage = { data: Uint8Array; mime: string; name: string }

export const imageMimeFor = (path: string): string | undefined => imageMimes[extname(path).toLowerCase()]

// The macOS clipboard, read through its own AppKit. A screenshot is already PNG and is written
// as it stands; a picture copied out of another app is often TIFF, which X does not take, so it
// is re-encoded. A file copied in Finder is on the clipboard as a URL rather than as pixels, so
// its path comes back instead and the bytes are read from the file: a JPEG stays a JPEG.
const macReader = `ObjC.import('AppKit')
function run(argv) {
  var board = $.NSPasteboard.generalPasteboard
  var file = board.stringForType($.NSPasteboardTypeFileURL)
  if (!file.isNil()) { return 'file\\t' + $.NSURL.URLWithString(file).path.js }
  var png = board.dataForType($.NSPasteboardTypePNG)
  var data = png.isNil() ? board.dataForType($.NSPasteboardTypeTIFF) : png
  if (data.isNil()) { return 'none' }
  var out = png.isNil() ? $.NSBitmapImageRep.imageRepWithData(data).representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary) : data
  if (out.isNil()) { return 'none' }
  return out.writeToFileAtomically(argv[0], true) ? 'png' : 'none'
}`

// A reader either writes the picture to the file it is given and says what it wrote, or prints
// the bytes. Nothing on the clipboard and no such command both mean the same thing here: the
// next reader gets its turn, and an empty answer ends the search.
export type ClipboardReader = { command: string; args: (out: string) => string[]; writesFile: boolean }

export const clipboardReaders = (platform: string): ClipboardReader[] => {
  if (platform === 'darwin') {
    return [{ command: 'osascript', args: (out) => ['-l', 'JavaScript', '-e', macReader, out], writesFile: true }]
  }
  if (platform === 'linux') {
    return [
      { command: 'wl-paste', args: () => ['--type', 'image/png'], writesFile: false },
      { command: 'xclip', args: () => ['-selection', 'clipboard', '-t', 'image/png', '-o'], writesFile: false }
    ]
  }
  return []
}

// A missing command is not a failure of its own: the next reader may be installed. Both come
// back as undefined, so the caller walks the list either way.
const run = async (command: string, args: string[]): Promise<{ code: number; stdout: Buffer } | undefined> => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
  const chunks: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk) })
  return new Promise((resolve) => {
    child.on('error', () => { resolve(undefined) })
    child.on('close', (code) => { resolve({ code: code ?? 1, stdout: Buffer.concat(chunks) }) })
  })
}

export const imageFromFile = async (path: string): Promise<ClipboardImage | undefined> => {
  const mime = imageMimeFor(path)
  if (mime === undefined) {
    return undefined
  }
  try {
    return { data: new Uint8Array(await readFile(path)), mime, name: basename(path) }
  } catch {
    return undefined
  }
}

const readOne = async (reader: ClipboardReader, out: string): Promise<ClipboardImage | undefined> => {
  const result = await run(reader.command, reader.args(out))
  if (!result || result.code !== 0) {
    return undefined
  }
  if (!reader.writesFile) {
    return result.stdout.length > 0 ? { data: new Uint8Array(result.stdout), mime: 'image/png', name: 'clipboard' } : undefined
  }
  const said = result.stdout.toString('utf8').trim()
  if (said === 'png') {
    return { data: new Uint8Array(await readFile(out)), mime: 'image/png', name: 'clipboard' }
  }
  return said.startsWith('file\t') ? imageFromFile(said.slice('file\t'.length)) : undefined
}

// The picture the clipboard holds, if it holds one. The file is a scratch copy on the way to
// X, so it goes as soon as the bytes are read.
export const readClipboardImage = async (platform = process.platform): Promise<ClipboardImage | undefined> => {
  const out = join(tmpdir(), `tweeter-paste-${randomUUID()}.png`)
  try {
    for (const reader of clipboardReaders(platform)) {
      const found = await readOne(reader, out)
      if (found) {
        return found
      }
    }
    return undefined
  } finally {
    await rm(out, { force: true }).catch(() => undefined)
  }
}
