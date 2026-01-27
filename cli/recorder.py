import argparse
import asyncio
import os
import signal
import sys
import wave
from datetime import datetime

import numpy as np
import requests
import sounddevice as sd
import whisper
from dotenv import load_dotenv

load_dotenv()

OLLAMA_API_URL = os.getenv("OLLAMA_API_URL", "http://localhost:11434")
OLLAMA_API_GENERATE_ENDPOINT = OLLAMA_API_URL + "/api/generate"
AVAILABLE_WHISPER_MODELS = whisper.available_models()

# sample rate will be 16 khz (it'll be resampled to 16khz regardless via ffmpeg)
# but i'll still define it for clarity. TODO: this could be configurable in the future.
# https://github.com/openai/whisper/discussions/870#discussioncomment-4743438
SAMPLE_RATE = 16000

# whisper expects mono audio data, but preprocess audio input to be mono just in case
# https://github.com/openai/whisper/blob/c0d2f624c09dc18e709e37c2ad90c039a4eb72a2/whisper/audio.py#L26-L59
CHANNELS = 1

# 16-bit PCM
SAMPLE_WIDTH_BYTES = 2

# Maximum amplitude for 16-bit PCM audio
INT16_MAX_AMPLITUDE = 32767


class AudioRecorder:
    """Handles audio recording from system input devices. TODO: fix typings for device fields"""

    def __init__(self, sample_rate: int = SAMPLE_RATE, channels: int = CHANNELS):
        self.sample_rate = sample_rate
        self.channels = channels
        self.recording = False
        self.audio_data = []

    def list_devices(self) -> list[dict]:
        """List all available audio input devices."""
        devices = sd.query_devices()
        input_devices = []
        for i, device in enumerate(devices):
            if device["max_input_channels"] > 0:
                input_devices.append(
                    {
                        "index": i,
                        "name": device["name"],
                        "channels": device["max_input_channels"],
                        "sample_rate": device["default_samplerate"],
                    }
                )
        return input_devices

    def _audio_callback(self, indata, frames, time, status):
        """Callback function for audio stream."""
        if status:
            print(f"Audio status: {status}", file=sys.stderr)
        if self.recording:
            self.audio_data.append(indata.copy())

    def start_recording(self, device_index: int | None = None):
        """Start recording audio from the specified device."""
        self.audio_data = []
        self.recording = True

        device_info = (
            sd.query_devices(device_index) if device_index is not None else None
        )
        if device_info:
            print(f"Recording from: {device_info['name']}")
        else:
            default_device = sd.query_devices(kind="input")
            print(f"Recording from default device: {default_device['name']}")

        self.stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=self.channels,
            callback=self._audio_callback,
            device=device_index,
        )
        self.stream.start()

    def stop_recording(self) -> np.ndarray:
        """Stop recording and return the audio data."""
        self.recording = False
        self.stream.stop()
        self.stream.close()

        if not self.audio_data:
            return np.array([])

        return np.concatenate(self.audio_data, axis=0)

    def save_to_wav(self, audio_data: np.ndarray, filename: str) -> str:
        """Save recorded audio data to a WAV file."""
        # prevent integer overflow via clip
        audio_data = np.clip(audio_data, -1.0, 1.0)

        # normalize and convert to 16-bit PCM
        audio_normalized = np.int16(audio_data * INT16_MAX_AMPLITUDE)

        with wave.open(filename, "wb") as wav_file:
            wav_file.setnchannels(self.channels)
            wav_file.setsampwidth(SAMPLE_WIDTH_BYTES)
            wav_file.setframerate(self.sample_rate)
            wav_file.writeframes(audio_normalized.tobytes())

        return filename


async def transcribe_audio(file_path: str, model_type: str) -> str:
    """Transcribes a single audio file using the local Whisper model."""
    print(f"Loading Whisper model '{model_type}' to transcribe audio...")

    model = whisper.load_model(model_type, download_root="./models/whisper/")
    result = model.transcribe(file_path, fp16=False)
    print("Transcription complete.")
    return result["text"]


async def summarize_text_with_ollama(
    text: str, participants: list[str] | None = None, model: str = "llama3"
) -> str:
    """Sends text to a local LLM via Ollama for summarization."""

    participants_str = (
        ", ".join(participants) if participants else "Unknown participants"
    )

    prompt = f"""
    You are a highly efficient and helpful assistant specializing in summarizing meeting transcripts.
    Please analyze the following raw text from a meeting and provide a structured summary. 
    Ignore filler words (e.g., 'um', 'ah', 'like'), repeated sentences, and conversational pleasantries. 
    Focus only on the substantive content. If no action items or decisions were made, explicitly state
    "No specific action items or decisions were recorded." 
    
    **IF** the transcript is empty, contains only filler words (e.g., 'um', 'ah'), or consists solely of conversational pleasantries with no substance:
        - Your **ENTIRE** output should be a single, specific statement: "This meeting concluded with no substantive discussion."

    **ELSE** (if the transcript contains substantive discussion):
        - Proceed as usual with the summarization.
    
    Participants in the meeting: {participants_str}
   
    The summary should include:
    1. A concise, one-paragraph overview of the meeting's purpose and key discussions.
    2. A bulleted list of the main topics discussed. Go into detail about each topic based on what was said.
    3. A bulleted list of any action items or decisions made.
    
    If nothing was discussed at all, state that clearly in the overview.

    Here is the transcript:
    ---
    {text}
    ---
    """

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
    }

    print(f"Sending transcript to Ollama ({model}) for summarization...")

    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(
        None,
        lambda: requests.post(OLLAMA_API_GENERATE_ENDPOINT, json=payload, timeout=300),
    )
    response.raise_for_status()

    response_data = response.json()
    summary = response_data.get("response", "Error: Could not get a summary.")
    print("Summarization complete.")
    return summary


