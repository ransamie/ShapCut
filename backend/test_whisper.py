import sys
import logging
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO)

print("Initializing WhisperModel...")
try:
    model = WhisperModel('base', device='cpu', compute_type='int8')
    print("Successfully initialized!")
except Exception as e:
    print(f"Error: {e}")
