// Regex-based on purpose: React Native's URL polyfill has historically not implemented `hostname`.
// Backslashes are excluded from userinfo/host because browsers treat `\` as `/` in http(s) URLs.
const URL_PATTERN = /^([a-z][a-z0-9+.-]*):(?:\/\/(?:[^@/\\?#]*@)?(\[[^\]]*\]|[^:/\\?#]*))?/i

export function schemeOf(url: string): string | null {
  const match = URL_PATTERN.exec(url.trim())
  return match ? match[1]!.toLowerCase() : null
}

export function hostnameOf(url: string): string | null {
  const host = URL_PATTERN.exec(url.trim())?.[2]
  if (!host) return null
  return host.toLowerCase().replace(/\.$/, '')
}

export function isTrustedHostname(hostname: string, trustedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return trustedHosts.some((entry) => {
    const pattern = entry.toLowerCase()
    if (pattern.startsWith('*.')) return host.endsWith(`.${pattern.slice(2)}`)
    return host === pattern
  })
}

export function isTrustedUrl(url: string, trustedHosts: readonly string[]): boolean {
  const hostname = hostnameOf(url)
  return hostname !== null && isTrustedHostname(hostname, trustedHosts)
}
