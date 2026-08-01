export function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed')
}

export function assertEqual(actual, expected, label = 'value') {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

export function assertStatus(res, expected, label) {
  const ok = Array.isArray(expected) ? expected.includes(res.status) : res.status === expected
  if (!ok) {
    throw new Error(
      `${label || 'response'}: expected status ${expected}, got ${res.status} body=${JSON.stringify(res.data).slice(0, 180)}`,
    )
  }
}

export function assertShape(obj, keys, label = 'object') {
  assert(obj && typeof obj === 'object', `${label} is not an object`)
  for (const k of keys) {
    assert(k in obj, `${label} missing key "${k}"`)
  }
}
