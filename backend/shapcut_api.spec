# -*- mode: python ; coding: utf-8 -*-
import os
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_data_files

datas = []
binaries = []
hiddenimports = [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespans',
    'uvicorn.lifespans.on',
]

for pkg in ['faster_whisper', 'ctranslate2', 'onnxruntime']:
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as e:
        print(f"Warning collecting {pkg}: {e}")

# Guarantee silero_vad.onnx is bundled in exact relative structure
try:
    import faster_whisper
    fw_dir = Path(faster_whisper.__file__).parent
    vad_path = fw_dir / "assets" / "silero_vad.onnx"
    if vad_path.exists():
        datas.append((str(vad_path), "faster_whisper/assets"))
except Exception as e:
    print(f"Warning finding silero_vad: {e}")

# Bundle FFmpeg and FFprobe directly if available in backend/bin or APPDATA
for search_dir in [Path(SPECPATH) / "bin", Path(os.environ.get("APPDATA", "")) / "ShapCut" / "bin"]:
    for bin_name in ["ffmpeg.exe", "ffmpeg", "ffprobe.exe", "ffprobe"]:
        candidate = search_dir / bin_name
        if candidate.exists():
            datas.append((str(candidate), "."))

a = Analysis(
    [os.path.join(SPECPATH, 'main.py')],
    pathex=[SPECPATH],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torch', 'torchvision', 'torchaudio', 'matplotlib', 'scipy', 'pandas', 'IPython'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='shapcut_api',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='shapcut_api',
)
