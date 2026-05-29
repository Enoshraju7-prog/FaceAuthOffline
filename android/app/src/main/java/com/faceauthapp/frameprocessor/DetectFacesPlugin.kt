package com.faceauthapp.frameprocessor

import android.content.res.AssetFileDescriptor
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.VisionCameraProxy
import org.tensorflow.lite.Interpreter
import java.io.ByteArrayOutputStream
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * VisionCamera v3 Frame Processor Plugin — runs BlazeFace on every camera frame.
 *
 * Registered as "detectFaces" in FaceDetectionPackage.
 * Called from JS worklet: global.detectFaces(frame)
 *
 * Returns: { detections: [{ x, y, width, height, score, keypoints: [{x,y}×6] }] }
 */
class DetectFacesPlugin(proxy: VisionCameraProxy, options: Map<String, Any>?) :
    FrameProcessorPlugin(proxy, options) {

    companion object {
        private const val INPUT_SIZE    = 128
        private const val NUM_ANCHORS   = 896
        private const val NUM_COORDS    = 16  // 4 box + 6 keypoints × 2
        private const val SCORE_THRESH  = 0.75f
        private const val IOU_THRESH    = 0.3f
        private const val MODEL_FILE    = "models/blazeface.tflite"
    }

    private val interpreter: Interpreter by lazy {
        Interpreter(loadModelFile(), Interpreter.Options().apply {
            numThreads = 2
            useNNAPI   = true   // use Android Neural Networks API if available
        })
    }

    // Pre-computed anchors: [numAnchors × 4] as [cx, cy, w, h] in [0,1]
    private val anchors: Array<FloatArray> by lazy { generateAnchors() }

    // Reusable input buffer: [1, 128, 128, 3] float32
    private val inputBuffer: ByteBuffer = ByteBuffer
        .allocateDirect(1 * INPUT_SIZE * INPUT_SIZE * 3 * 4)
        .order(ByteOrder.nativeOrder())

    override fun callback(frame: Frame, arguments: Map<String, Any>?): Any {
        val image = frame.image

        // Convert YUV_420_888 → RGB Bitmap → scale to 128×128
        val bitmap = yuv420ToBitmap(image)
            ?: return mapOf("detections" to emptyList<Any>())

        val scaled = Bitmap.createScaledBitmap(bitmap, INPUT_SIZE, INPUT_SIZE, true)

        // Fill input buffer: normalise to [-1, 1]
        inputBuffer.rewind()
        for (y in 0 until INPUT_SIZE) {
            for (x in 0 until INPUT_SIZE) {
                val px = scaled.getPixel(x, y)
                inputBuffer.putFloat(((px shr 16 and 0xFF) / 127.5f) - 1f) // R
                inputBuffer.putFloat(((px shr 8  and 0xFF) / 127.5f) - 1f) // G
                inputBuffer.putFloat(((px        and 0xFF) / 127.5f) - 1f) // B
            }
        }

        // Run inference
        val regressors = Array(1) { Array(NUM_ANCHORS) { FloatArray(NUM_COORDS) } }
        val scores     = Array(1) { Array(NUM_ANCHORS) { FloatArray(1) } }
        interpreter.runForMultipleInputsOutputs(
            arrayOf(inputBuffer),
            mapOf(0 to regressors, 1 to scores)
        )

        // Decode detections
        val detections = decode(regressors[0], scores[0], frame.width, frame.height)

        bitmap.recycle()
        scaled.recycle()

        return mapOf("detections" to detections)
    }

    // ─── Decoding ─────────────────────────────────────────────────────────────

    private fun decode(
        regressors: Array<FloatArray>,
        scores: Array<FloatArray>,
        frameW: Int,
        frameH: Int,
    ): List<Map<String, Any>> {
        val raw = mutableListOf<Map<String, Any>>()
        val scaleX = frameW.toFloat() / INPUT_SIZE
        val scaleY = frameH.toFloat() / INPUT_SIZE

        for (i in 0 until NUM_ANCHORS) {
            val score = sigmoid(scores[i][0])
            if (score < SCORE_THRESH) continue

            val r  = regressors[i]
            val ax = anchors[i][0]
            val ay = anchors[i][1]

            val cx = r[0] / INPUT_SIZE + ax
            val cy = r[1] / INPUT_SIZE + ay
            val w  = r[2] / INPUT_SIZE
            val h  = r[3] / INPUT_SIZE

            val kps = (0 until 6).map { k ->
                mapOf(
                    "x" to ((r[4 + k * 2]     / INPUT_SIZE + ax) * scaleX).toDouble(),
                    "y" to ((r[4 + k * 2 + 1] / INPUT_SIZE + ay) * scaleY).toDouble(),
                )
            }

            raw.add(mapOf(
                "x"         to ((cx - w / 2) * scaleX).toDouble(),
                "y"         to ((cy - h / 2) * scaleY).toDouble(),
                "width"     to (w * scaleX).toDouble(),
                "height"    to (h * scaleY).toDouble(),
                "score"     to score.toDouble(),
                "keypoints" to kps,
            ))
        }

        return nonMaxSuppression(raw)
    }

    private fun nonMaxSuppression(dets: List<Map<String, Any>>): List<Map<String, Any>> {
        val sorted = dets.sortedByDescending { it["score"] as Double }
        val kept   = mutableListOf<Map<String, Any>>()
        val suppressed = BooleanArray(sorted.size)

        for (i in sorted.indices) {
            if (suppressed[i]) continue
            kept.add(sorted[i])
            for (j in i + 1 until sorted.size) {
                if (!suppressed[j] && iou(sorted[i], sorted[j]) > IOU_THRESH) {
                    suppressed[j] = true
                }
            }
        }
        return kept
    }

    private fun iou(a: Map<String, Any>, b: Map<String, Any>): Float {
        val ax1 = (a["x"] as Double).toFloat()
        val ay1 = (a["y"] as Double).toFloat()
        val ax2 = ax1 + (a["width"]  as Double).toFloat()
        val ay2 = ay1 + (a["height"] as Double).toFloat()
        val bx1 = (b["x"] as Double).toFloat()
        val by1 = (b["y"] as Double).toFloat()
        val bx2 = bx1 + (b["width"]  as Double).toFloat()
        val by2 = by1 + (b["height"] as Double).toFloat()

        val ix = max(0f, min(ax2, bx2) - max(ax1, bx1))
        val iy = max(0f, min(ay2, by2) - max(ay1, by1))
        val inter = ix * iy
        val union = (ax2-ax1)*(ay2-ay1) + (bx2-bx1)*(by2-by1) - inter
        return inter / (union + 1e-8f)
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private fun sigmoid(x: Float) = (1f / (1f + exp(-x.toDouble()))).toFloat()

    private fun loadModelFile(): MappedByteBuffer {
        val afd: AssetFileDescriptor = proxy.context.assets.openFd(MODEL_FILE)
        val fis = FileInputStream(afd.fileDescriptor)
        return fis.channel.map(FileChannel.MapMode.READ_ONLY, afd.startOffset, afd.declaredLength)
    }

    private fun yuv420ToBitmap(image: android.media.Image): Bitmap? {
        if (image.format != ImageFormat.YUV_420_888) return null
        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]

        val yBuffer = yPlane.buffer
        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer

        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()

        val nv21 = ByteArray(ySize + uSize + vSize)
        yBuffer.get(nv21, 0, ySize)
        vBuffer.get(nv21, ySize, vSize)
        uBuffer.get(nv21, ySize + vSize, uSize)

        val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), 80, out)
        val jpegBytes = out.toByteArray()
        return android.graphics.BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size)
    }

    /** Generate BlazeFace short-range anchors (matches generate_anchors.py output). */
    private fun generateAnchors(): Array<FloatArray> {
        val strides    = intArrayOf(8, 16, 16, 16)
        val anchors    = mutableListOf<FloatArray>()
        val anchorOffsetX = 0.5f
        val anchorOffsetY = 0.5f

        for (layerId in strides.indices) {
            val stride   = strides[layerId]
            val featureW = (INPUT_SIZE + stride - 1) / stride
            val featureH = featureW
            val numAnchorsPerCell = 2

            for (y in 0 until featureH) {
                for (x in 0 until featureW) {
                    repeat(numAnchorsPerCell) {
                        val cx = (x + anchorOffsetX) / featureW
                        val cy = (y + anchorOffsetY) / featureH
                        anchors.add(floatArrayOf(cx, cy, 1f, 1f))
                    }
                }
            }
        }
        return anchors.toTypedArray()
    }
}
