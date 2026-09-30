import { BADGE_KEY, BRIDGE_EVENT, BUFFER_KEY, type AppInfo, type EventMessage, type ResponseMessage } from '../shared/protocol'

export const BUFFER_LIMIT = 50

/** JSON that is also safe to embed inside injected JavaScript. */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function buildBadgeScript(info: AppInfo): string {
  return [
    '(function () {',
    `  window.${BADGE_KEY} = ${serializeForScript(info)};`,
    `  window.${BUFFER_KEY} = [];`,
    `  window.addEventListener(${JSON.stringify(BRIDGE_EVENT)}, function (event) {`,
    `    var buffer = window.${BUFFER_KEY};`,
    '    var detail = event && event.detail;',
    "    if (!buffer || !detail || detail.kind !== 'evt') return;",
    '    buffer.push(detail);',
    `    if (buffer.length > ${BUFFER_LIMIT}) buffer.shift();`,
    '  });',
    '})();',
  ].join('\n')
}

export function buildDispatchScript(message: ResponseMessage | EventMessage): string {
  return (
    `(function () { window.dispatchEvent(new CustomEvent(${JSON.stringify(BRIDGE_EVENT)}, ` +
    `{ detail: ${serializeForScript(message)} })); })();\ntrue;`
  )
}

/** Badge first, then the consumer's own script. Separators keep trailing comments harmless. */
export function composeInjectedScript(info: AppInfo, consumerScript?: string): string {
  return [buildBadgeScript(info), consumerScript ?? '', 'true;'].join('\n;\n')
}
