package local.alis.app

import androidx.work.WorkManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class HealthConnectNativeModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "HealthConnectNative"

    @ReactMethod
    fun saveSettings(apiBaseUrl: String, deviceToken: String, lastSyncAt: String?, promise: Promise) {
        saveHealthConnectSettings(
            healthConnectPrefs(reactContext),
            apiBaseUrl,
            deviceToken,
            lastSyncAt
        )
        HealthConnectSyncScheduler.enqueue(reactContext)
        promise.resolve(true)
    }

    @ReactMethod
    fun enqueueBackgroundSync(promise: Promise) {
        HealthConnectSyncScheduler.enqueue(reactContext)
        promise.resolve(true)
    }

    @ReactMethod
    fun getBackgroundStatus(promise: Promise) {
        val status = healthConnectPrefs(reactContext)
            .getString("lastBackgroundSyncStatus", null)
        promise.resolve(status)
    }

    @ReactMethod
    fun getBackgroundCursor(promise: Promise) {
        val lastSyncAt = healthConnectPrefs(reactContext)
            .getString("lastSyncAt", null)
        promise.resolve(lastSyncAt)
    }

    @ReactMethod
    fun cancelBackgroundSync(promise: Promise) {
        WorkManager.getInstance(reactContext).cancelUniqueWork(HEALTHCONNECT_SYNC_WORK_NAME)
        promise.resolve(true)
    }
}
