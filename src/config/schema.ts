import { z } from 'zod'

export const profileSchema = z.object({
  authToken: z.string().min(1),
  ct0: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
})

export const birdTuiConfigSchema = z.object({
  defaultProfile: z.string().min(1),
  profiles: z.record(z.string(), profileSchema),
  ui: z.object({
    defaultFeed: z.enum(['following', 'forYou']).optional(),
    imageRenderer: z.enum(['auto', 'chafa', 'kitty', 'none']).optional()
  }).optional()
})

export type BirdTuiConfig = z.infer<typeof birdTuiConfigSchema>
export type BirdTuiProfile = z.infer<typeof profileSchema>

export const emptyConfig = (): BirdTuiConfig => ({ defaultProfile: 'default', profiles: {} })