def save_meeting_notes(content: str, output_dir: str = "notes") -> str:
    """Save meeting notes to a file."""
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"meeting_notes_{timestamp}.txt"
    filepath = os.path.join(output_dir, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

    return filepath


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Fly on the Wall - CLI Meeting Recorder",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="List available audio input devices and exit",
    )

    parser.add_argument(
        "--device",
        type=int,
        default=None,
        help="Audio input device index (use --list-devices to see available devices)",
    )

    parser.add_argument(
        "--whisper-model",
        type=str,
        default="base",
        help=f"Whisper model to use (available: {', '.join(AVAILABLE_WHISPER_MODELS)})",
    )

    parser.add_argument(
        "--ollama-model",
        type=str,
        default="llama3",
        help="Ollama model to use for summarization (default: llama3)",
    )

    parser.add_argument(
        "--no-summary",
        action="store_true",
        help="Skip LLM summarization and output raw transcription only",
    )

    parser.add_argument(
        "--participants",
        type=str,
        default=None,
        help="Comma-separated list of participant names for the meeting notes",
    )

    parser.add_argument(
        "--output-dir",
        type=str,
        default="notes",
        help="Directory to save meeting notes (default: notes/)",
    )

    parser.add_argument(
        "--keep-audio",
        action="store_true",
        help="Keep the recorded audio file after processing",
    )

    return parser.parse_args()


async def main():
    args = parse_args()
    recorder = AudioRecorder()

    if args.list_devices:
        print("\nAvailable audio input devices:")
        print("-" * 50)
        devices = recorder.list_devices()
        for device in devices:
            print(
                f"  [{device['index']}] {device['name']}"
                f" (channels: {device['channels']}, rate: {device['sample_rate']}Hz)"
            )
        print("-" * 50)
        print("\nUse --device <index> to select a specific device.")
        return

    whisper_model = args.whisper_model.lower()
    if whisper_model not in [m.lower() for m in AVAILABLE_WHISPER_MODELS]:
        print(
            f"Error: Invalid Whisper model '{args.whisper_model}'. "
            f"Available models: {', '.join(AVAILABLE_WHISPER_MODELS)}"
        )
        sys.exit(1)

    participants = None
    if args.participants:
        participants = [p.strip() for p in args.participants.split(",")]

    print("\n" + "=" * 50)
    print("  Fly on the Wall - Meeting Recorder")
    print("=" * 50)
    print(f"  Whisper model: {whisper_model}")
    print(f"  Ollama model: {args.ollama_model}")
    print(f"  Summarization: {'disabled' if args.no_summary else 'enabled'}")
    if participants:
        print(f"  Participants: {', '.join(participants)}")
    print("=" * 50 + "\n")

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def signal_handler():
        print("\n\nStopping recording...")
        stop_event.set()

    loop.add_signal_handler(signal.SIGINT, signal_handler)

    print("Press Ctrl+C to stop recording...\n")
    recorder.start_recording(device_index=args.device)

    await stop_event.wait()

    audio_data = recorder.stop_recording()

    if len(audio_data) == 0:
        print("No audio recorded. Exiting.")
        return

    duration = len(audio_data) / SAMPLE_RATE
    print(f"Recorded {duration:.1f} seconds of audio.")

    # Save audio data to a .wav file (TODO: audio file extension should be configurable in the future)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if args.keep_audio:
        recordings_dir = "recordings"
        os.makedirs(recordings_dir, exist_ok=True)
        audio_filename = os.path.join(recordings_dir, f"recording_{timestamp}.wav")
    else:
        audio_filename = f"recording_{timestamp}.wav"
    recorder.save_to_wav(audio_data, audio_filename)
    print(f"Audio saved to: {audio_filename}")

    print("\nTranscribing audio...")
    transcription = await transcribe_audio(audio_filename, whisper_model)

    if not transcription.strip():
        print("No speech detected in the recording.")
        if not args.keep_audio:
            os.remove(audio_filename)
        return

    print("\n--- Transcription ---")
    print(transcription)
    print("--- End Transcription ---\n")

    if args.no_summary:
        final_content = f"Meeting Transcription\n{'=' * 50}\n\n{transcription}"
    else:
        try:
            summary = await summarize_text_with_ollama(
                transcription, participants, args.ollama_model
            )
            final_content = (
                f"Meeting Summary\n{'=' * 50}\n\n{summary}\n\n"
                f"Raw Transcription\n{'=' * 50}\n\n{transcription}"
            )
        except Exception as e:
            print(f"Warning: Could not generate summary: {e}")
            print("Falling back to raw transcription.")
            final_content = f"Meeting Transcription\n{'=' * 50}\n\n{transcription}"

    notes_path = save_meeting_notes(final_content, args.output_dir)
    print(f"\nMeeting notes saved to: {notes_path}")

    if not args.keep_audio:
        os.remove(audio_filename)
        print("Temporary audio file removed.")
    else:
        print(f"Audio file kept at: {audio_filename}")

    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
