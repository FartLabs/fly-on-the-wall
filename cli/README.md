# Fly on the Wall (name is subject to change)

A flexible CLI tool that records meetings from your computer's audio, transcribes speech using Whisper, and generates summaries using a LLM via Ollama. The tool emphasizes the local-first approach with AI.

This records and summarizes meetings at FartLabs, allowing participants to focus on contributing to discussions without wasting mental effort to take effective meeting notes.

## Demo

TBA

## Quick Start

>NOTE: "uv run" can be substituted for "python" in case you do not want to use uv for package management. 

```sh
# List available audio devices
uv run recorder.py --list-devices

# Start recording (press Ctrl+C to stop)
uv run recorder.py

# Record from a specific device
uv run recorder.py --device 2
```

## Commands & Options

| Option | Description |
|--------|-------------|
| `--list-devices` | List available audio input devices |
| `--device <index>` | Specify audio input device by index |
| `--whisper-model <model>` | Whisper model to use (tiny, base, small, medium, large) |
| `--ollama-model <model>` | Ollama model for summarization (default: llama3) |
| `--no-summary` | Skip LLM summarization, output raw transcription only |
| `--participants "A,B,C"` | Comma-separated list of participant names |
| `--output-dir <dir>` | Directory to save meeting notes (default: notes) |
| `--keep-audio` | Keep the recorded audio file after processing |

## Examples

```sh
# Use a more accurate Whisper model
uv run recorder.py --whisper-model medium

# Skip summarization (transcription only)
python run recorder.py --no-summary

# Specify participants for better meeting notes
python run recorder.py --participants "Alice,Bob,Charlie"

# Keep the audio file for reference
python run recorder.py --keep-audio

# Use a different Ollama model
python run recorder.py --ollama-model mistral
```

## Technology

This takes the local-first approach for using AI.

1. **sounddevice** for capturing system audio
2. **OpenAI's Whisper** model for transcribing speech to text
3. **llama3 via Ollama** for summarizing the text

## TODO 

- [ ] Add pause/resume functionality
- [ ] Support for system audio loopback (capture all audio, not just mic)
- [ ] Better speaker diarization
- [ ] Support multiple languages
- [ ] Real-time transcription mode
- [ ] Export to different formats (markdown, PDF)

## Set up Development

### Prerequisites

Set up the technologies below:

1. [Python 3.12+](https://www.python.org/downloads/)
2. [uv](https://docs.astral.sh/uv/getting-started/installation/)
3. [ffmpeg](https://ffmpeg.org/download.html)
4. [Ollama](https://ollama.com/download)

### Setup

After setting up prerequisites, check if Ollama is running at `http://localhost:11434`.

Once it is running, install llama3 (or any LLM of your choice):

```sh
ollama pull llama3 
```

Then, clone this repository.

Create a `.env` based on `.env.example` using your settings (optional):

```sh
# .env
OLLAMA_API_URL=http://localhost:11434
```

Finally, run the recorder:

```sh
uv run recorder.py
```

### Tools

Run the below to format code with [ruff](https://docs.astral.sh/ruff/):

```sh
uv run ruff format .
```
