import Foundation
import VisionCamera
import TensorFlowLite
import CoreImage
import UIKit
import Accelerate

/**
 * VisionCamera v3 Frame Processor Plugin — iOS (Swift + Metal GPU delegate)
 *
 * Registered as "detectFaces" via the Objective-C bridge file.
 * Called from JS worklet: global.detectFaces(frame)
 *
 * Input:  CVPixelBuffer (kCVPixelFormatType_420YpCbCr8BiPlanarFullRange)
 * Output: { detections: [{ x, y, width, height, score, keypoints: [{x,y}×6] }] }
 */
@objc(DetectFacesPlugin)
public class DetectFacesPlugin: FrameProcessorPlugin {

    // MARK: – Constants
    private static let inputSize   = 128
    private static let numAnchors  = 896
    private static let numCoords   = 16
    private static let scoreThresh = Float(0.75)
    private static let iouThresh   = Float(0.3)
    private static let modelName   = "blazeface"

    // MARK: – Lazy singletons (first frame init)
    private lazy var interpreter: Interpreter? = {
        guard let modelPath = Bundle.main.path(forResource: Self.modelName, ofType: "tflite", inDirectory: "models")
        else { return nil }

        var options = Interpreter.Options()
        options.threadCount = 2

        // Use Metal GPU delegate on iOS for ~2× speedup
        let metalDelegate = MetalDelegate()
        do {
            return try Interpreter(modelPath: modelPath, delegates: [metalDelegate])
        } catch {
            // Fallback to CPU
            return try? Interpreter(modelPath: modelPath)
        }
    }()

    private lazy var anchors: [[Float]] = generateAnchors()

    // MARK: – Plugin entry point

    public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
        guard let interpreter = interpreter else { return ["detections": []] }

