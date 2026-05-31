import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const readJsonFile = async (path: string): Promise<unknown> => {
  const content = await readFile(path, 'utf8')
  return JSON.parse(content) as unknown
}

export const writeJsonFile = async (path: string, data: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}
