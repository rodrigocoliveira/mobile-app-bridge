import { BADGE_KEY, BRIDGE_EVENT, type AppInfo, type EventMessage, type ResponseMessage } from '../shared/protocol'

/** JSON that is also safe to embed inside injected JavaScript. */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Sets the badge. BridgeWebView runs it before content loads AND again after load, because on Android
 * react-native-webview injects the "before content loaded" script in a race with document creation.
 */
export function buildBadgeScript(info: AppInfo): string {
  return `(function () { window.${BADGE_KEY} = ${serializeForScript(info)}; })();`
}

/**
 * Delivers a response or event to the page, but only if the page's host is trusted: pages that
 * load in the app without bridge access (inAppHosts, consumer-allowed third parties) get nothing.
 * Host matching mirrors isTrustedHostname() in hosts.ts.
 */
export function buildDispatchScript(message: ResponseMessage | EventMessage, trustedHosts: readonly string[]): string {
  return [
    '(function () {',
    "  var host = String(location.hostname || '').toLowerCase().replace(/\\.$/, '');",
    `  var trusted = ${serializeForScript(trustedHosts.map((entry) => entry.toLowerCase()))};`,
    '  var allowed = trusted.some(function (entry) {',
    "    if (entry.indexOf('*.') === 0) return host.slice(-(entry.length - 1)) === entry.slice(1);",
    '    return host === entry;',
    '  });',
    '  if (!allowed) return;',
    `  window.dispatchEvent(new CustomEvent(${JSON.stringify(BRIDGE_EVENT)}, { detail: ${serializeForScript(message)} }));`,
    '})();',
    'true;',
  ].join('\n')
}

/** Badge first, then the consumer's own script. Separators keep trailing comments harmless. */
export function composeInjectedScript(info: AppInfo, consumerScript?: string): string {
  return [buildBadgeScript(info), consumerScript ?? '', 'true;'].join('\n;\n')
}
