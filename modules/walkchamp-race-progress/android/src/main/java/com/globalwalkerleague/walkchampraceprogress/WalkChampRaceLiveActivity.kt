package com.globalwalkerleague.walkchampraceprogress

import android.content.Context
import java.util.concurrent.ConcurrentHashMap

/** iOS Live Activity bridge stub on Android — no-op. */
object WalkChampRaceLiveActivity {
  fun start(context: Context?, payload: Map<String, Any?>) {}
  fun update(payload: Map<String, Any?>) {}
  fun end(raceId: String) {}
}

/** Walk step Live Activity stub on Android — notifications use the foreground service. */
object WalkChampWalkLiveActivity {
  fun start(payload: Map<String, Any?>) {}
  fun update(payload: Map<String, Any?>) {}
  fun end() {}
}