        let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer)!

        guard let inputData = preprocess(pixelBuffer: pixelBuffer) else {
            return ["detections": []]
        }

        do {
            try interpreter.allocateTensors()
            try interpreter.copy(inputData, toInputAt: 0)
            try interpreter.invoke()

            let regressorsTensor = try interpreter.output(at: 0)
            let scoresTensor     = try interpreter.output(at: 1)

            let regressors = regressorsTensor.data.toArray(type: Float.self)
            let scores     = scoresTensor.data.toArray(type: Float.self)

            let detections = decode(
                regressors : regressors,
                scores     : scores,
                frameW     : frame.width,
                frameH     : frame.height
            )
            return ["detections": detections]

        } catch {
            return ["detections": []]
        }
    }

    // MARK: – Preprocessing

    private func preprocess(pixelBuffer: CVPixelBuffer) -> Data? {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext()

        let size = CGSize(width: Self.inputSize, height: Self.inputSize)
        let scaleX = size.width  / CGFloat(CVPixelBufferGetWidth(pixelBuffer))
        let scaleY = size.height / CGFloat(CVPixelBufferGetHeight(pixelBuffer))
        let scaled = ciImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

        guard let cgImage = context.createCGImage(scaled, from: CGRect(origin: .zero, size: size))
        else { return nil }

        let channelCount = 3
        var rawBytes = [UInt8](repeating: 0, count: Self.inputSize * Self.inputSize * 4)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(
            data        : &rawBytes,
            width       : Self.inputSize,
            height      : Self.inputSize,
            bitsPerComponent: 8,
            bytesPerRow : Self.inputSize * 4,
            space       : colorSpace,
            bitmapInfo  : CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        ctx.draw(cgImage, in: CGRect(origin: .zero, size: size))

        // RGBA → normalised RGB float32 [-1, 1]
        var floats = [Float32](repeating: 0, count: Self.inputSize * Self.inputSize * channelCount)
        for i in 0 ..< Self.inputSize * Self.inputSize {
            floats[i * 3]     = Float(rawBytes[i * 4])     / 127.5 - 1
            floats[i * 3 + 1] = Float(rawBytes[i * 4 + 1]) / 127.5 - 1
            floats[i * 3 + 2] = Float(rawBytes[i * 4 + 2]) / 127.5 - 1
        }
        return Data(bytes: floats, count: floats.count * MemoryLayout<Float32>.stride)
    }

    // MARK: – Decoding

    private func decode(regressors: [Float], scores: [Float], frameW: Int, frameH: Int) -> [[String: Any]] {
        let scaleX = Float(frameW) / Float(Self.inputSize)
        let scaleY = Float(frameH) / Float(Self.inputSize)
        var raw = [[String: Any]]()

        for i in 0 ..< Self.numAnchors {
            let score = sigmoid(scores[i])
            guard score >= Self.scoreThresh else { continue }

            let base = i * Self.numCoords
            let ax   = anchors[i][0]
            let ay   = anchors[i][1]
            let cx   = regressors[base]     / Float(Self.inputSize) + ax
            let cy   = regressors[base + 1] / Float(Self.inputSize) + ay
            let w    = regressors[base + 2] / Float(Self.inputSize)
            let h    = regressors[base + 3] / Float(Self.inputSize)

            var kps = [[String: Double]]()
            for k in 0 ..< 6 {
                kps.append([
                    "x": Double((regressors[base + 4 + k * 2]     / Float(Self.inputSize) + ax) * scaleX),
                    "y": Double((regressors[base + 4 + k * 2 + 1] / Float(Self.inputSize) + ay) * scaleY),
                ])
            }

            raw.append([
                "x":         Double((cx - w / 2) * scaleX),
                "y":         Double((cy - h / 2) * scaleY),
                "width":     Double(w * scaleX),
                "height":    Double(h * scaleY),
                "score":     Double(score),
                "keypoints": kps,
            ])
        }

        return nonMaxSuppression(raw)
    }

    private func nonMaxSuppression(_ dets: [[String: Any]]) -> [[String: Any]] {
        let sorted     = dets.sorted { ($0["score"] as! Double) > ($1["score"] as! Double) }
        var kept       = [[String: Any]]()
        var suppressed = [Bool](repeating: false, count: sorted.count)

        for i in sorted.indices {
            guard !suppressed[i] else { continue }
            kept.append(sorted[i])
            for j in (i + 1) ..< sorted.count {
                if !suppressed[j] && iou(sorted[i], sorted[j]) > Self.iouThresh {
                    suppressed[j] = true
                }
            }
        }
        return kept
    }

    private func iou(_ a: [String: Any], _ b: [String: Any]) -> Float {
        let ax1 = Float(a["x"] as! Double), ay1 = Float(a["y"] as! Double)
        let ax2 = ax1 + Float(a["width"] as! Double), ay2 = ay1 + Float(a["height"] as! Double)
        let bx1 = Float(b["x"] as! Double), by1 = Float(b["y"] as! Double)
        let bx2 = bx1 + Float(b["width"] as! Double), by2 = by1 + Float(b["height"] as! Double)

        let ix = max(0, min(ax2, bx2) - max(ax1, bx1))
        let iy = max(0, min(ay2, by2) - max(ay1, by1))
        let inter = ix * iy
        let union = (ax2-ax1)*(ay2-ay1) + (bx2-bx1)*(by2-by1) - inter
        return inter / (union + 1e-8)
    }

    private func sigmoid(_ x: Float) -> Float { 1 / (1 + exp(-x)) }

    // MARK: – Anchor generation (mirrors generate_anchors.py)

    private func generateAnchors() -> [[Float]] {
        let strides = [8, 16, 16, 16]
        var anchors = [[Float]]()
        let offset  = Float(0.5)

        for stride in strides {
            let fmW = (Self.inputSize + stride - 1) / stride
            let fmH = fmW
            for y in 0 ..< fmH {
                for x in 0 ..< fmW {
                    for _ in 0 ..< 2 {
                        anchors.append([
                            (Float(x) + offset) / Float(fmW),
                            (Float(y) + offset) / Float(fmH),
                            1, 1,
                        ])
                    }
                }
            }
        }
        return anchors
    }
}

// MARK: – Data extension helper
private extension Data {
    func toArray<T>(type: T.Type) -> [T] {
        withUnsafeBytes { Array($0.bindMemory(to: T.self)) }
    }
}
