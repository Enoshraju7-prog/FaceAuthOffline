package com.faceauthapp.frameprocessor

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry

class FaceDetectionPackage : ReactPackage {

    companion object {
        init {
            // Register the "detectFaces" frame processor plugin so it is accessible
            // from JS worklets as global.detectFaces(frame)
            FrameProcessorPluginRegistry.addFrameProcessorPlugin("detectFaces") { proxy, options ->
                DetectFacesPlugin(proxy, options)
            }
        }
    }

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = emptyList()
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
