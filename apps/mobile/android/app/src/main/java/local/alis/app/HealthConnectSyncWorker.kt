package local.alis.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.time.Duration
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlin.math.abs

const val HEALTHCONNECT_SYNC_WORK_NAME = "healthconnect-background-sync"
private val SLEEP_LOOKBACK = Duration.ofHours(48)
private val WORKOUT_KEY_BUCKET = Duration.ofMinutes(15)
private val LEGACY_WORKOUT_OVERLAP_TOLERANCE = Duration.ofMinutes(30)
private val MAX_WORKOUT_NOTIFICATION_AGE = Duration.ofMinutes(90)
private val MIN_WORKOUT_NOTIFICATION_DURATION = Duration.ofMinutes(10)
private val TRAINING_ACTIVITY_TYPES = setOf(
    "running",
    "cycling",
    "stationary_biking",
    "spinning",
    "strength_training",
    "rowing",
    "swimming"
)
private val NOTIFIABLE_WORKOUT_ORIGINS = setOf("com.garmin.android.apps.connectmobile")
private const val WORKOUT_ANALYSIS_CHANNEL_ID = "workout-analysis"
private const val WORKOUT_ANALYSIS_NOTIFICATION_ID = 4208
private const val LAST_WORKOUT_NOTIFICATION_KEY = "lastWorkoutNotificationKey"

