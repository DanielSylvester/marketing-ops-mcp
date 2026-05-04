import { META_BASE_URL, type MetaAccountConfig } from '../config.js'

interface MetaError {
  error: { message: string; type: string; code: number; fbtrace_id?: string }
}

export class MetaClient {
  constructor(private readonly account: MetaAccountConfig) {}

  get accountId(): string { return this.account.accountId }
  get currency(): string { return this.account.currency }
  get currencySymbol(): string { return this.account.currencySymbol }

  private url(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`
    return `${META_BASE_URL}${p}`
  }

  async get<T = any>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(this.url(path))
    url.searchParams.set('access_token', this.account.accessToken)
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue
      url.searchParams.set(k, String(v))
    }
    const res = await fetch(url.toString())
    const text = await res.text()
    let data: any
    try { data = JSON.parse(text) } catch { throw new Error(`Meta API: non-JSON response (${res.status}): ${text.slice(0, 200)}`) }
    if ((data as MetaError).error) {
      const e = (data as MetaError).error
      throw new Error(`Meta API ${res.status}: ${e.message} (code=${e.code}${e.fbtrace_id ? ` trace=${e.fbtrace_id}` : ''})`)
    }
    return data as T
  }

  async post<T = any>(path: string, body: Record<string, any>): Promise<T> {
    const url = this.url(path)
    const params = new URLSearchParams()
    params.set('access_token', this.account.accessToken)
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue
      params.set(k, typeof v === 'string' ? v : JSON.stringify(v))
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const text = await res.text()
    let data: any
    try { data = JSON.parse(text) } catch { throw new Error(`Meta API: non-JSON response (${res.status}): ${text.slice(0, 200)}`) }
    if ((data as MetaError).error) {
      const e = (data as MetaError).error
      throw new Error(`Meta API ${res.status}: ${e.message} (code=${e.code})`)
    }
    return data as T
  }

  // Pull all pages from a paginated endpoint up to maxPages.
  async getPaginated<T = any>(path: string, params: Record<string, string | number | undefined> = {}, maxPages = 5): Promise<T[]> {
    const out: T[] = []
    let nextUrl: string | null = null
    let page = 0
    while (page < maxPages) {
      const data: any = nextUrl
        ? await fetch(nextUrl).then(r => r.json())
        : await this.get<any>(path, { ...params, limit: 100 })
      if (data.error) throw new Error(`Meta API: ${data.error.message}`)
      out.push(...(data.data ?? []))
      nextUrl = data.paging?.next ?? null
      if (!nextUrl) break
      page++
    }
    return out
  }
}
