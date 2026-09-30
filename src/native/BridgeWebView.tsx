import { forwardRef, useCallback, useEffect, useMemo, useRef, type ForwardedRef } from 'react'
import { Linking, Platform } from 'react-native'
import Constants from 'expo-constants'
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview'
import type { AppInfo } from '../shared/protocol'
import { resolveAppInfo } from './app-info'
import type { BridgeEmitter } from './emitter'
import { composeNavigationHandler } from './navigation'
import { routeMessage, type Handlers } from './router'
import { buildDispatchScript, composeInjectedScript } from './scripts'

type ShouldStartLoadRequest = Parameters<NonNullable<WebViewProps['onShouldStartLoadWithRequest']>>[0]

export interface BridgeWebViewProps
  extends Omit<
    WebViewProps,
    | 'onShouldStartLoadWithRequest'
    | 'injectedJavaScriptForMainFrameOnly'
    | 'injectedJavaScriptBeforeContentLoadedForMainFrameOnly'
  > {
  /** Hostnames allowed to call handlers and to load inside the WebView. `*.x.com` matches subdomains. */
  trustedHosts: readonly string[]
  /** Hostnames that load inside the WebView WITHOUT bridge access (file previews, OAuth, 3-D Secure). */
  inAppHosts?: readonly string[]
  /** Methods the page can call with `bridge.call(method, params)`. */
  handlers?: Handlers
  /** From `useBridgeEmitter()`, to send events to the page. */
  emitter?: BridgeEmitter
  /** Overrides for the badge values read from expo-constants. */
  appInfo?: Partial<AppInfo>
  /** Runs before the default policy. Return true/false to decide, or undefined to fall back to it. */
  onShouldStartLoadWithRequest?: (request: ShouldStartLoadRequest) => boolean | undefined
}

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

export const BridgeWebView = forwardRef<WebView, BridgeWebViewProps>(function BridgeWebView(props, ref) {
  const {
    trustedHosts,
    inAppHosts,
    handlers,
    emitter,
    appInfo,
    onMessage,
    onShouldStartLoadWithRequest,
    injectedJavaScriptBeforeContentLoaded,
    onLoadStart,
    onLoadEnd,
    ...webViewProps
  } = props

  const webViewRef = useRef<WebView | null>(null)
  const handlersRef = useRef<Handlers>(handlers ?? {})
  const trustedHostsRef = useRef(trustedHosts)
  const inAppHostsRef = useRef<readonly string[]>(inAppHosts ?? [])
  handlersRef.current = handlers ?? {}
  trustedHostsRef.current = trustedHosts
  inAppHostsRef.current = inAppHosts ?? []

  const setRef = useCallback(
    (instance: WebView | null) => {
      webViewRef.current = instance
      assignRef(ref, instance)
    },
    [ref],
  )

  const send = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(script)
  }, [])

  useEffect(() => emitter?.connect(send), [emitter, send])

  const appInfoKey = JSON.stringify(appInfo ?? {})
  const injectedScript = useMemo(
    () =>
      composeInjectedScript(
        resolveAppInfo(Platform.OS, Constants.expoConfig, appInfo),
        injectedJavaScriptBeforeContentLoaded,
      ),
    // appInfoKey stands in for appInfo so a new object literal each render does not rebuild the script.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appInfoKey, injectedJavaScriptBeforeContentLoaded],
  )

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const { data, url } = event.nativeEvent
      const route = routeMessage(data, url, handlersRef.current, trustedHostsRef.current)
      if (route.type === 'forward') {
        onMessage?.(event)
        return
      }
      if (route.type === 'drop') {
        if (__DEV__) console.warn(`[mobile-app-bridge] dropped message (${route.reason}) from ${url}`)
        return
      }
      void route.response.then((response) => send(buildDispatchScript(response)))
    },
    [onMessage, send],
  )

  const handleShouldStart = useMemo(
    () =>
      composeNavigationHandler<ShouldStartLoadRequest>(
        onShouldStartLoadWithRequest,
        () => ({ trustedHosts: trustedHostsRef.current, inAppHosts: inAppHostsRef.current }),
        (url) => {
          Linking.openURL(url).catch(() => {})
        },
      ),
    [onShouldStartLoadWithRequest],
  )

  return (
    <WebView
      {...webViewProps}
      ref={setRef}
      onMessage={handleMessage}
      onShouldStartLoadWithRequest={handleShouldStart}
      injectedJavaScriptBeforeContentLoaded={injectedScript}
      injectedJavaScriptForMainFrameOnly
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly
      onLoadStart={(event) => {
        emitter?.setReady(false)
        onLoadStart?.(event)
      }}
      onLoadEnd={(event) => {
        emitter?.setReady(true)
        onLoadEnd?.(event)
      }}
    />
  )
})
