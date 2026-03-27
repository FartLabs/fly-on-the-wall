# Fly on the Wall

An open-source, local-first AI tool for recording, transcribing, and summarizing meetings.

## Project Structure

This repository is organized into three primary components:

- **[desktop/](./desktop)**: The Electron-based desktop application (main entry point).
- **[server/](./server)**: The Go-based backend for cloud sync and optional features.
- **[cli/](./cli)**: A Python-based command-line interface for headless recording.

## Getting Started

To get started with the desktop application:

```bash
cd desktop
npm install
npm run start
```

For more detailed information on contributing and releasing, see [CONTRIBUTING.md](./CONTRIBUTING.md).
