const fs = require('fs');
const path = require('path');
const { withDangerousMod, withMainActivity } = require('@expo/config-plugins');

const RATIONALE_ACTIVITY = `package local.healthconnect.app

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class PermissionsRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val padding = (24 * resources.displayMetrics.density).toInt()
    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(padding, padding, padding, padding)
    }

    val title = TextView(this).apply {
      text = "Permissions Health Connect"
      textSize = 20f
      gravity = Gravity.CENTER
    }

    val body = TextView(this).apply {
      text = "HealthConnect lit les donnees autorisees localement, puis les synchronise vers ton serveur personnel."
      textSize = 14f
      gravity = Gravity.CENTER
    }

    val closeButton = Button(this).apply {
      text = "Fermer"
      setOnClickListener { finish() }
    }

    layout.addView(title)
    layout.addView(body)
    layout.addView(closeButton)
    setContentView(layout)
  }
}
`;

function withHealthConnectRationaleManifest(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const manifestPath = path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml');
      const packageName = config.android?.package ?? 'local.healthconnect.app';
      const packagePath = packageName.replace(/\./g, '/');
      const activityPath = path.join(projectRoot, `android/app/src/main/java/${packagePath}/PermissionsRationaleActivity.kt`);

      fs.mkdirSync(path.dirname(activityPath), { recursive: true });
      fs.writeFileSync(activityPath, RATIONALE_ACTIVITY.replace('package local.healthconnect.app', `package ${packageName}`));

      if (!fs.existsSync(manifestPath)) {
        return config;
      }

      let manifest = fs.readFileSync(manifestPath, 'utf8');
      if (!manifest.includes('android.health.connect.action.SHOW_PERMISSIONS_RATIONALE')) {
        manifest = manifest.replace(
          '<action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"/>',
          '<action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"/>\n        <action android:name="android.health.connect.action.SHOW_PERMISSIONS_RATIONALE"/>\n        <category android:name="android.intent.category.DEFAULT"/>'
        );
      }

      if (!manifest.includes('android:name=".PermissionsRationaleActivity"')) {
        manifest = manifest.replace(
          '  </application>',
          `    <activity android:name=".PermissionsRationaleActivity" android:exported="true">
      <intent-filter>
        <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"/>
        <action android:name="android.health.connect.action.SHOW_PERMISSIONS_RATIONALE"/>
        <category android:name="android.intent.category.DEFAULT"/>
      </intent-filter>
    </activity>
    <activity-alias android:name="ViewPermissionUsageActivity" android:exported="true" android:targetActivity=".MainActivity" android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
      <intent-filter>
        <action android:name="android.intent.action.VIEW_PERMISSION_USAGE"/>
        <category android:name="android.intent.category.HEALTH_PERMISSIONS"/>
      </intent-filter>
    </activity-alias>
  </application>`
        );
      }

      fs.writeFileSync(manifestPath, manifest);
      return config;
    }
  ]);
}

function withLegacyWorkCleanup(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const packageName = config.android?.package ?? 'local.healthconnect.app';
      const packagePath = packageName.replace(/\./g, '/');
      const mainApplicationPath = path.join(projectRoot, `android/app/src/main/java/${packagePath}/MainApplication.kt`);
      const buildGradlePath = path.join(projectRoot, 'android/app/build.gradle');

      if (fs.existsSync(mainApplicationPath)) {
        let mainApplication = fs.readFileSync(mainApplicationPath, 'utf8');
        if (!mainApplication.includes('androidx.work.WorkManager')) {
          mainApplication = mainApplication.replace(
            'import android.content.res.Configuration\n',
            'import android.content.res.Configuration\nimport androidx.work.WorkManager\n'
          );
        }
        if (!mainApplication.includes('cancelUniqueWork("healthconnect-wifi-sync")')) {
          mainApplication = mainApplication.replace(
            '    super.onCreate()\n',
            '    super.onCreate()\n    WorkManager.getInstance(this).cancelUniqueWork("healthconnect-wifi-sync")\n'
          );
        }
        fs.writeFileSync(mainApplicationPath, mainApplication);
      }

      if (fs.existsSync(buildGradlePath)) {
        let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
        if (!buildGradle.includes('androidx.work:work-runtime-ktx')) {
          buildGradle = buildGradle.replace(
            '    implementation("com.facebook.react:react-android")\n',
            '    implementation("com.facebook.react:react-android")\n    implementation("androidx.work:work-runtime-ktx:2.9.1")\n'
          );
          fs.writeFileSync(buildGradlePath, buildGradle);
        }
      }

      return config;
    }
  ]);
}

function withHealthConnectPermissionDelegate(config) {
  config = withMainActivity(config, (config) => {
    const mainActivity = config.modResults;
    if (mainActivity.language !== 'kt') {
      return config;
    }

    let contents = mainActivity.contents;
    if (!contents.includes('dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate')) {
      contents = contents.replace(
        'import com.facebook.react.defaults.DefaultReactActivityDelegate\n',
        'import com.facebook.react.defaults.DefaultReactActivityDelegate\n\nimport dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate\n'
      );
    }

    if (!contents.includes('HealthConnectPermissionDelegate.setPermissionDelegate(this)')) {
      contents = contents.replace(
        /super\.onCreate\((?:null|savedInstanceState)\)/,
        (match) => `${match}\n    HealthConnectPermissionDelegate.setPermissionDelegate(this)`
      );
    }

    mainActivity.contents = contents;
    return config;
  });
  config = withHealthConnectRationaleManifest(config);
  return withLegacyWorkCleanup(config);
}

module.exports = withHealthConnectPermissionDelegate;
