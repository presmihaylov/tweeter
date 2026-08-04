import { z } from 'zod'

export const xApiTokensSchema = z.object({
  clientId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
  scope: z.string().optional(),
  userId: z.string().optional(),
  username: z.string().optional()
})

export const profileSchema = z.object({
  authToken: z.string().min(1),
  ct0: z.string().min(1),
  cookieHeader: z.string().optional(),
  xApi: xApiTokensSchema.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
})

export const tweeterConfigSchema = z.object({
  defaultProfile: z.string().min(1),
  profiles: z.record(z.string(), profileSchema),
  ui: z.object({
    defaultFeed: z.enum(['following', 'forYou']).optional(),
    imageRenderer: z.enum(['auto', 'chafa', 'kitty', 'none']).optional()
  }).optional()
})

export type TweeterConfig = z.infer<typeof tweeterConfigSchema>
export type TweeterProfile = z.infer<typeof profileSchema>
export type XApiTokens = z.infer<typeof xApiTokensSchema>

export const emptyConfig = (): TweeterConfig => ({ defaultProfile: 'default', profiles: {} })
