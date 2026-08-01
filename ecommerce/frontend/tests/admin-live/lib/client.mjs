/** Minimal HTTP client for live admin API calls. */

export class HttpError extends Error {
  constructor(status, body, path) {
    super(`HTTP ${status} ${path}: ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`)
    this.status = status
    this.body = body
    this.path = path
  }
}

export function createClient(baseUrl, token = null) {
  async function request(method, path, { body, expectStatus } = {}) {
    const headers = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const text = await res.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }

    const allowed = expectStatus
      ? Array.isArray(expectStatus)
        ? expectStatus
        : [expectStatus]
      : null

    if (allowed) {
      if (!allowed.includes(res.status)) {
        throw new HttpError(res.status, data, path)
      }
    } else if (!res.ok) {
      throw new HttpError(res.status, data, path)
    }

    return { status: res.status, data }
  }

  return {
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
    delete: (path, opts) => request('DELETE', path, opts),
    withToken(nextToken) {
      return createClient(baseUrl, nextToken)
    },
  }
}
