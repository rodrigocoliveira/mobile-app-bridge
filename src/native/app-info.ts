import type { AppInfo, Platform } from '../shared/protocol'

export interface ExpoConfigLike {
  version?: string
  ios?: { buildNumber?: string }
  android?: { versionCode?: number }
}

export function resolveAppInfo(
  platformOS: string,
  expoConfig: ExpoConfigLike | null | undefined,
  override: Partial<AppInfo> = {},
): AppInfo {
  const platform: Platform = platformOS === 'android' ? 'android' : 'ios'
  const buildNumber =
    platform === 'ios' ? expoConfig?.ios?.buildNumber : expoConfig?.android?.versionCode?.toString()

  return {
    platform,
    appVersion: expoConfig?.version ?? '0.0.0',
    buildNumber: buildNumber ?? '0',
    ...override,
  }
}
