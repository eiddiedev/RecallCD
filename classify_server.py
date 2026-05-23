"""B-SIDE Music Genre Classifier — FastAPI backend."""

import os
import subprocess
import tempfile
import shutil
from pathlib import Path

import static_ffmpeg
static_ffmpeg.add_paths()

import librosa
import torch
import numpy as np
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from transformers import pipeline

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MODEL_ID = "dima806/music_genres_classification"

# GTZAN 10 类 → 目标 6 类映射
GTZAN_TO_6 = {
    "jazz":      "Jazz",
    "hiphop":    "HipHop",
    "rock":      "Folk",
    "metal":     "Folk",
    "blues":     "Jazz",
    "disco":     "Electronic",
    "classical": "Classical",
    "pop":       "Pop",
    "reggae":    "HipHop",
    "country":   "Folk",
}

# ---------- model loading (lazy) ----------
_pipe = None

def get_pipe():
    global _pipe
    if _pipe is None:
        print(f"Loading model {MODEL_ID} …")
        _pipe = pipeline("audio-classification", model=MODEL_ID, device=-1)
        print("Model loaded.")
    return _pipe

# ---------- helpers ----------

def extract_audio(src: str, dst: str) -> str:
    """Extract audio from video file using ffmpeg."""
    cmd = [
        "ffmpeg", "-y", "-i", src,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", dst
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    return dst


def load_and_trim(audio_path: str, sr: int = 16000, duration: int = 30) -> np.ndarray:
    """Load audio and take the middle `duration` seconds."""
    y, _ = librosa.load(audio_path, sr=sr, mono=True)
    total = len(y)
    needed = sr * duration
    if total <= needed:
        return y
    start = (total - needed) // 2
    return y[start:start + needed]


def map_to_6(raw_results: list) -> dict:
    """Map 10-class GTZAN output to 6 target genres."""
    scores = {}
    for item in raw_results:
        label = item["label"].lower()
        prob = item["score"]
        genre6 = GTZAN_TO_6.get(label)
        if genre6:
            scores[genre6] = scores.get(genre6, 0.0) + prob

    sorted_genres = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    top1 = sorted_genres[0]
    top3 = [{"genre": g, "confidence": round(s * 100, 1)} for g, s in sorted_genres[:3]]

    return {
        "genre": top1[0],
        "confidence": round(top1[1] * 100, 1),
        "top3": top3,
    }

# ---------- endpoint ----------

@app.post("/api/classify")
async def classify(file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix.lower()
    video_exts = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

    with tempfile.TemporaryDirectory() as tmpdir:
        src_path = os.path.join(tmpdir, f"upload{suffix}")
        with open(src_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        if suffix in video_exts:
            audio_path = os.path.join(tmpdir, "audio.wav")
            extract_audio(src_path, audio_path)
        else:
            audio_path = src_path

        waveform = load_and_trim(audio_path, sr=16000, duration=30)

        pipe = get_pipe()
        raw = pipe(waveform, top_k=10)

        return map_to_6(raw)

# ---------- run ----------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5050)
