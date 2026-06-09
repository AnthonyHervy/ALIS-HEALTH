package local.alis.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class HealthConnectPrefsTest {
    @Test
    fun migrateRawHealthConnectPrefsCopiesMissingKnownKeysAndRemovesPlaintext() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val rawPrefs = context.getSharedPreferences("raw-healthconnect-test", Context.MODE_PRIVATE)
        val encryptedPrefs = context.getSharedPreferences("encrypted-healthconnect-test", Context.MODE_PRIVATE)
        rawPrefs.edit()
            .clear()
            .putString("apiBaseUrl", "https://api.example.test")
            .putString("deviceToken", "plain-token")
            .putString("lastSyncAt", "2026-01-01T00:00:00Z")
            .putString("lastBackgroundSyncStatus", """{"status":"synced"}""")
            .putString("lastBackgroundSuccessAt", "2026-01-01T00:05:00Z")
            .putString("unrelated", "kept")
            .commit()
        encryptedPrefs.edit()
            .clear()
            .putString("deviceToken", "secure-token")
            .commit()

        migrateRawHealthConnectPrefs(encryptedPrefs, rawPrefs)

        assertEquals("https://api.example.test", encryptedPrefs.getString("apiBaseUrl", null))
        assertEquals("secure-token", encryptedPrefs.getString("deviceToken", null))
        assertEquals("2026-01-01T00:00:00Z", encryptedPrefs.getString("lastSyncAt", null))
        assertEquals("""{"status":"synced"}""", encryptedPrefs.getString("lastBackgroundSyncStatus", null))
        assertEquals("2026-01-01T00:05:00Z", encryptedPrefs.getString("lastBackgroundSuccessAt", null))
        assertFalse(rawPrefs.contains("apiBaseUrl"))
        assertFalse(rawPrefs.contains("deviceToken"))
        assertFalse(rawPrefs.contains("lastSyncAt"))
        assertFalse(rawPrefs.contains("lastBackgroundSyncStatus"))
        assertFalse(rawPrefs.contains("lastBackgroundSuccessAt"))
        assertEquals("kept", rawPrefs.getString("unrelated", null))
    }

    @Test
    fun saveHealthConnectSettingsPreservesExistingLastSyncAtWhenCursorIsNull() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = context.getSharedPreferences("healthconnect-save-test", Context.MODE_PRIVATE)
        prefs.edit()
            .clear()
            .putString("lastSyncAt", "2026-05-31T09:00:00Z")
            .commit()

        saveHealthConnectSettings(
            prefs,
            apiBaseUrl = "https://api.example.test",
            deviceToken = "token",
            lastSyncAt = null
        )

        assertEquals("https://api.example.test", prefs.getString("apiBaseUrl", null))
        assertEquals("token", prefs.getString("deviceToken", null))
        assertEquals("2026-05-31T09:00:00Z", prefs.getString("lastSyncAt", null))
    }

    @Test
    fun saveHealthConnectSettingsUpdatesLastSyncAtWhenCursorIsPresent() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = context.getSharedPreferences("healthconnect-save-update-test", Context.MODE_PRIVATE)
        prefs.edit()
            .clear()
            .putString("lastSyncAt", "2026-05-31T09:00:00Z")
            .commit()

        saveHealthConnectSettings(
            prefs,
            apiBaseUrl = "https://api.example.test",
            deviceToken = "token",
            lastSyncAt = "2026-05-31T10:00:00Z"
        )

        assertEquals("2026-05-31T10:00:00Z", prefs.getString("lastSyncAt", null))
    }
}
