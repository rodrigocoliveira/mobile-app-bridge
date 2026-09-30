import { isTrustedUrl, schemeOf } from './hosts'

export type NavigationDecision = 'load' | 'block' | 'open-external'

export interface NavigationRequestLike {
  url: string
  /** iOS only. Android only asks about top-frame navigations, so `undefined` means top frame. */
  isTopFrame?: boolean
}

export interface HostLists {
  /** Load in the WebView and may call handlers. */
  trustedHosts: readonly string[]
  /** Load in the WebView without bridge access (file previews, OAuth, 3-D Secure). */
  inAppHosts: readonly string[]
}

const BLOCKED_SCHEMES = new Set(['about', 'blob', 'file', 'javascript', 'data'])

export function decideNavigation(request: NavigationRequestLike, hosts: HostLists): NavigationDecision {
  const scheme = schemeOf(request.url)
  const isHttp = scheme === 'http' || scheme === 'https'
  const isSubframe = request.isTopFrame === false

  if (isHttp && (isTrustedUrl(request.url, hosts.trustedHosts) || isTrustedUrl(request.url, hosts.inAppHosts))) {
    return 'load'
  }
  // Iframes (reCAPTCHA, maps, GTM, payment widgets) must load in place; they never get the badge.
  if (isSubframe && (isHttp || scheme === 'about')) return 'load'
  if (scheme === null || BLOCKED_SCHEMES.has(scheme)) return 'block'
  return 'open-external'
}

export function composeNavigationHandler<R extends NavigationRequestLike>(
  consumer: ((request: R) => boolean | undefined) | undefined,
  getHosts: () => HostLists,
  openExternal: (url: string) => void,
): (request: R) => boolean {
  return (request) => {
    const custom = consumer?.(request)
    if (typeof custom === 'boolean') return custom

    const decision = decideNavigation(request, getHosts())
    if (decision === 'open-external') openExternal(request.url)
    return decision === 'load'
  }
}
