import { spawn } from 'node:child_process'

export type ChafaOptions = { cols: number; rows: number; executable?: string }

export const buildChafaArgs = (path: string, opts: ChafaOptions): string[] => [
  '--format=symbols',
  `--size=${opts.cols}x${opts.rows}`,
  path
]

export const renderChafa = async (path: string, opts: ChafaOptions): Promise<string> => {
  const executable = opts.executable ?? 'chafa'
  const child = spawn(executable, buildChafaArgs(path, opts), { stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  if (code !== 0) {
    throw new Error(Buffer.concat(stderr).toString('utf8') || `chafa exited ${code}`)
  }
  return Buffer.concat(stdout).toString('utf8')
}
