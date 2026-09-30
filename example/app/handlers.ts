import { Alert, Linking } from 'react-native'
import { Camera } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import type { Handlers } from '@rodrigocoliveira/mobile-app-bridge/native'

const IMPACT = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
} as const

export const handlers: Handlers = {
  'test.echo': async (params: { from?: string } | undefined) => {
    if (params?.from === 'iframe') Alert.alert('SECURITY', 'An untrusted iframe reached a handler')
    return params
  },

  'test.sleep': ({ ms }: { ms: number }) => new Promise((resolve) => setTimeout(() => resolve({ slept: ms }), ms)),

  'test.throw': async () => {
    throw Object.assign(new Error('Thrown on purpose'), { code: 'CUSTOM' })
  },

  'camera.requestPermission': async () => {
    const current = await Camera.getCameraPermissionsAsync()
    if (current.granted) return { granted: true }
    if (!current.canAskAgain) {
      await Linking.openSettings()
      return { granted: false, openedSettings: true }
    }
    const { granted } = await Camera.requestCameraPermissionsAsync()
    return { granted }
  },

  'haptics.impact': async ({ style = 'light' }: { style?: keyof typeof IMPACT } = {}) => {
    await Haptics.impactAsync(IMPACT[style])
    return { style }
  },

  'app.unsupported': async ({ feature }: { feature: string }) => {
    Alert.alert('Not available in the app', `${feature} is only available on the website, on a computer.`)
  },
}
