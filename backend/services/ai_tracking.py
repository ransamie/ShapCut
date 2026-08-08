import os
import subprocess
import logging
from services.video_editor import FFMPEG_CMD

logger = logging.getLogger("shapcut.ai_tracking")

def apply_ai_tracking(input_path: str, output_path: str, crf: int = 23) -> None:
    """
    High-Speed AI Auto-Framing using CV2 and MediaPipe Face Detection.
    1. Fast low-res analysis (3fps) to find face coordinates.
    2. Apply smoothing (convolution) for a cinematic camera pan.
    3. Fast high-res crop rendering via FFmpeg stdin.
    """
    try:
        import cv2
        import mediapipe as mp
        import numpy as np
    except ImportError:
        raise RuntimeError("Missing dependencies for AI tracking. Please pip install opencv-python mediapipe numpy")

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video for AI tracking: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if orig_h == 0 or orig_w == 0 or total_frames <= 0:
        cap.release()
        raise ValueError("Invalid video dimensions or empty video.")

    target_w = int(orig_h * 9 / 16)
    
    # 1. Temporal & Spatial Subsampling
    skip_frames = max(1, int(fps / 3))  # Analyze ~3 frames per second
    analysis_w = 320
    analysis_h = int(orig_h * (analysis_w / orig_w))

    mp_face_detection = mp.solutions.face_detection
    
    logger.info(f"Starting AI Tracking Analysis on {total_frames} frames...")

    # We will store the ideal center X coordinate for each frame
    centers = np.full(total_frames, orig_w / 2)
    last_center = orig_w / 2

    with mp_face_detection.FaceDetection(model_selection=0, min_detection_confidence=0.5) as face_detection:
        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            if frame_idx % skip_frames == 0:
                # Downscale for lightning fast inference
                small = cv2.resize(frame, (analysis_w, analysis_h))
                rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
                results = face_detection.process(rgb)
                
                if results.detections:
                    detection = results.detections[0]
                    bboxC = detection.location_data.relative_bounding_box
                    rel_center_x = bboxC.xmin + (bboxC.width / 2)
                    # Clamp
                    rel_center_x = max(0, min(1, rel_center_x))
                    last_center = rel_center_x * orig_w
                    
            centers[frame_idx] = last_center
            frame_idx += 1

    cap.release()

    # Apply moving average (convolution) to the camera path for cinematic smoothness
    # Window size: 1 second worth of frames
    window_size = max(3, int(fps))
    window = np.ones(window_size) / window_size
    smoothed_centers = np.convolve(centers, window, mode='same')
    
    # Fix convolution edge effects
    smoothed_centers[:window_size] = smoothed_centers[window_size]
    smoothed_centers[-window_size:] = smoothed_centers[-window_size-1]

    logger.info("Analysis complete. Starting fast render...")

    # 2. Fast Render via FFmpeg stdin
    cmd_out = [
        FFMPEG_CMD, "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{target_w}x{orig_h}",
        "-pix_fmt", "bgr24",
        "-r", str(fps),
        "-i", "-",          # Read raw frames from stdin
        "-i", input_path,   # Read original file for audio
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", str(crf),
        "-c:a", "aac",
        "-b:a", "128k",
        "-map", "0:v:0",
        "-map", "1:a:0?",
        "-shortest",
        output_path
    ]
    
    proc_out = subprocess.Popen(cmd_out, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    
    cap = cv2.VideoCapture(input_path)
    frame_idx = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        # Get smoothed center for this frame
        c_x = int(smoothed_centers[min(frame_idx, total_frames - 1)])
        
        # Calculate crop boundaries
        x1 = c_x - (target_w // 2)
        x2 = x1 + target_w
        
        # Clamp bounds to stay within image
        if x1 < 0:
            x1 = 0
            x2 = target_w
        elif x2 > orig_w:
            x2 = orig_w
            x1 = orig_w - target_w
            
        cropped = frame[:, x1:x2]
        
        try:
            proc_out.stdin.write(cropped.tobytes())
        except BrokenPipeError:
            break
            
        frame_idx += 1
        
    cap.release()
    proc_out.stdin.close()
    proc_out.wait()
    
    if proc_out.returncode != 0:
        raise RuntimeError(f"FFmpeg AI Tracking render failed with code {proc_out.returncode}")
