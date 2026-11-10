import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.github.pgallardob.punto"
    compileSdk = 36
    defaultConfig {
        applicationId = "io.github.pgallardob.punto"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-preview"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { buildConfig = true }
    flavorDimensions += "relay"
    productFlavors {
        create("live") {
            dimension = "relay"
            buildConfigField("String", "RELAY_BASE_URL", "\"https://gps-lj9l.onrender.com\"")
            buildConfigField("boolean", "SIMULATION", "false")
        }
        create("simulation") {
            dimension = "relay"
            applicationIdSuffix = ".simulation"
            buildConfigField("String", "RELAY_BASE_URL", "\"http://10.0.2.2:4915/relay\"")
            buildConfigField("boolean", "SIMULATION", "true")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions {
        animationsDisabled = true
    }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

// Android's native HTTP stack allows Origin; desktop JDK restricts it by default.
tasks.withType<org.gradle.api.tasks.testing.Test>().configureEach {
    systemProperty("sun.net.http.allowRestrictedHeaders", "true")
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
