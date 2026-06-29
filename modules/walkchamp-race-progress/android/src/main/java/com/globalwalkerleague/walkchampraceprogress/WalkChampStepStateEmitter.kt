package com.globalwalkerleague.walkchampraceprogress

/**
 * Bridges native foreground-service step updates to the Expo module event emitter.
 */
object WalkChampStepStateEmitter {
  var onStepStateUpdated: ((Map<String, Any?>) -> Unit)? = null

  fun emit(state: NativeStepState) {
    try {
      onStepStateUpdated?.invoke(state.toEventMap())
    } catch (_: Exception) {
    }
  }
}
