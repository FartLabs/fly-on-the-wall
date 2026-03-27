# Contributing to Fly on the Wall

Thank you for your interest in contributing! This document outlines the process for development and releases.

## Development Workflow

### Formatting and Linting
We use Prettier for formatting and ESLint/Stylelint for code quality.

```bash
# Check formatting
npm run fmt:check

# Apply formatting
npm run fmt

# Run linting (Desktop)
npm run lint
```

### Building Locally (Desktop)
To test the packaging process locally on Windows:

```bash
npm run make
```

## Releasing

The release process is automated via GitHub Actions (`release.yml`). 

### How to Trigger a Release

There are two primary ways to initiate a release:

1.  **Pushing a Version Tag**:
    Submit and push a new version tag (e.g., `v1.0.1`). This will trigger a full build and publish to GitHub Releases.
    ```bash
    git tag v1.0.1
    git push origin v1.0.1
    ```

2.  **Manual Trigger (Workflow Dispatch)**:
    You can manually trigger the "Release" workflow from the GitHub Actions tab or via the GitHub CLI:
    ```bash
    gh workflow run release.yml
    ```

### Release Artifacts
The workflow builds distributables for:
- **Windows**: x64 (Squirrel & ZIP)
- **Linux**: x64 (deb, rpm, & ZIP)
- **macOS**: x64 & arm64 (DMG & ZIP)
