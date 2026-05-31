export type ImageRenderer = 'auto' | 'chafa' | 'kitty' | 'none'

export const detectImageRenderer = (requested: ImageRenderer = 'auto'): ImageRenderer => {
  if (requested !== 'auto') {
    return requested
  }
  const term = `${process.env.TERM ?? ''} ${process.env.TERM_PROGRAM ?? ''}`.toLowerCase()
  if (term.includes('ghostty') || term.includes('kitty')) {
    return 'kitty'
  }
  return 'chafa'
}
