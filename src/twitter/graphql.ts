import type { HeaderBuilder } from './headers.ts'
import type { FeatureMap } from './features.ts'
import { errorMessage } from '../utils/result.ts'
import type { Fetcher } from '../utils/fetcher.ts'

export type GraphQLPayload = Record<string, unknown>

export class GraphQLClient {
  constructor(
    private readonly graphQLBase: string,
    private readonly headers: HeaderBuilder,
    private readonly fetchImpl: Fetcher
  ) {}

  async get(operationName: string, queryId: string, variables: GraphQLPayload, features: FeatureMap, fieldToggles?: FeatureMap): Promise<{ body: unknown; status: number }> {
    const params = new URLSearchParams()
    params.set('variables', JSON.stringify(variables))
    params.set('features', JSON.stringify(features))
    if (fieldToggles) {
      params.set('fieldToggles', JSON.stringify(fieldToggles))
    }
    const response = await this.fetchImpl(`${this.graphQLBase}/${queryId}/${operationName}?${params.toString()}`, {
      method: 'GET',
      headers: this.headers.jsonHeaders()
    })
    return { body: await parseJson(response), status: response.status }
  }

  async post(operationName: string, queryId: string, variables: GraphQLPayload, features: FeatureMap, fieldToggles?: FeatureMap, headers?: HeadersInit): Promise<{ body: unknown; status: number }> {
    const payload: Record<string, unknown> = { variables, features, queryId }
    if (fieldToggles) {
      payload.fieldToggles = fieldToggles
    }
    const response = await this.fetchImpl(`${this.graphQLBase}/${queryId}/${operationName}`, {
      method: 'POST',
      headers: headers ?? this.headers.jsonHeaders(),
      body: JSON.stringify(payload)
    })
    return { body: await parseJson(response), status: response.status }
  }

  async getThenPost(operationName: string, queryId: string, variables: GraphQLPayload, features: FeatureMap, fieldToggles?: FeatureMap): Promise<{ body: unknown; status: number }> {
    const first = await this.get(operationName, queryId, variables, features, fieldToggles)
    if (first.status !== 404) {
      return first
    }
    return this.post(operationName, queryId, variables, features)
  }
}

export const parseJson = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  if (text.trim() === '') {
    return {}
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`JSON parse error: ${errorMessage(error)} (body: ${text.slice(0, 200)})`)
  }
}
