/**
 * Seed SOMENTE o superadmin (Auth Supabase + resolutoo.platform_admins).
 * Não cria planos.
 *
 * Ideal: SUPABASE_SERVICE_ROLE_KEY (confirma e-mail + cria/atualiza senha).
 * Fallback: anon signUp / password login.
 *
 *   $env:SUPERADMIN_SEED_PASSWORD="..."
 *   $env:SUPABASE_SERVICE_ROLE_KEY="..."   # recomendado
 *   node backend/scripts/seed_superadmin.mjs
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = val
  }
}

loadEnvFile(resolve(root, 'backend/.env'))
loadEnvFile(resolve(root, 'frontend/.env'))
loadEnvFile(resolve(root, 'frontend/.env.local'))

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const email = (process.env.SUPERADMIN_SEED_EMAIL || 'tipatetamuurcho@gmail.com').trim().toLowerCase()
const password = process.env.SUPERADMIN_SEED_PASSWORD || ''
const databaseUrl = process.env.DATABASE_URL || ''

if (!url || !password || !databaseUrl) {
  console.error('Need SUPABASE_URL (or VITE_*), SUPERADMIN_SEED_PASSWORD, DATABASE_URL')
  process.exit(1)
}
if (!serviceKey && !anonKey) {
  console.error('Need SUPABASE_SERVICE_ROLE_KEY (preferível) ou VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function findUserIdAdmin() {
  if (!serviceKey) return null
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    })
    if (!res.ok) throw new Error(`list users: ${res.status} ${await res.text()}`)
    const data = await res.json()
    const users = data.users || []
    const hit = users.find((u) => (u.email || '').toLowerCase() === email)
    if (hit) return hit.id
    if (users.length < 200) break
  }
  return null
}

async function upsertWithServiceRole() {
  let id = await findUserIdAdmin()
  if (id) {
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: 'PUT',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password, email_confirm: true, user_metadata: { role: 'superadmin' } }),
    })
    if (!res.ok) throw new Error(`update user: ${res.status} ${await res.text()}`)
    return id
  }
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'superadmin' },
    }),
  })
  if (!res.ok) throw new Error(`create user: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.id
}

async function loginForUserId() {
  if (!anonKey) return null
  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
  if (!login.ok) {
    const t = await login.text()
    console.warn('login failed:', t.slice(0, 200))
    return null
  }
  const tok = await login.json()
  return tok.user?.id || null
}

async function createWithAnonSignUp() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${url}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, data: { role: 'superadmin' } }),
    })
    const text = await res.text()
    let data = {}
    try {
      data = JSON.parse(text)
    } catch {
      /* ignore */
    }
    if (res.status === 429) {
      console.warn('rate limit signup — waiting 45s…')
      await sleep(45000)
      continue
    }
    if (!res.ok) {
      if (/already|registered|exists/i.test(text)) {
        return loginForUserId()
      }
      throw new Error(`signup: ${res.status} ${text}`)
    }
    return data.user?.id || data.id || null
  }
  throw new Error('signup rate-limited after retries')
}

let userId
if (serviceKey) {
  console.log('Using SUPABASE_SERVICE_ROLE_KEY…')
  userId = await upsertWithServiceRole()
} else {
  console.warn(
    'WARN: sem SERVICE_ROLE_KEY — signUp pode deixar e-mail NÃO confirmado e o login falha.\n' +
      'Cole SUPABASE_SERVICE_ROLE_KEY no ambiente pra seed confiável.',
  )
  userId = await loginForUserId()
  if (!userId) userId = await createWithAnonSignUp()
  if (!userId) userId = await loginForUserId()
}

if (!userId) {
  console.error('Could not resolve Auth user id')
  process.exit(1)
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
await client.query(`SET search_path TO resolutoo, public`)

const tableExists = await client.query(
  `SELECT 1 FROM information_schema.tables
   WHERE table_schema = 'resolutoo' AND table_name = 'platform_admins'`,
)
if (tableExists.rowCount === 0) {
  await client.query(`
    CREATE TABLE resolutoo.platform_admins (
      user_id    text PRIMARY KEY,
      email      text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    )`)
}

await client.query(
  `INSERT INTO resolutoo.platform_admins (user_id, email) VALUES ($1, $2)
   ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email`,
  [userId, email],
)

const check = await client.query(
  `SELECT user_id, email FROM resolutoo.platform_admins WHERE user_id = $1`,
  [userId],
)
await client.end()

console.log('OK superadmin seeded (Auth + resolutoo.platform_admins)')
console.log(`email=${email}`)
console.log(`user_id=${userId}`)
console.log(`row=${JSON.stringify(check.rows[0])}`)
console.log('Login: https://resolutoo.com/login → /dashboard')
console.log('Troque a senha depois (foi usada no chat).')
