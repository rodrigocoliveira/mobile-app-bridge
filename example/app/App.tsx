import { useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet, Text, View } from 'react-native'
import type { WebView } from 'react-native-webview'
import { BridgeWebView, useBridgeEmitter } from '@rodrigocoliveira/mobile-app-bridge/native'
import { handlers } from './handlers'

const WEB_URL = 'http://localhost:5055/'

export default function App() {
  const emitter = useBridgeEmitter()
  const webViewRef = useRef<WebView>(null)
  const [legacyMessage, setLegacyMessage] = useState<string | null>(null)

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => emitter.emit('app.stateChange', { state }))
    return () => subscription.remove()
  }, [emitter])

  return (
    <View style={styles.container}>
      {legacyMessage && <Text style={styles.banner}>Legacy onMessage: {legacyMessage}</Text>}
      <BridgeWebView
        ref={webViewRef}
        emitter={emitter}
        source={{ uri: WEB_URL }}
        trustedHosts={['localhost']}
        inAppHosts={['127.0.0.1']}
        handlers={handlers}
        onMessage={(event) => setLegacyMessage(event.nativeEvent.data)}
        style={styles.webview}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 54, backgroundColor: '#fff' },
  banner: { padding: 8, backgroundColor: '#ffd', fontSize: 12 },
  webview: { flex: 1 },
})
