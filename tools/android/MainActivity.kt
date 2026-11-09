package com.othmane.conxol

import android.os.Bundle
import android.graphics.Color
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
    override fun onResume() {
        super.onResume()
        window.decorView.post {
            val display = window.decorView.display ?: return@post
            val mode = display.mode
            val available = display.supportedModes
                .filter { it.physicalWidth == mode.physicalWidth && it.physicalHeight == mode.physicalHeight }
                .maxOfOrNull { it.refreshRate } ?: mode.refreshRate
            // Request up to 120Hz without changing resolution or system settings.
            // Android still applies the device's battery and display policies.
            window.attributes = window.attributes.apply {
                preferredRefreshRate = minOf(120f, available)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val content = findViewById<android.view.View>(android.R.id.content)
        val background = Color.rgb(11, 16, 15)
        window.decorView.setBackgroundColor(background)
        content.setBackgroundColor(background)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        // Keep the WebView inside system bars, cutouts, and the soft keyboard.
        // This also handles Android versions enforcing edge-to-edge windows.
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            insets
        }
    }
}
