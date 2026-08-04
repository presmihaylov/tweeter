export type ImageRenderer = 'auto' | 'chafa' | 'kitty' | 'none'

const isImageRenderer = (value: string): value is ImageRenderer => {
  return value === 'auto' || value === 'chafa' || value === 'kitty' || value === 'none'
}

export const detectImageRenderer = (requested: ImageRenderer = 'auto'): ImageRenderer => {
  if (requested !== 'auto') {
    return requested
  }
  const configured = process.env.TWEETER_IMAGE_RENDERER ?? ''
  if (isImageRenderer(configured) && configured !== 'auto') {
    return configured
  }
  const term = `${process.env.TERM ?? ''} ${process.env.TERM_PROGRAM ?? ''}`.toLowerCase()
  if (term.includes('ghostty') || term.includes('kitty')) {
    return 'kitty'
  }
  return 'chafa'
}
