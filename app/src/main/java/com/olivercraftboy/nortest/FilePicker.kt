package com.olivercraftboy.nortest

/** Turns an HTML accept= list into MIME types for the Android file picker. */
object FilePicker {
    fun mimeTypesFor(accept: List<String>, extToMime: (String) -> String?): List<String> {
        val out = linkedSetOf<String>()
        for (raw in accept.flatMap { it.split(',') }) {
            val a = raw.trim().lowercase()
            if (a.isEmpty()) continue
            if (a.startsWith(".")) {
                val ext = a.substring(1)
                val m = when (ext) {
                    "zip" -> "application/zip"
                    else -> extToMime(ext)
                }
                if (m != null) out.add(m) else out.add("*/*")
            } else if (a.contains('/')) {
                out.add(a)
            }
        }
        if (out.isEmpty() || out.contains("*/*")) return listOf("*/*")
        // Some phones label zip files differently; let any of them through.
        if (out.contains("application/zip")) {
            out.add("application/x-zip-compressed"); out.add("application/x-zip"); out.add("application/octet-stream")
        }
        return out.toList()
    }
}
