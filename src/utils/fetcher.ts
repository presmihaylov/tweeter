export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export const defaultFetcher: Fetcher = (input, init) => fetch(input, init)
