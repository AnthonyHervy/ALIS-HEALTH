package local.alis.app

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class PermissionsRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val padding = (24 * resources.displayMetrics.density).toInt()
    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(padding, padding, padding, padding)
    }

    val title = TextView(this).apply {
      text = "Permissions Health Connect"
      textSize = 20f
      gravity = Gravity.CENTER
    }

    val body = TextView(this).apply {
      text = "HealthConnect lit les donnees autorisees localement, puis les synchronise vers ton serveur personnel."
      textSize = 14f
      gravity = Gravity.CENTER
    }

    val closeButton = Button(this).apply {
      text = "Fermer"
      setOnClickListener { finish() }
    }

    layout.addView(title)
    layout.addView(body)
    layout.addView(closeButton)
    setContentView(layout)
  }
}
