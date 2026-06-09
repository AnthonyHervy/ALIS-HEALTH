const ANDROID_HEADER_MIN_TOP_PADDING = 46;
const ANDROID_STATUS_BAR_GAP = 22;
const NON_ANDROID_TOP_PADDING = 14;

export function headerTopPadding(platform: string, statusBarHeight?: number | null) {
  if (platform !== 'android') {
    return NON_ANDROID_TOP_PADDING;
  }

  return Math.max(ANDROID_HEADER_MIN_TOP_PADDING, (statusBarHeight ?? 24) + ANDROID_STATUS_BAR_GAP);
}
