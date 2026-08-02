/** E-mails que SEMPRE são donos da plataforma — fallback se a API
 * `/api/superadmin/whoami` estiver fora do ar / 404 (deploy atrasado).
 * A fonte de verdade em steady-state continua sendo `platform_admins`. */
export const KNOWN_PLATFORM_ADMIN_EMAILS = ['tipatetamuurcho@gmail.com'] as const

export function isKnownPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  return (KNOWN_PLATFORM_ADMIN_EMAILS as readonly string[]).includes(normalized)
}
