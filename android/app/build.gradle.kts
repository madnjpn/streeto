plugins {
    id("com.android.application")
}

android {
    namespace = "net.streeto.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "net.streeto.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

configurations.configureEach {
    resolutionStrategy {
        force(
            "org.jetbrains.kotlin:kotlin-stdlib:1.8.22",
            "org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.22",
            "org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.22",
        )
    }
}

dependencies {
    implementation(platform("org.jetbrains.kotlin:kotlin-bom:1.8.22"))
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}
