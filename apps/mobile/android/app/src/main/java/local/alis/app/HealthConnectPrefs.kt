package local.alis.app

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

const val HEALTHCONNECT_PREFS = "healthconnect_native"

private const val HEALTHCONNECT_PREFS_TAG = "HealthConnectPrefs"

private val HEALTHCONNECT_PREF_KEYS = listOf(
    "apiBaseUrl",
    "deviceToken",
    "lastSyncAt",
    "lastBackgroundSyncStatus",
    "lastBackgroundSuccessAt",
    "lastWorkoutNotificationKey"
)

fun encryptedHealthConnectPrefs(context: Context): SharedPreferences? {
    return try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            HEALTHCONNECT_PREFS,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (error: Exception) {
        Log.w(
            HEALTHCONNECT_PREFS_TAG,
            "Encrypted HealthConnect prefs unavailable; falling back to private SharedPreferences",
            error
        )
        null
    }
}

fun healthConnectPrefs(context: Context): SharedPreferences {
    val rawPrefs = context.getSharedPreferences(HEALTHCONNECT_PREFS, Context.MODE_PRIVATE)
    val encryptedPrefs = encryptedHealthConnectPrefs(context)
        ?: return rawPrefs
    migrateRawHealthConnectPrefs(encryptedPrefs, rawPrefs)
    return encryptedPrefs
}

fun saveHealthConnectSettings(
    prefs: SharedPreferences,
    apiBaseUrl: String,
    deviceToken: String,
    lastSyncAt: String?
) {
    val editor = prefs.edit()
        .putString("apiBaseUrl", apiBaseUrl)
        .putString("deviceToken", deviceToken)
    if (lastSyncAt != null) {
        editor.putString("lastSyncAt", lastSyncAt)
    }
    editor.apply()
}

internal fun migrateRawHealthConnectPrefs(encryptedPrefs: SharedPreferences, rawPrefs: SharedPreferences) {
    val valuesToMigrate = HEALTHCONNECT_PREF_KEYS.mapNotNull { key ->
        val rawValue = rawPrefs.getString(key, null)
        if (rawValue != null && !encryptedPrefs.contains(key)) {
            key to rawValue
        } else {
            null
        }
    }
    if (valuesToMigrate.isNotEmpty()) {
        val encryptedEditor = encryptedPrefs.edit()
        valuesToMigrate.forEach { (key, value) ->
            encryptedEditor.putString(key, value)
        }
        if (!encryptedEditor.commit()) {
            return
        }
    }

    val keysToRemove = HEALTHCONNECT_PREF_KEYS.filter { rawPrefs.contains(it) }
    if (keysToRemove.isNotEmpty()) {
        val rawEditor = rawPrefs.edit()
        keysToRemove.forEach { rawEditor.remove(it) }
        rawEditor.commit()
    }
}
