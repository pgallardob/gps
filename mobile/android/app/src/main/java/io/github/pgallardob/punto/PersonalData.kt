package io.github.pgallardob.punto

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArraySet

object PersonalData {
    val route = PersonalRoute()
    var mapTilesEnabled = !BuildConfig.SIMULATION
    @Volatile var current: Fix? = null
        private set
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    @Synchronized fun accept(fix: Fix, record: Boolean = false) {
        if (current != null && fix.elapsedMillis < requireNotNull(current).elapsedMillis) return
        current = fix
        if (record) route.add(fix, System.currentTimeMillis())
        changed()
    }
    fun changed() { Handler(Looper.getMainLooper()).post { listeners.forEach { it() } } }
    fun observe(listener: () -> Unit) { listeners.add(listener); listener() }
    fun remove(listener: () -> Unit) { listeners.remove(listener) }
}
