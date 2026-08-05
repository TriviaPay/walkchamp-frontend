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
 * Continuous TYPE_STEP_COUNTER (+ TYPE_STEP_DETECTOR) listener for the foreground service.
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
  private var stepDetectorSensor: Sensor? = null
  private var sensorHandlerThread: HandlerThread? = null
  private var sensorHandler: Handler? = null
  private val registered = AtomicBoolean(false)
  private var lastSensorTotal: Float = -1f
  private var pendingKnownTodaySteps: Int? = null
  private var state: NativeStepState = NativeStepState.load(context) ?: defaultState()
  private var lastDetectorFlushMs = 0L

  init {
    if (state.sensorTotal > 0f) {
      lastSensorTotal = state.sensorTotal
    }
  }

  private val stepListener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent?) {
      val type = event?.sensor?.type ?: return
      when (type) {
        Sensor.TYPE_STEP_COUNTER -> {
          val sensorTotal = event.values[0]
          Log.d(TAG, "[WalkChampFGS] sensor step event total=$sensorTotal")
          handleSensorTotal(sensorTotal)
        }
        Sensor.TYPE_STEP_DETECTOR -> {
          // Individual steps wake OEM batching while the screen is off.
          // Only flush the primary TYPE_STEP_COUNTER listener — never register a
          // second temporary listener (that can stall delivery on Samsung/OEM builds).
          val now = System.currentTimeMillis()
          if (now - lastDetectorFlushMs < 200L) return
          lastDetectorFlushMs = now
          try {
            sensorManager?.flush(this)
          } catch (_: Exception) {
          }
        }
      }
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
    registerSensorListener()
  }

  /** Unregister + register again so OEM step delivery resumes after background. */
  fun restart() {
    if (registered.get()) {
      try {
        sensorManager?.unregisterListener(stepListener)
      } catch (_: Exception) {
      }
      registered.set(false)
      Log.d(TAG, "[StepFGS] sensor listener restarted")
    }
    registerSensorListener()
  }

  /**
   * Force a hardware counter sample while the app is killed / screen is locked.
   * Many OEM builds (Samsung) batch TYPE_STEP_COUNTER until unlock — flush the
   * primary listener (do NOT register a second temporary listener that can break
   * delivery on some OEMs).
   */
  fun pollHardwareNow() {
    ensureCurrentDay()
    if (!registered.get()) {
      registerSensorListener()
    }
    try {
      sensorManager?.flush(stepListener)
    } catch (e: Exception) {
      Log.d(TAG, "[StepFGS] sensor flush failed: ${e.message}")
    }
    // Bootstrap only: first sample when this process has never seen the counter.
    // Avoid secondary listeners while tracking — they can stall OEM delivery.
    if (lastSensorTotal < 0f) {
      val counter = NativeStepCounterReader.readCumulativeCounter(context, 2_000L)
      if (counter != null) {
        Log.d(TAG, "[StepFGS] pollHardwareNow bootstrap counter=$counter")
        handleSensorTotal(counter.toFloat())
      } else {
        Log.d(TAG, "[StepFGS] pollHardwareNow — waiting for primary listener")
      }
      return
    }
    // Screen-off stall: re-register primary listener + flush (no second listener).
    val staleMs = System.currentTimeMillis() - state.updatedAt
    if (staleMs >= 8_000L) {
      Log.d(TAG, "[StepFGS] pollHardwareNow stale recovery restart staleMs=$staleMs")
      restart()
      try {
        sensorManager?.flush(stepListener)
      } catch (_: Exception) {
      }
    }
  }

  private fun registerSensorListener() {
    if (registered.get()) {
      Log.d(TAG, "[StepFGS] sensor listener already registered")
      return
    }
    sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    stepCounterSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    stepDetectorSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
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
      // SENSOR_DELAY_FASTEST + maxReportLatencyUs=0: ask OEMs not to batch while FGS holds
      // a partial wake lock (professional pedometer pattern).
      sensorManager?.registerListener(
        stepListener,
        stepCounterSensor,
        SensorManager.SENSOR_DELAY_FASTEST,
        /* maxReportLatencyUs */ 0,
        sensorHandler,
      )
      if (stepDetectorSensor != null) {
        sensorManager?.registerListener(
          stepListener,
          stepDetectorSensor,
          SensorManager.SENSOR_DELAY_FASTEST,
          /* maxReportLatencyUs */ 0,
          sensorHandler,
        )
        Log.d(TAG, "[StepFGS] TYPE_STEP_DETECTOR registered")
      }
      registered.set(true)
      Log.d(TAG, "[StepFGS] sensor listener registered TYPE_STEP_COUNTER delay=FASTEST maxLatency=0")
    } catch (e: Exception) {
      try {
        sensorManager?.registerListener(
          stepListener,
          stepCounterSensor,
          SensorManager.SENSOR_DELAY_GAME,
          /* maxReportLatencyUs */ 0,
          sensorHandler,
        )
        if (stepDetectorSensor != null) {
          sensorManager?.registerListener(
            stepListener,
            stepDetectorSensor,
            SensorManager.SENSOR_DELAY_GAME,
            sensorHandler,
          )
        }
        registered.set(true)
        Log.d(TAG, "[StepFGS] sensor listener registered TYPE_STEP_COUNTER (fallback GAME)")
      } catch (e2: Exception) {
        Log.w(TAG, "[StepFGS] sensor register failed: ${e2.message}")
      }
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

  /**
   * Raise the daily floor from JS/notification-known steps. Never decreases an
   * already-tracked native total (restore / UPDATE_WALK must not freeze progress).
   */
  fun seedDailyBaselineFromKnownSteps(
    knownTodaySteps: Int,
    sensorTotal: Float? = null,
    stepSource: String? = null,
  ) {
    val total = sensorTotal ?: lastSensorTotal.takeIf { it >= 0f }
    val source = stepSource ?: state.stepSource
    val verified = !isDeviceSensorSource(source)
    val known = maxOf(knownTodaySteps.coerceAtLeast(0), state.todaySteps)
    if (verified) {
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
      setPendingKnownTodaySteps(known)
      return
    }
    val baseline = (total - known).coerceAtLeast(0f)
    state = state.copy(
      dailyBaseline = baseline,
      sensorTotal = total,
      todaySteps = known,
      localDate = NativeStepState.localDateString(),
      stepSource = "android_step_counter",
      sensorSupported = true,
      updatedAt = System.currentTimeMillis(),
    )
    lastSensorTotal = total
    Log.d(TAG, "[StepFGS] dailyBaseline=$baseline todaySteps=${state.todaySteps}")
    persistAndEmit(state, force = true)
  }

  /**
   * Restore / watchdog path: raise the floor if needed, but do not re-anchor an
   * already-valid baseline (re-seeding every RESTORE freezes closed-app counting).
   */
  fun ensureDailyFloor(knownTodaySteps: Int, stepSource: String? = null) {
    val floor = maxOf(knownTodaySteps.coerceAtLeast(0), state.todaySteps)
    val source = stepSource ?: state.stepSource
    if (state.dailyBaseline == null || lastSensorTotal < 0f) {
      seedDailyBaselineFromKnownSteps(floor, stepSource = source)
      return
    }
    if (floor > state.todaySteps) {
      seedDailyBaselineFromKnownSteps(floor, stepSource = source)
    } else if (!isDeviceSensorSource(source) && state.stepSource != source) {
      state = state.copy(stepSource = source, updatedAt = System.currentTimeMillis())
      NativeStepState.save(context, state)
    }
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
      // Never lower an in-flight race floor on restore.
      if (knownRaceSteps > state.raceSteps) {
        val total = sensorTotal ?: lastSensorTotal.takeIf { it >= 0f }
        if (total != null && total >= 0f) {
          val baseline = (total - knownRaceSteps).coerceAtLeast(0f)
          state = state.copy(
            raceBaseline = baseline,
            raceSteps = knownRaceSteps,
            updatedAt = System.currentTimeMillis(),
          )
          persistAndEmit(state, force = true)
        } else {
          state = state.copy(raceSteps = knownRaceSteps, updatedAt = System.currentTimeMillis())
          NativeStepState.save(context, state)
        }
      }
      start()
      return
    }
    val total = sensorTotal ?: lastSensorTotal.takeIf { it >= 0f }
    val steps = maxOf(knownRaceSteps.coerceAtLeast(0), state.raceSteps)
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
    // Health Connect / HealthKit from JS is authoritative for daily totals when higher.
    // Never re-anchor downward — that freezes closed-app sensor continuation.
    if (!isDeviceSensorSource(stepSource)) {
      val known = maxOf(todaySteps.coerceAtLeast(0), state.todaySteps)
      val total = lastSensorTotal.takeIf { it >= 0f }
      seedDailyBaselineFromKnownSteps(known, total, stepSource)
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

    val verifiedDaily = !isDeviceSensorSource(state.stepSource)

    // Always advance todaySteps from TYPE_STEP_COUNTER for live Walk UI + ongoing
    // notification. Health Connect remains the verified sync source in JS; when HC
    // is delayed/empty (common on Samsung), sensor keeps the display moving.
    // Keep stepSource as health_connect/healthkit when verified — do not flip to
    // android_step_counter (that would claim sensor is the verified daily source).
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
      Log.d(
        TAG,
        "[StepFGS] dailyBaseline=$dailyBaseline todaySteps=${(sensorTotal - dailyBaseline).toInt().coerceAtLeast(0)} verifiedDaily=$verifiedDaily",
      )
    }
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
      maxOf((sensorTotal - raceBaseline).toInt().coerceAtLeast(0), state.raceSteps)
    } else {
      state.raceSteps
    }

    val prevToday = state.todaySteps
    val prevRace = state.raceSteps
    if (todaySteps == prevToday && raceSteps == prevRace && state.sensorTotal == sensorTotal) {
      return
    }

    state = state.copy(
      sensorTotal = sensorTotal,
      todaySteps = todaySteps,
      raceSteps = raceSteps,
      stepSource = if (verifiedDaily) state.stepSource else "android_step_counter",
      sensorSupported = true,
      updatedAt = System.currentTimeMillis(),
    )
    persistAndEmit(state, force = false)
    Log.d(
      TAG,
      "[WalkChampFGS] todaySteps=$todaySteps raceSteps=$raceSteps sensorTotal=$sensorTotal source=${state.stepSource} verifiedDaily=$verifiedDaily",
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

  /**
   * TYPE_STEP_COUNTER reset (reboot / sensor wrap). Re-anchor baselines so
   * already-accepted race progress is preserved:
   *   newRaceBaseline = sensorTotal - previouslyAcceptedRaceSteps
   */
  private fun resetBaselinesSafely(sensorTotal: Float) {
    val verifiedDaily = !isDeviceSensorSource(state.stepSource)
    val preservedRace =
      if (!state.activeRaceId.isNullOrBlank()) state.raceSteps.coerceAtLeast(0) else 0
    val newRaceBaseline =
      if (!state.activeRaceId.isNullOrBlank()) {
        (sensorTotal - preservedRace).coerceAtLeast(0f)
      } else {
        null
      }
    // Hybrid verified daily: keep HC-fed todaySteps; only re-seed sensor baseline.
    // Legacy sensor daily: reset today and re-anchor from the new counter.
    state = state.copy(
      sensorTotal = sensorTotal,
      dailyBaseline = if (verifiedDaily) {
        (sensorTotal - state.todaySteps).coerceAtLeast(0f)
      } else {
        sensorTotal
      },
      raceBaseline = newRaceBaseline,
      todaySteps = if (verifiedDaily) state.todaySteps else 0,
      raceSteps = preservedRace,
      updatedAt = System.currentTimeMillis(),
    )
    lastSensorTotal = sensorTotal
    Log.w(
      TAG,
      "[StepFGS] reboot re-anchor sensorTotal=$sensorTotal preservedRace=$preservedRace raceBaseline=$newRaceBaseline",
    )
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
