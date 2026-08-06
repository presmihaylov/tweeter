import type { HeaderBuilder } from './headers.ts'
import type { FeatureMap } from './features.ts'
import { transactionPathOf } from './transactionId.ts'
import { errorMessage } from '../utils/result.ts'
import type { Fetcher } from '../utils/fetcher.ts'

export type GraphQLPayload = Record<string, unknown>

// The browser signs every API call with x-client-transaction-id, and the value covers the
// path and the method, so it has to be built here rather than in the header builder.
export type TransactionIdProvider = (path: string, method: string) => Promise<string | undefined>

export class GraphQLClient {
  constructor(
    private readonly graphQLBase: string,
    private readonly headers: HeaderBuilder,
    private readonly fetchImpl: Fetcher,
    private readonly transactionId?: TransactionIdProvider
  ) {}

  private async sign(headers: Record<string, string>, url: string, method: string): Promise<Record<string, string>> {
    const value = await this.transactionId?.(transactionPathOf(url), method)
    if (value === undefined) {
      return headers
    }
    return { ...headers, 'x-client-transaction-id': value }
  }

  async get(operationName: string, queryId: string, variables: GraphQLPayload, features: FeatureMap, fieldToggles?: FeatureMap): Promise<{ body: unknown; status: number }> {
    const params = new URLSearchParams()
    params.set('variables', JSON.stringify(variables))
    params.set('features', JSON.stringify(features))
    if (fieldToggles) {
      params.set('fieldToggles', JSON.stringify(fieldToggles))
    }
    const url = `${this.graphQLBase}/${queryId}/${operationName}?${params.toString()}`
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: await this.sign(this.headers.jsonHeaders(), url, 'GET')
    })
    return { body: await parseJson(response), status: response.status }
  }

  async post(operationName: string, queryId: string, variables: GraphQLPayload, features: FeatureMap, fieldToggles?: FeatureMap, headers?: Record<string, string>): Promise<{ body: unknown; status: number }> {
    const payload: Record<string, unknown> = { variables, features, queryId }
    if (fieldToggles) {
      payload.fieldToggles = fieldToggles
    }
    const url = `${this.graphQLBase}/${queryId}/${operationName}`
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: await this.sign(headers ?? this.headers.jsonHeaders(), url, 'POST'),
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
