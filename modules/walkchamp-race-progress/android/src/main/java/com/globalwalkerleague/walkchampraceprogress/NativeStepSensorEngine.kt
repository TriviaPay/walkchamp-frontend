package com.globalwalkerleague.walkchampraceprogress

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Continuous TYPE_STEP_COUNTER listener for the foreground service.
 *
 * Runs independently of React Native / Health Connect so background notifications
 * keep updating from real hardware events while the FGS is alive.
 *
 * Only emits updates when the hardware counter produces a new real value.
 * Never increments steps artificially — if no sensor event arrives, the count stays flat.
 */
class NativeStepSensorEngine(
  private val context: Context,
  private val onRealStepUpdate: (NativeStepState) -> Unit,
) {
  companion object {
    private const val TAG = "StepFGS"
  }

  private var sensorManager: SensorManager? = null
  private var stepCounterSensor: Sensor? = null
  private var sensorHandlerThread: HandlerThread? = null
  private var sensorHandler: Handler? = null
  private val registered = AtomicBoolean(false)
  private var lastSensorTotal: Float = -1f
  private var pendingKnownTodaySteps: Int? = null
  private var state: NativeStepState = NativeStepState.load(context) ?: defaultState()

  init {
    if (state.sensorTotal > 0f) {
      lastSensorTotal = state.sensorTotal
    }
  }

  private val stepListener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent?) {
      if (event?.sensor?.type != Sensor.TYPE_STEP_COUNTER) return
      val sensorTotal = event.values[0]
      Log.d(TAG, "[WalkChampFGS] sensor step event total=$sensorTotal")
      handleSensorTotal(sensorTotal)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
  }

  fun currentState(): NativeStepState = state

  /** Returns true when the local calendar day rolled over and daily steps were reset. */
  fun checkAndRollDailyDay(): Boolean {
    val beforeDate = state.localDate
    val rolled = ensureCurrentDay()
    return rolled || (beforeDate != state.localDate)
  }

  fun isSensorSupported(): Boolean = stepCounterSensor != null

  fun hasActivityRecognitionPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.ACTIVITY_RECOGNITION,
    ) == PackageManager.PERMISSION_GRANTED
  }

  fun start() {
    if (registered.get()) {
      Log.d(TAG, "[StepFGS] sensor listener already registered")
      return
    }
    sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    stepCounterSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    if (stepCounterSensor == null) {
      Log.w(TAG, "[UnsupportedDevice] TYPE_STEP_COUNTER unavailable")
      state = state.copy(
        sensorSupported = false,
        stepSource = "unsupported",
        updatedAt = System.currentTimeMillis(),
      )
      NativeStepState.save(context, state)
      onRealStepUpdate(state)
      return
    }
    if (!hasActivityRecognitionPermission()) {
      Log.w(TAG, "[StepFGS] ACTIVITY_RECOGNITION not granted — sensor may not deliver events")
    } else {
      Log.d(TAG, "[StepFGS] sensor available type=TYPE_STEP_COUNTER")
    }
    ensureSensorHandler()
    try {
      sensorManager?.registerListener(
        stepListener,
        stepCounterSensor,
        SensorManager.SENSOR_DELAY_NORMAL,
        sensorHandler,
      )
      registered.set(true)
      Log.d(TAG, "[StepFGS] sensor listener registered TYPE_STEP_COUNTER (background thread)")
    } catch (e: Exception) {
      Log.w(TAG, "[StepFGS] sensor register failed: ${e.message}")
    }
    ensureCurrentDay()
  }

  private fun ensureSensorHandler() {
    if (sensorHandlerThread?.isAlive == true) return
    sensorHandlerThread = HandlerThread("WalkChampStepSensor").also { it.start() }
    sensorHandler = Handler(sensorHandlerThread!!.looper)
  }

  fun stop() {
    if (!registered.getAndSet(false)) return
    try {
      sensorManager?.unregisterListener(stepListener)
      Log.d(TAG, "[StepFGS] sensor listener unregistered")
    } catch (_: Exception) {
    }
  }

  /** Store JS-known today steps to seed daily baseline on the first sensor event. */
  fun setPendingKnownTodaySteps(knownTodaySteps: Int) {
    pendingKnownTodaySteps = knownTodaySteps.coerceAtLeast(0)
    Log.d(TAG, "[StepFGS] pendingKnownTodaySteps=$pendingKnownTodaySteps")
  }

  /** Seed daily baseline from JS-known today steps at tracking start. */
  fun seedDailyBaselineFromKnownSteps(
    knownTodaySteps: Int,
    sensorTotal: Float? = null,
    stepSource: String? = null,
  ) {
    val total = sensorTotal ?: lastSensorTotal.takeIf { it >= 0f }
    val source = stepSource ?: state.stepSource
    val verified = !isDeviceSensorSource(source)
    if (verified) {
      val known = knownTodaySteps.coerceAtLeast(0)
      state = state.copy(
        todaySteps = known,
        localDate = NativeStepState.localDateString(),
        stepSource = source,
        sensorSupported = true,
        updatedAt = System.currentTimeMillis(),
      )
      if (total != null && total >= 0f) {
        lastSensorTotal = total
        // Seed baseline so hardware events keep updating the notification when JS is idle.
        val baseline = (total - known).coerceAtLeast(0f)
        state = state.copy(sensorTotal = total, dailyBaseline = baseline)
      } else {
        setPendingKnownTodaySteps(known)
      }
      Log.d(TAG, "[WalkChampFGS] verified source todaySteps=${state.todaySteps} source=$source")
      persistAndEmit(state, force = true)
      return
    }
    if (total == null || total < 0f) {
      setPendingKnownTodaySteps(knownTodaySteps)
      return
    }
    val baseline = (total - knownTodaySteps.coerceAtLeast(0)).coerceAtLeast(0f)
    state = state.copy(
      dailyBaseline = baseline,
      sensorTotal = total,
      todaySteps = knownTodaySteps.coerceAtLeast(0),
      localDate = NativeStepState.localDateString(),
      stepSource = "android_step_counter",
      sensorSupported = true,
      updatedAt = System.currentTimeMillis(),
    )
    lastSensorTotal = total
    Log.d(TAG, "[StepFGS] dailyBaseline=$baseline todaySteps=${state.todaySteps}")
    persistAndEmit(state, force = true)
  }

  /** Set race baseline at race start — race steps begin at 0. */
  fun startRace(raceId: String, sensorTotal: Float? = null) {
    val total = sensorTotal ?: lastSensorTotal.takeIf { it >= 0f }
    if (total != null && total >= 0f) {
      state = state.copy(
        activeRaceId = raceId,
        raceBaseline = total,
        raceSteps = 0,
        notificationMode = "race_live",
        raceStatus = "in_progress",
        updatedAt = System.currentTimeMillis(),
      )
      lastSensorTotal = total
      persistAndEmit(state, force = true)
      Log.d(TAG, "[StepFGS] race baseline set raceId=$raceId baseline=$total")
    } else {
      state = state.copy(
        activeRaceId = raceId,
        raceBaseline = null,
        raceSteps = 0,
        notificationMode = "race_live",
        raceStatus = "in_progress",
        updatedAt = System.currentTimeMillis(),
      )
      NativeStepState.save(context, state)
      Log.d(TAG, "[StepFGS] race start awaiting sensor raceId=$raceId")
    }
    start()
  }

  /** Restore race tracking after service restart without resetting progress. */
  fun resumeRace(raceId: String, knownRaceSteps: Int, sensorTotal: Float? = null) {
    if (state.activeRaceId == raceId && state.raceBaseline != null) {
      start()
      return
    }
    val total = sensorTotal ?: lastSensorTotal.takeIf { it >= 0f }
    val steps = knownRaceSteps.coerceAtLeast(0)
    if (total != null && total >= 0f) {
      val baseline = (total - steps).coerceAtLeast(0f)
      state = state.copy(
        activeRaceId = raceId,
        raceBaseline = baseline,
        raceSteps = steps,
        notificationMode = "race_live",
        raceStatus = "in_progress",
        updatedAt = System.currentTimeMillis(),
      )
      lastSensorTotal = total
      persistAndEmit(state, force = true)
      Log.d(TAG, "[StepFGS] race resumed raceId=$raceId baseline=$baseline raceSteps=$steps")
    } else {
      state = state.copy(
        activeRaceId = raceId,
        raceBaseline = null,
        raceSteps = steps,
        notificationMode = "race_live",
        raceStatus = "in_progress",
        updatedAt = System.currentTimeMillis(),
      )
      NativeStepState.save(context, state)
      Log.d(TAG, "[StepFGS] race resumed awaiting sensor raceId=$raceId knownRaceSteps=$steps")
    }
    start()
  }

  fun endRace(todaySteps: Int) {
    state = state.copy(
      activeRaceId = null,
      raceBaseline = null,
      raceSteps = 0,
      todaySteps = todaySteps.coerceAtLeast(state.todaySteps),
      notificationMode = "daily_steps",
      raceStatus = "finished",
      updatedAt = System.currentTimeMillis(),
    )
    persistAndEmit(state, force = true)
  }

  fun mergeJsWalkUpdate(todaySteps: Int, stepSource: String) {
    // Health Connect / HealthKit from JS — reconcile only when JS value is ahead.
    // Seed sensor baseline so TYPE_STEP_COUNTER can keep the ongoing notification
    // updating while the app is backgrounded or closed (JS polls stop).
    if (!isDeviceSensorSource(stepSource)) {
      val next = todaySteps.coerceAtLeast(0)
      if (next > state.todaySteps) {
        val total = lastSensorTotal.takeIf { it >= 0f }
        if (total != null && total >= 0f) {
          seedDailyBaselineFromKnownSteps(next, total, stepSource)
        } else {
          setPendingKnownTodaySteps(next)
          state = state.copy(
            todaySteps = next,
            stepSource = stepSource,
            notificationMode = if (state.activeRaceId != null) "race_live" else "daily_steps",
            updatedAt = System.currentTimeMillis(),
          )
          NativeStepState.save(context, state)
        }
      } else {
        // Keep verified label, but ensure a baseline exists so hardware events
        // can still advance the notification after JS goes idle.
        val total = lastSensorTotal.takeIf { it >= 0f }
        if (total != null && state.dailyBaseline == null && state.todaySteps >= 0) {
          val baseline = (total - state.todaySteps).coerceAtLeast(0f)
          state = state.copy(
            dailyBaseline = baseline,
            sensorTotal = total,
            stepSource = stepSource,
            notificationMode = if (state.activeRaceId != null) "race_live" else "daily_steps",
            updatedAt = System.currentTimeMillis(),
          )
        } else {
          state = state.copy(
            stepSource = stepSource,
            notificationMode = if (state.activeRaceId != null) "race_live" else "daily_steps",
            updatedAt = System.currentTimeMillis(),
          )
        }
        NativeStepState.save(context, state)
      }
      return
    }
    if (todaySteps > state.todaySteps) {
      val total = lastSensorTotal.takeIf { it >= 0f } ?: return
      seedDailyBaselineFromKnownSteps(todaySteps, total)
    }
  }

  fun mergeJsRaceUpdate(
    raceSteps: Int,
    rank: Int,
    totalParticipants: Int,
    goalSteps: Int,
    timeLeftSeconds: Int,
    username: String,
    stepSource: String,
  ) {
    val next = raceSteps.coerceAtLeast(0)
    if (!isDeviceSensorSource(stepSource)) {
      if (next > state.raceSteps) {
        state = state.copy(
          raceSteps = next,
          rank = rank,
          totalParticipants = totalParticipants,
          goalSteps = goalSteps,
          timeLeftSeconds = timeLeftSeconds,
          username = username,
          stepSource = stepSource,
          notificationMode = "race_live",
          updatedAt = System.currentTimeMillis(),
        )
        persistAndEmit(state, force = true)
      } else {
        state = state.copy(
          rank = rank,
          totalParticipants = totalParticipants,
          goalSteps = goalSteps,
          timeLeftSeconds = timeLeftSeconds,
          username = username,
          stepSource = stepSource,
          updatedAt = System.currentTimeMillis(),
        )
        NativeStepState.save(context, state)
      }
    } else if (next > state.raceSteps) {
      state = state.copy(
        raceSteps = next,
        rank = rank,
        totalParticipants = totalParticipants,
        goalSteps = goalSteps,
        timeLeftSeconds = timeLeftSeconds,
        username = username,
        updatedAt = System.currentTimeMillis(),
      )
      persistAndEmit(state, force = true)
    }
  }

  fun updateMetadata(
    userId: String?,
    notificationMode: String,
    stepSource: String,
  ) {
    state = state.copy(
      userId = userId,
      notificationMode = notificationMode,
      stepSource = stepSource,
      updatedAt = System.currentTimeMillis(),
    )
    NativeStepState.save(context, state)
  }

  private fun handleSensorTotal(sensorTotal: Float) {
    ensureCurrentDay()

    if (lastSensorTotal >= 0f && sensorTotal < lastSensorTotal) {
      Log.w(TAG, "[StepFGS] sensor reset detected last=$lastSensorTotal now=$sensorTotal — resetting baselines")
      resetBaselinesSafely(sensorTotal)
      return
    }
    lastSensorTotal = sensorTotal

    // Always advance walk notification steps from TYPE_STEP_COUNTER while FGS is alive.
    // Health Connect / HealthKit remain canonical in JS when the app is open; when the app
    // is backgrounded/closed JS polls stop, so the hardware sensor must keep the ongoing
    // notification live (previous working behavior before verified-source early-return).
    var dailyBaseline = state.dailyBaseline
    if (dailyBaseline == null) {
      val known = pendingKnownTodaySteps
      dailyBaseline = if (known != null) {
        (sensorTotal - known).coerceAtLeast(0f)
      } else if (state.todaySteps > 0) {
        (sensorTotal - state.todaySteps).coerceAtLeast(0f)
      } else {
        sensorTotal
      }
      pendingKnownTodaySteps = null
      state = state.copy(dailyBaseline = dailyBaseline)
      Log.d(TAG, "[StepFGS] dailyBaseline=$dailyBaseline todaySteps=${(sensorTotal - dailyBaseline).toInt().coerceAtLeast(0)}")
    }

    // Never regress below the last known (e.g. HC) total within the same day.
    val todaySteps = maxOf(
      (sensorTotal - dailyBaseline).toInt().coerceAtLeast(0),
      state.todaySteps,
    )

    val raceSteps = if (!state.activeRaceId.isNullOrBlank()) {
      var raceBaseline = state.raceBaseline
      if (raceBaseline == null) {
        raceBaseline = if (state.raceSteps > 0) {
          (sensorTotal - state.raceSteps).coerceAtLeast(0f)
        } else {
          sensorTotal
        }
        state = state.copy(raceBaseline = raceBaseline)
        Log.d(TAG, "[StepFGS] raceBaseline=$raceBaseline from sensorTotal=$sensorTotal")
      }
      (sensorTotal - raceBaseline).toInt().coerceAtLeast(0)
    } else {
      0
    }

    val prevToday = state.todaySteps
    val prevRace = state.raceSteps
    if (todaySteps == prevToday && raceSteps == prevRace && state.sensorTotal == sensorTotal) {
      return
    }

    val keepVerifiedLabel = !isDeviceSensorSource(state.stepSource)
    state = state.copy(
      sensorTotal = sensorTotal,
      todaySteps = todaySteps,
      raceSteps = raceSteps,
      // Keep HC/HealthKit label for metadata; sensor still drives notification counts.
      stepSource = if (keepVerifiedLabel) state.stepSource else "android_step_counter",
      sensorSupported = true,
      updatedAt = System.currentTimeMillis(),
    )
    persistAndEmit(state, force = false)
    Log.d(
      TAG,
      "[WalkChampFGS] todaySteps=$todaySteps raceSteps=$raceSteps sensorTotal=$sensorTotal source=${state.stepSource}",
    )
  }

  private fun ensureCurrentDay(): Boolean {
    val today = NativeStepState.localDateString()
    if (state.localDate == today) return false
    Log.d(TAG, "[StepFGS] new day detected — resetting daily baseline")
    val total = lastSensorTotal.takeIf { it >= 0f } ?: state.sensorTotal
    state = state.copy(
      localDate = today,
      dailyBaseline = total,
      todaySteps = 0,
      updatedAt = System.currentTimeMillis(),
    )
    persistAndEmit(state, force = true)
    return true
  }

  private fun resetBaselinesSafely(sensorTotal: Float) {
    state = state.copy(
      sensorTotal = sensorTotal,
      dailyBaseline = sensorTotal,
      raceBaseline = if (state.activeRaceId != null) sensorTotal else null,
      todaySteps = 0,
      raceSteps = 0,
      updatedAt = System.currentTimeMillis(),
    )
    lastSensorTotal = sensorTotal
    persistAndEmit(state, force = true)
  }

  private fun persistAndEmit(next: NativeStepState, force: Boolean) {
    NativeStepState.save(context, next)
    Log.d(TAG, "[StepFGS] persisted native state updatedAt=${next.updatedAt} todaySteps=${next.todaySteps}")
    onRealStepUpdate(next)
    WalkChampStepStateEmitter.emit(next)
  }

  private fun defaultState(): NativeStepState = NativeStepState(
    userId = null,
    sensorTotal = 0f,
    dailyBaseline = null,
    raceBaseline = null,
    todaySteps = 0,
    raceSteps = 0,
    activeRaceId = null,
    notificationMode = "none",
    stepSource = "health_connect",
    localDate = NativeStepState.localDateString(),
    sensorSupported = true,
    updatedAt = System.currentTimeMillis(),
    lastBackendSyncedAt = null,
  )

  private fun isDeviceSensorSource(stepSource: String): Boolean {
    return when (stepSource.lowercase()) {
      "sensor", "android_step_counter", "limited_sensor", "android_legacy_sensor" -> true
      else -> false
    }
  }
}
