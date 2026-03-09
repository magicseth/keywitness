import Foundation
import AVFoundation
import UIKit
import ImageIO
import CryptoKit

/// Manages AVCaptureSession for photo capture. Captures at the lowest level
/// available (hardware-encoded JPEG from the ISP) and hashes the raw data
/// immediately in the capture callback, before any opportunity for tampering.
final class PhotoCaptureSession: NSObject {

    // MARK: - State

    let captureSession = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    private var currentDevice: AVCaptureDevice?
    private var captureCompletion: ((Result<PhotoCaptureResult, Error>) -> Void)?

    // MARK: - Permissions

    static func requestPermissions() async -> Bool {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .authorized { return true }
        return await AVCaptureDevice.requestAccess(for: .video)
    }

    // MARK: - Setup

    func configure() throws {
        captureSession.beginConfiguration()
        captureSession.sessionPreset = .photo

        // Use back wide camera
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            captureSession.commitConfiguration()
            throw PhotoCaptureError.noCameraAvailable
        }
        currentDevice = camera

        let input = try AVCaptureDeviceInput(device: camera)
        guard captureSession.canAddInput(input) else {
            captureSession.commitConfiguration()
            throw PhotoCaptureError.cannotAddInput
        }
        captureSession.addInput(input)

        guard captureSession.canAddOutput(photoOutput) else {
            captureSession.commitConfiguration()
            throw PhotoCaptureError.cannotAddOutput
        }
        captureSession.addOutput(photoOutput)

        captureSession.commitConfiguration()
        NSLog("[PhotoAttest] Capture session configured: camera=%@", camera.localizedName)
    }

    func start() {
        DispatchQueue.global(qos: .userInitiated).async {
            self.captureSession.startRunning()
        }
    }

    func stop() {
        captureSession.stopRunning()
    }

    // MARK: - Capture

    func capturePhoto(completion: @escaping (Result<PhotoCaptureResult, Error>) -> Void) {
        captureCompletion = completion

        let settings = AVCapturePhotoSettings(format: [
            AVVideoCodecKey: AVVideoCodecType.jpeg
        ])
        settings.flashMode = .off

        photoOutput.capturePhoto(with: settings, delegate: self)
    }
}

// MARK: - AVCapturePhotoCaptureDelegate

extension PhotoCaptureSession: AVCapturePhotoCaptureDelegate {

    func photoOutput(_ output: AVCapturePhotoOutput,
                     didFinishProcessingPhoto photo: AVCapturePhoto,
                     error: Error?) {
        if let error {
            captureCompletion?(.failure(error))
            captureCompletion = nil
            return
        }

        guard let imageData = photo.fileDataRepresentation() else {
            captureCompletion?(.failure(PhotoCaptureError.noImageData))
            captureCompletion = nil
            return
        }

        // Hash the raw image data IMMEDIATELY — this is the integrity anchor.
        let imageHash = CryptoEngine.sha256Base64URL(imageData)
        NSLog("[PhotoAttest] Captured: %d bytes, hash=%@", imageData.count, imageHash)

        // Extract EXIF metadata
        let exifMetadata = Self.extractEXIF(from: imageData)
        let exifHash: String
        if let exifJSON = try? JSONSerialization.data(withJSONObject: exifMetadata, options: [.sortedKeys]) {
            exifHash = CryptoEngine.sha256Base64URL(exifJSON)
        } else {
            exifHash = CryptoEngine.sha256Base64URL(Data("{}".utf8))
        }

        // Extract capture settings from resolved settings
        let captureSettings = CaptureSettings.from(
            resolvedSettings: photo.resolvedSettings,
            device: currentDevice
        )

        let width = Int(photo.resolvedSettings.photoDimensions.width)
        let height = Int(photo.resolvedSettings.photoDimensions.height)

        let result = PhotoCaptureResult(
            imageData: imageData,
            imageHash: imageHash,
            exifMetadata: exifMetadata,
            exifHash: exifHash,
            captureSettings: captureSettings,
            width: width,
            height: height,
            format: "jpeg"
        )

        NSLog("[PhotoAttest] Result: %dx%d, EXIF keys=%d, settings: exposure=%@, iso=%.0f",
              width, height, exifMetadata.count,
              captureSettings.exposureDuration, captureSettings.iso)

        captureCompletion?(.success(result))
        captureCompletion = nil
    }

    // MARK: - EXIF Extraction

    private static func extractEXIF(from imageData: Data) -> [String: Any] {
        guard let source = CGImageSourceCreateWithData(imageData as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any] else {
            return [:]
        }

        // Flatten relevant EXIF dictionaries into a single level
        var result: [String: Any] = [:]

        if let exif = properties[kCGImagePropertyExifDictionary as String] as? [String: Any] {
            result["exposureTime"] = exif[kCGImagePropertyExifExposureTime as String]
            result["fNumber"] = exif[kCGImagePropertyExifFNumber as String]
            result["iso"] = (exif[kCGImagePropertyExifISOSpeedRatings as String] as? [Int])?.first
            result["focalLength"] = exif[kCGImagePropertyExifFocalLength as String]
            result["focalLengthIn35mm"] = exif[kCGImagePropertyExifFocalLenIn35mmFilm as String]
            result["lensModel"] = exif[kCGImagePropertyExifLensModel as String]
            result["dateTimeOriginal"] = exif[kCGImagePropertyExifDateTimeOriginal as String]
        }

        if let tiff = properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any] {
            result["make"] = tiff[kCGImagePropertyTIFFMake as String]
            result["model"] = tiff[kCGImagePropertyTIFFModel as String]
            result["software"] = tiff[kCGImagePropertyTIFFSoftware as String]
        }

        if let gps = properties[kCGImagePropertyGPSDictionary as String] as? [String: Any] {
            result["gpsLatitude"] = gps[kCGImagePropertyGPSLatitude as String]
            result["gpsLatitudeRef"] = gps[kCGImagePropertyGPSLatitudeRef as String]
            result["gpsLongitude"] = gps[kCGImagePropertyGPSLongitude as String]
            result["gpsLongitudeRef"] = gps[kCGImagePropertyGPSLongitudeRef as String]
            result["gpsAltitude"] = gps[kCGImagePropertyGPSAltitude as String]
        }

        result["width"] = properties[kCGImagePropertyPixelWidth as String]
        result["height"] = properties[kCGImagePropertyPixelHeight as String]

        // Remove nil values
        return result.compactMapValues { $0 }
    }
}

// MARK: - Errors

enum PhotoCaptureError: Error, LocalizedError {
    case noCameraAvailable
    case cannotAddInput
    case cannotAddOutput
    case noImageData
    case permissionDenied

    var errorDescription: String? {
        switch self {
        case .noCameraAvailable: return "No camera available."
        case .cannotAddInput: return "Cannot configure camera input."
        case .cannotAddOutput: return "Cannot configure photo output."
        case .noImageData: return "No image data captured."
        case .permissionDenied: return "Camera permission denied."
        }
    }
}
