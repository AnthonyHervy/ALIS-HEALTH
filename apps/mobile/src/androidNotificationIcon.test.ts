import fs from 'fs';
import path from 'path';

const androidRoot = path.join(process.cwd(), 'android', 'app', 'src', 'main');
const notificationIconPath = path.join(androidRoot, 'res', 'drawable', 'ic_stat_alis.xml');
const manifestPath = path.join(androidRoot, 'AndroidManifest.xml');
const colorsPath = path.join(androidRoot, 'res', 'values', 'colors.xml');
const workerPath = path.join(
  androidRoot,
  'java',
  'local',
  'alis',
  'app',
  'HealthConnectSyncWorker.kt'
);

test('uses a dedicated monochrome ALIS small icon for Android notifications', () => {
  expect(fs.existsSync(notificationIconPath)).toBe(true);

  const iconXml = fs.readFileSync(notificationIconPath, 'utf8');
  expect(iconXml).toContain('<vector');
  expect(iconXml).toContain('android:strokeColor="#FFFFFFFF"');
  expect(iconXml).toContain('android:fillColor="@android:color/transparent"');
  expect(iconXml).not.toContain('@mipmap/ic_launcher');

  const manifest = fs.readFileSync(manifestPath, 'utf8');
  expect(manifest).toContain('android:name="expo.modules.notifications.default_notification_icon"');
  expect(manifest).toContain('android:resource="@drawable/ic_stat_alis"');
  expect(manifest).toContain('android:name="expo.modules.notifications.default_notification_color"');
  expect(manifest).toContain('android:resource="@color/alis_notification_color"');

  const colors = fs.readFileSync(colorsPath, 'utf8');
  expect(colors).toContain('<color name="alis_notification_color">#0F766E</color>');

  const worker = fs.readFileSync(workerPath, 'utf8');
  expect(worker).toContain('.setSmallIcon(R.drawable.ic_stat_alis)');
  expect(worker).not.toContain('.setSmallIcon(android.R.drawable.ic_dialog_info)');
});
