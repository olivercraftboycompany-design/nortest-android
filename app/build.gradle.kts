import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Signing: CI passes the release keystore through env vars (from repo secrets).
// Locally you can put the same values in keystore.properties (never committed).
val ksProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(env: String, prop: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: ksProps.getProperty(prop)

val ksFile = signingValue("NORTEST_KEYSTORE_FILE", "storeFile")
val hasReleaseKey = ksFile != null && file(ksFile).exists()

android {
    namespace = "com.olivercraftboy.nortest"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.olivercraftboy.nortest"
        minSdk = 24
        targetSdk = 34
        versionCode = (System.getenv("NORTEST_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("NORTEST_VERSION_NAME") ?: "1.0"
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(ksFile!!)
                storePassword = signingValue("NORTEST_KEYSTORE_PASSWORD", "storePassword")
                keyAlias = signingValue("NORTEST_KEY_ALIAS", "keyAlias")
                keyPassword = signingValue("NORTEST_KEY_PASSWORD", "keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        abortOnError = false
        checkReleaseBuilds = true
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.media:media:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    testImplementation("junit:junit:4.13.2")
}
