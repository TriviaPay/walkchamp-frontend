package com.globalwalkerleague.walkchampraceprogress

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Reads cumulative TYPE_STEP_COUNTER while the foreground service is alive.
 * Works with the app backgrounded or swiped from recents (not after force-stop).
 */
object NativeStepCounterReader {
  private const val TAG = "NativeStepReader"

  fun readCumulativeCounter(context: Context, timeoutMs: Long = 2500L): Long? {
    val sm = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    if (sm == null) {
      Log.w(TAG, "SensorManager unavailable")
      return null
    }
    val sensor = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    if (sensor == null) {
      Log.w(TAG, "TYPE_STEP_COUNTER unavailable")
      return null
    }

  var counter: Long? = null
    val latch = CountDownLatch(1)
    val listener = object : SensorEventListener {
      override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type != Sensor.TYPE_STEP_COUNTER || counter != null) return
        counter = event.values[0].toLong()
        latch.countDown()
      }

      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    try {
      sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
      latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    } catch (e: Exception) {
      Log.w(TAG, "step counter read failed: ${e.message}")
    } finally {
      try {
        sm.unregisterListener(listener)
      } catch (_: Exception) {
      }
    }

    if (counter != null) {
      Log.d(TAG, "read counter=$counter")
    }
    return counter
  }
}