class HealthConnectSyncWorker(
    private val context: Context,
    params: WorkerParameters
) : Worker(context, params) {
    override fun doWork(): Result = runBlocking {
        val prefs = healthConnectPrefs(context)
        val apiBaseUrl = prefs.getString("apiBaseUrl", null)?.trimEnd('/')
        val deviceToken = prefs.getString("deviceToken", null)
        val lastSyncAt = prefs.getString("lastSyncAt", null)
        val now = Instant.now()

        if (apiBaseUrl.isNullOrBlank() || deviceToken.isNullOrBlank()) {
            persistStatus(prefs, "skipped", "unconfigured", now)
            return@runBlocking Result.success()
        }
        if (lastSyncAt.isNullOrBlank()) {
            reportSyncRun(apiBaseUrl, deviceToken, "skipped", "initial_sync_required", null, now)
            persistStatus(prefs, "skipped", "initial_sync_required", now)
            return@runBlocking Result.success()
        }

        val start = try {
            Instant.parse(lastSyncAt).minus(Duration.ofHours(2))
        } catch (_: Exception) {
            now.minus(Duration.ofHours(26))
        }

        try {
            val availability = HealthConnectClient.getSdkStatus(context)
            if (availability != HealthConnectClient.SDK_AVAILABLE) {
                reportSyncRun(apiBaseUrl, deviceToken, "failed", "Health Connect indisponible", start, now)
                persistStatus(prefs, "failed", "Health Connect indisponible", now)
                return@runBlocking Result.retry()
            }

            val client = HealthConnectClient.getOrCreate(context)
            val batch = buildBatch(client, start, now)
            postJson("$apiBaseUrl/api/v1/ingest/health", deviceToken, batch)
            maybeNotifyWorkoutAnalysis(prefs, batch, now)
            prefs.edit()
                .putString("lastSyncAt", now.toString())
                .putString("lastBackgroundSuccessAt", now.toString())
                .apply()
            persistStatus(prefs, "synced", "${countRecords(batch)} records", now)
            Result.success()
        } catch (security: SecurityException) {
            reportSyncRun(apiBaseUrl, deviceToken, "failed", "Permissions Health Connect background manquantes", start, now)
            persistStatus(prefs, "failed", "Permissions Health Connect background manquantes", now)
            Result.success()
        } catch (error: Exception) {
            reportSyncRun(apiBaseUrl, deviceToken, "failed", error.message ?: "Erreur background native", start, now)
            persistStatus(prefs, "failed", error.message ?: "Erreur background native", now)
            Result.retry()
        }
    }

    private suspend fun buildBatch(client: HealthConnectClient, start: Instant, end: Instant): JSONObject {
        val range = TimeRangeFilter.between(start, end)
        val sleepRange = TimeRangeFilter.between(start.minus(SLEEP_LOOKBACK), end)
        val steps = client.readRecords(ReadRecordsRequest(StepsRecord::class, timeRangeFilter = range, pageSize = 1000)).records
        val sleeps = client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, timeRangeFilter = sleepRange, pageSize = 1000)).records
        val workouts = client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, timeRangeFilter = range, pageSize = 1000)).records
        val heartRates = client.readRecords(ReadRecordsRequest(HeartRateRecord::class, timeRangeFilter = range, pageSize = 1000)).records
        val hrv = client.readRecords(ReadRecordsRequest(HeartRateVariabilityRmssdRecord::class, timeRangeFilter = range, pageSize = 1000)).records
        val restingHeartRates = client.readRecords(ReadRecordsRequest(RestingHeartRateRecord::class, timeRangeFilter = range, pageSize = 1000)).records
        val vo2Max = client.readRecords(ReadRecordsRequest(Vo2MaxRecord::class, timeRangeFilter = range, pageSize = 1000)).records
        val activeCalories = client.readRecords(ReadRecordsRequest(ActiveCaloriesBurnedRecord::class, timeRangeFilter = range, pageSize = 1000)).records
        val totalCalories = client.readRecords(ReadRecordsRequest(TotalCaloriesBurnedRecord::class, timeRangeFilter = range, pageSize = 1000)).records
        val distance = client.readRecords(ReadRecordsRequest(DistanceRecord::class, timeRangeFilter = range, pageSize = 1000)).records
        return JSONObject()
            .put("source_type", "healthconnect")
            .put("device_name", "Android WorkManager")
            .put("device_id", "android-workmanager")
            .put("data_start", start.minus(SLEEP_LOOKBACK).toString())
            .put("data_end", end.toString())
            .put("sync_trigger", "background")
            .put("sync_mode", "incremental")
            .put("network_type", "CONNECTED")
            .put("steps", JSONArray().apply {
                steps.forEach { record ->
                    put(JSONObject()
                        .put("start_time", record.startTime.toString())
                        .put("end_time", record.endTime.toString())
                        .put("count", record.count)
                        .put("metadata", metadata(record.metadata.id, record.metadata.dataOrigin.packageName)))
                }
            })
            .put("sleep", JSONArray().apply {
                sleeps.forEach { record ->
                    put(JSONObject()
                        .put("start_time", record.startTime.toString())
                        .put("end_time", record.endTime.toString())
                        .put("metadata", metadata(record.metadata.id, record.metadata.dataOrigin.packageName))
                        .put("stages", JSONArray().apply {
                            record.stages.forEach { stage ->
                                put(JSONObject()
                                    .put("start_time", stage.startTime.toString())
                                    .put("end_time", stage.endTime.toString())
                                    .put("stage", sleepStage(stage.stage)))
                            }
                        }))
                }
            })
            .put("workouts", JSONArray().apply {
                workouts.forEach { record ->
                    put(JSONObject()
                        .put("start_time", record.startTime.toString())
                        .put("end_time", record.endTime.toString())
                        .put("activity_type", exerciseType(record.exerciseType))
                        .put("metadata", metadata(record.metadata.id, record.metadata.dataOrigin.packageName)))
                }
            })
            .put("heart_rate", JSONArray().apply {
                heartRates.forEach { record ->
                    record.samples.forEach { sample ->
                        put(JSONObject()
                            .put("timestamp", sample.time.toString())
                            .put("bpm", sample.beatsPerMinute)
                            .put("metadata", metadata(record.metadata.id, record.metadata.dataOrigin.packageName)))
                    }
                }
            })
            .put("hrv", JSONArray().apply {
                hrv.forEach { record ->
                    put(JSONObject()
                        .put("timestamp", record.time.toString())
                        .put("rmssd_ms", record.heartRateVariabilityMillis)
                        .put("metadata", metadata(record.metadata.id, record.metadata.dataOrigin.packageName)))
                }
            })
            .put("resting_heart_rate", JSONArray().apply {
                restingHeartRates.forEach { record ->
                    put(JSONObject()
                        .put("timestamp", record.time.toString())
                        .put("bpm", record.beatsPerMinute)
                        .put("metadata", metadata(record.metadata.id, record.metadata.dataOrigin.packageName)))
                }
            })
            .put("vo2_max", JSONArray().apply {
                vo2Max.forEach { record ->
                    put(JSONObject()
                        .put("timestamp", record.time.toString())
                        .put("ml_per_kg_min", record.vo2MillilitersPerMinuteKilogram)
                        .put("measurement_method", record.measurementMethod)
                        .put("metadata", metadata(record.metadata.id, record.metadata.dataOrigin.packageName)))
                }
            })
            .put("calories", JSONArray().apply {
                activeCalories.forEach { record ->
                    put(JSONObject()
                        .put("start_time", record.startTime.toString())
                        .put("end_time", record.endTime.toString())
                        .put("calories", record.energy.inKilocalories)
                        .put("is_active", true)
                        .put("metadata", metadata(record.metadata.id, record.metadata.dataOrigin.packageName)))
                }
                totalCalories.forEach { record ->
                    put(JSONObject()
                        .put("start_time", record.startTime.toString())
                        .put("end_time", record.endTime.toString())
                        .put("calories", record.energy.inKilocalories)
                        .put("is_active", false)
                        .put("metadata", metadata(record.metadata.id, record.metadata.dataOrigin.packageName)))
                }
            })
            .put("distance", JSONArray().apply {
                distance.forEach { record ->
                    put(JSONObject()
                        .put("start_time", record.startTime.toString())
                        .put("end_time", record.endTime.toString())
                        .put("meters", record.distance.inMeters)
                        .put("metadata", metadata(record.metadata.id, record.metadata.dataOrigin.packageName)))
                }
            })
    }

    private fun metadata(id: String, origin: String): JSONObject {
        return JSONObject().put("id", id).put("dataOrigin", origin)
    }

    private fun sleepStage(stage: Int): String = when (stage) {
        SleepSessionRecord.STAGE_TYPE_AWAKE,
        SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> "awake"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
        SleepSessionRecord.STAGE_TYPE_REM -> "rem"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "out_of_bed"
        else -> "sleeping"
    }

    private fun exerciseType(type: Int): String = when (type) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "running"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING,
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "cycling"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER,
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL -> "swimming"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING -> "strength_training"
        else -> "other"
    }

    private fun countRecords(batch: JSONObject): Int {
        return batch.getJSONArray("steps").length() +
            batch.getJSONArray("sleep").length() +
            batch.getJSONArray("workouts").length() +
            batch.getJSONArray("heart_rate").length() +
            batch.getJSONArray("hrv").length() +
            batch.getJSONArray("resting_heart_rate").length() +
            batch.getJSONArray("vo2_max").length() +
            batch.getJSONArray("calories").length() +
            batch.getJSONArray("distance").length()
    }

    private fun maybeNotifyWorkoutAnalysis(prefs: android.content.SharedPreferences, batch: JSONObject, now: Instant) {
        val workout = latestWorkout(batch.getJSONArray("workouts")) ?: return
        if (!isNotifiableWorkout(workout, now)) return
        if (isAlreadyNotifiedWorkout(prefs.getString(LAST_WORKOUT_NOTIFICATION_KEY, null), workout)) return
        val key = stableWorkoutKey(workout)
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            notificationManager.createNotificationChannel(
                NotificationChannel(
                    WORKOUT_ANALYSIS_CHANNEL_ID,
                    "Analyses entraînement",
                    NotificationManager.IMPORTANCE_HIGH
                )
            )
        }

        val activityType = workout.optString("activity_type")
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("alis://workout-analysis?workout=${Uri.encode(key)}"))
            .setPackage(context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pendingIntent = PendingIntent.getActivity(
            context,
            WORKOUT_ANALYSIS_NOTIFICATION_ID,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, WORKOUT_ANALYSIS_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_alis)
            .setContentTitle("Bravo pour ce ${workoutShortLabel(activityType)} !")
            .setContentText("Découvrir mon analyse")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        notificationManager.notify(WORKOUT_ANALYSIS_NOTIFICATION_ID, notification)
        prefs.edit().putString(LAST_WORKOUT_NOTIFICATION_KEY, key).apply()
    }

    private fun latestWorkout(workouts: JSONArray): JSONObject? {
        var latest: JSONObject? = null
        for (index in 0 until workouts.length()) {
            val workout = workouts.optJSONObject(index) ?: continue
            val latestEnd = latest?.optString("end_time") ?: ""
            if (workout.optString("end_time") > latestEnd) {
                latest = workout
            }
        }
        return latest
    }

    private fun isNotifiableWorkout(workout: JSONObject, now: Instant): Boolean {
        val activityType = workout.optString("activity_type")
        if (activityType !in TRAINING_ACTIVITY_TYPES) return false
        val duration = workoutDurationMinutes(workout) ?: return false
        if (duration < MIN_WORKOUT_NOTIFICATION_DURATION.toMinutes()) return false
        val end = parseWorkoutInstant(workout.optString("end_time")) ?: return false
        if (end.isAfter(now.plus(Duration.ofMinutes(5)))) return false
        if (Duration.between(end, now) > MAX_WORKOUT_NOTIFICATION_AGE) return false
        val origin = metadataOrigin(workout) ?: return false
        return origin in NOTIFIABLE_WORKOUT_ORIGINS
    }

    private fun metadataOrigin(workout: JSONObject): String? {
        val origin = workout.optJSONObject("metadata")?.optString("dataOrigin")
        return origin?.takeIf { it.isNotBlank() }
    }

    private fun stableWorkoutKey(workout: JSONObject): String {
        val start = parseWorkoutInstant(workout.optString("start_time")) ?: return legacyWorkoutKey(workout)
        val durationMinutes = workoutDurationMinutes(workout) ?: return legacyWorkoutKey(workout)
        val bucketMillis = WORKOUT_KEY_BUCKET.toMillis()
        val bucketedStart = Instant.ofEpochMilli((start.toEpochMilli() / bucketMillis) * bucketMillis)
        val bucketedDuration = maxOf(
            WORKOUT_KEY_BUCKET.toMinutes(),
            Math.round(durationMinutes.toFloat() / WORKOUT_KEY_BUCKET.toMinutes()) * WORKOUT_KEY_BUCKET.toMinutes()
        )
        return "workout:${workout.optString("activity_type")}:$bucketedStart:${bucketedDuration}m"
    }

    private fun legacyWorkoutKey(workout: JSONObject): String {
        return "${workout.optString("start_time")}|${workout.optString("end_time")}|${workout.optString("activity_type")}"
    }

    private fun isAlreadyNotifiedWorkout(lastKey: String?, workout: JSONObject): Boolean {
        if (lastKey.isNullOrBlank()) return false
        if (lastKey == stableWorkoutKey(workout) || lastKey == legacyWorkoutKey(workout)) return true
        val parts = lastKey.split("|")
        if (parts.size < 3 || parts[2] != workout.optString("activity_type")) return false
        val previousStart = parseWorkoutInstant(parts[0]) ?: return false
        val previousEnd = parseWorkoutInstant(parts[1]) ?: return false
        val currentStart = parseWorkoutInstant(workout.optString("start_time")) ?: return false
        val currentEnd = parseWorkoutInstant(workout.optString("end_time")) ?: return false
        val startsClose = abs(Duration.between(previousStart, currentStart).toMillis()) <= LEGACY_WORKOUT_OVERLAP_TOLERANCE.toMillis()
        val endsClose = abs(Duration.between(previousEnd, currentEnd).toMillis()) <= LEGACY_WORKOUT_OVERLAP_TOLERANCE.toMillis()
        val overlaps = !previousEnd.isBefore(currentStart) && !currentEnd.isBefore(previousStart)
        return startsClose && (endsClose || overlaps)
    }

    private fun parseWorkoutInstant(value: String): Instant? {
        return try {
            Instant.parse(value)
        } catch (_: Exception) {
            null
        }
    }

    private fun workoutDurationMinutes(workout: JSONObject): Long? {
        val start = parseWorkoutInstant(workout.optString("start_time")) ?: return null
        val end = parseWorkoutInstant(workout.optString("end_time")) ?: return null
        if (!end.isAfter(start)) return null
        return Duration.between(start, end).toMinutes()
    }

    private fun workoutShortLabel(activityType: String): String = when (activityType) {
        "running", "running_treadmill" -> "RUN"
        "strength_training" -> "RENFO"
        "cycling", "stationary_biking", "spinning" -> "RPM"
        "swimming" -> "NATATION"
        else -> exerciseLabel(activityType).uppercase()
    }

    private fun exerciseLabel(activityType: String): String = activityType
        .split("_")
        .filter { it.isNotBlank() }
        .joinToString(" ") { part -> part.replaceFirstChar { char -> char.uppercase() } }

    private fun reportSyncRun(apiBaseUrl: String, deviceToken: String, status: String, message: String, start: Instant?, end: Instant) {
        val payload = JSONObject()
            .put("trigger", "background")
            .put("sync_mode", "incremental")
            .put("status", status)
            .put("network_type", "CONNECTED")
            .put("error_message", message)
        if (start != null) payload.put("data_start", start.toString())
        payload.put("data_end", end.toString())
        postJson("$apiBaseUrl/api/v1/sync-runs/report", deviceToken, payload)
    }

    private fun postJson(url: String, token: String, payload: JSONObject) {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "application/json")
            connectTimeout = 15000
            readTimeout = 30000
            doOutput = true
        }
        try {
            OutputStreamWriter(connection.outputStream).use { it.write(payload.toString()) }
            val code = connection.responseCode
            if (code !in 200..299) {
                throw IllegalStateException("HealthConnect API $code")
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun persistStatus(prefs: android.content.SharedPreferences, status: String, detail: String, now: Instant) {
        prefs.edit()
            .putString("lastBackgroundSyncStatus", JSONObject()
                .put("status", status)
                .put("detail", detail)
                .put("recordedAt", now.toString())
                .toString())
            .apply()
    }
}

object HealthConnectSyncScheduler {
    fun enqueue(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val request = PeriodicWorkRequestBuilder<HealthConnectSyncWorker>(1, TimeUnit.HOURS)
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            HEALTHCONNECT_SYNC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }
}
