export type ImageRenderer = 'auto' | 'chafa' | 'kitty' | 'none'

const isImageRenderer = (value: string): value is ImageRenderer => {
  return value === 'auto' || value === 'chafa' || value === 'kitty' || value === 'none'
}

// An explicit flag, then the environment. Both outrank whatever the terminal says.
const requestedRenderer = (requested: ImageRenderer): ImageRenderer | undefined => {
  if (requested !== 'auto') {
    return requested
  }
  const configured = process.env.TWEETER_IMAGE_RENDERER ?? ''
  return isImageRenderer(configured) && configured !== 'auto' ? configured : undefined
}

export const detectImageRenderer = (requested: ImageRenderer = 'auto'): ImageRenderer => {
  const chosen = requestedRenderer(requested)
  if (chosen) {
    return chosen
  }
  const term = `${process.env.TERM ?? ''} ${process.env.TERM_PROGRAM ?? ''}`.toLowerCase()
  if (term.includes('ghostty') || term.includes('kitty')) {
    return 'kitty'
  }
  return 'chafa'
}

// a=q asks the terminal to accept a 1x1 pixel and report back, so a terminal that draws
// images answers `_Gi=<id>;OK`. The DA1 that follows is answered by every terminal, which
// ends the wait early instead of spending the whole timeout on one that draws nothing.
export const kittyQuery = (id = 31): string => `\x1b_Gi=${id},s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[c`

export const kittyQueryAnswered = (reply: string, id = 31): boolean => reply.includes(`_Gi=${id};OK`)

const daAnswered = (reply: string): boolean => {
  const start = reply.indexOf('\x1b[?')
  return start >= 0 && reply.indexOf('c', start) > start
}

export type KittyProbeOptions = {
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
  timeoutMs?: number
}

// The TERM of a terminal reached through a multiplexer names the multiplexer, not the
// terminal, so `xterm-256color` says nothing about images. Ask the terminal itself.
export const probeKittyGraphics = async (opts: KittyProbeOptions = {}): Promise<boolean> => {
  const input = opts.input ?? process.stdin
  const output = opts.output ?? process.stdout
  if (!input.isTTY || !output.isTTY) {
    return false
  }
  const wasRaw = input.isRaw
  const wasPaused = input.isPaused()
  let reply = ''
  return await new Promise<boolean>((resolve) => {
    const finish = (answered: boolean): void => {
      clearTimeout(timer)
      input.off('data', onData)
      input.setRawMode(wasRaw)
      if (wasPaused) {
        input.pause()
      }
      resolve(answered)
    }
    const onData = (chunk: Buffer): void => {
      reply += chunk.toString('latin1')
      if (kittyQueryAnswered(reply)) {
        finish(true)
        return
      }
      if (daAnswered(reply)) {
        finish(false)
      }
    }
    const timer = setTimeout(() => { finish(kittyQueryAnswered(reply)) }, opts.timeoutMs ?? 500)
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
    output.write(kittyQuery())
  })
}

export const resolveImageRenderer = async (
  requested: ImageRenderer = 'auto',
  probe: (opts?: KittyProbeOptions) => Promise<boolean> = probeKittyGraphics
): Promise<ImageRenderer> => {
  const chosen = requestedRenderer(requested)
  if (chosen) {
    return chosen
  }
  if (await probe()) {
    return 'kitty'
  }
  return detectImageRenderer(requested)
}
