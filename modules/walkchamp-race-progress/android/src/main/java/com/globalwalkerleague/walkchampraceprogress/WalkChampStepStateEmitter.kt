package com.globalwalkerleague.walkchampraceprogress

/**
 * Bridges native foreground-service step updates to the Expo module event emitter.
 */
object WalkChampStepStateEmitter {
  var onStepStateUpdated: ((Map<String, Any?>) -> Unit)? = null
  var onWalkStepRefreshRequested: (() -> Unit)? = null

  fun emit(state: NativeStepState) {
    try {
      onStepStateUpdated?.invoke(state.toEventMap())
    } catch (_: Exception) {
    }
  }

  /** FGS tick — asks JS to refresh Health Connect / HealthKit daily steps while backgrounded. */
  fun emitWalkStepRefreshRequest() {
    try {
      onWalkStepRefreshRequested?.invoke()
    } catch (_: Exception) {
    }
  }
}
