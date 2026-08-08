// A pasted picture stands in the draft as [Image 1], so the reader can see it, move it and
// take it away with the same keys as any other text. The token never reaches X: it is cut out
// of the text, and the picture goes up beside the tweet instead.
const tokenPattern = /\[Image (\d+)\]/g

export const imageToken = (index: number): string => `[Image ${index}]`

// The number the next picture takes. It counts from the tokens the draft still holds, so a
// picture the reader deleted frees nothing and no two pictures ever share a token.
export const nextImageNumber = (draft: string): number => {
  let highest = 0
  for (const match of draft.matchAll(tokenPattern)) {
    highest = Math.max(highest, Number(match[1] ?? 0))
  }
  return highest + 1
}

// What X is asked to post: the draft without the tokens. Taking a token out leaves the spaces
// that stood on either side of it, so the runs collapse. A line break is not a run to collapse,
// because the reader put it there.
export const draftText = (draft: string): string =>
  draft.replace(tokenPattern, '').replace(/[^\S\n]{2,}/g, ' ').split('\n').map((line) => line.trim()).join('\n').trim()
