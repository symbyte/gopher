# Gopher

> Interactive terminal UI for running and monitoring NX project fix workflows

**Gopher** is a Deno-based tool that provides a rich interactive terminal interface for managing multiple development workflows (type checking, building, testing, linting) across NX projects. Built with React and Ink, it offers keyboard navigation and real-time log streaming.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Deno](https://img.shields.io/badge/Deno-2.x-black?logo=deno)

## Features

### 🎯 Core Capabilities
- **Multi-Workflow Support**: Run type checking, builds, tests, and linting simultaneously
- **Interactive TUI**: React-based terminal UI powered by Ink
- **Keyboard Navigation**: Full keyboard control with intuitive shortcuts
- **Live Log Streaming**: Real-time workflow output with color coding
- **Collapsible Views**: Expand/collapse workflows to manage screen space
- **Persistent State**: Remembers your workflow and project selections
- **Smart Project Detection**: Automatically detects projects from:
  - Yarn workspaces
  - pnpm workspaces
  - npm workspaces
  - NX projects (fallback)

### 🎨 User Experience
- **Color-Coded Output**: Visual feedback for errors, warnings, successes
- **Progress Tracking**: See completion status for each workflow
- **Selective Monitoring**: Focus on workflows that matter to you
- **Project Status Icons**: At-a-glance status for each project

## Installation

This is a Deno module. No installation required beyond having Deno installed.

```bash
# Ensure Deno is installed
deno --version
```

## Usage

### From Project Root (via npm script)

```bash
npm run gopher
# or
yarn gopher
```

### Direct Execution

```bash
deno task start
# or
./fix-all-interactive.tsx
```

### As a Module

```typescript
import { main } from "./tools/gopher/mod.ts";

await main();
```

## Keyboard Controls

| Key(s)            | Action                           |
|-------------------|----------------------------------|
| `↑` / `k`         | Navigate up                      |
| `↓` / `j`         | Navigate down                    |
| `Space` / `Enter` / `l` | Expand/toggle selected workflow |
| `h`               | Collapse selected workflow       |
| `E`               | Expand all workflows             |
| `C`               | Collapse all workflows           |
| `Q` / `Ctrl+C`    | Quit                             |

> **Vim users**: hjkl navigation is fully supported!

## Workflow Selection

On first run, you'll be prompted to select:

1. **Workflows**: Choose which tasks to run
   - Type checking
   - Build
   - Tests  
   - Linting

2. **Projects**: Select which projects to process
   - **Auto-detected** from your workspace configuration
   - Supports Yarn, pnpm, npm workspaces, and NX
   - Search and multi-select from all available projects

Your selections are saved and can be reused or changed on subsequent runs.

## Project Detection

Gopher automatically detects your workspace type and discovers projects:

1. **Yarn Workspaces**: Uses `yarn workspaces list --json`
2. **pnpm Workspaces**: Uses `pnpm list -r --depth -1 --json`
3. **npm Workspaces**: Uses `npm query .workspace` or parses package.json
4. **NX Projects**: Falls back to `nx show projects` if no workspace detected

The detection is automatic - no configuration needed!

## How It Works

### Architecture

```
┌─────────────────────────────────────────┐
│         Interactive Dashboard           │
│  (Ink + React Components)               │
├─────────────────────────────────────────┤
│  Workflow Orchestration                 │
│  - Background process execution         │
│  - Log file streaming                   │
│  - Progress tracking                    │
├─────────────────────────────────────────┤
│  State Management                       │
│  - Workflow/project selections          │
│  - Logs and progress                    │
└─────────────────────────────────────────┘
```

### State Persistence

All state is stored in `tools/gopher/.copilot-fix-state/`:

```
.copilot-fix-state/
├── selected-workflows.txt    # Saved workflow choices
├── selected-projects.txt     # Saved project selections
├── logs/                     # Workflow execution logs
│   ├── type.log
│   ├── build.log
│   ├── test.log
│   └── lint.log
└── progress/                 # Progress tracking files
    └── {workflow}-progress.json
```

> **Note**: This directory is git-ignored and stays local to your machine.

## Technology Stack

- **Runtime**: [Deno](https://deno.land/) 2.x
- **UI Framework**: [Ink](https://github.com/vadimdemedes/ink) 4.x (React for CLI)
- **Component Library**: [React](https://react.dev/) 18.x
- **Prompts**: [Cliffy](https://cliffy.io/)
- **Language**: TypeScript

## Module Structure

```
tools/gopher/
├── mod.ts                      # Module entry point
├── types.ts                    # TypeScript type definitions
├── fix-all-interactive.tsx     # Main application
├── deno.jsonc                  # Deno configuration
├── README.md                   # This file
└── INK_MIGRATION_SUMMARY.md    # Migration notes
```

## Configuration

### deno.jsonc

```jsonc
{
  "name": "@tools/gopher",
  "version": "1.0.0",
  "exports": "./mod.ts",
  "tasks": {
    "start": "deno run --allow-read --allow-write --allow-run --allow-env fix-all-interactive.tsx"
  },
  "imports": {
    "react": "npm:react@18",
    "ink": "npm:ink@4",
    "cliffy/": "https://deno.land/x/cliffy@v1.0.0-rc.4/"
  }
}
```

## Permissions Required

- `--allow-read`: Read project files and state
- `--allow-write`: Write logs and state files
- `--allow-run`: Execute NX commands
- `--allow-env`: Access environment variables

## Development

### Running Locally

```bash
cd tools/gopher
deno task start
```

### Type Checking

```bash
deno check fix-all-interactive.tsx
```

### Linting

```bash
deno lint
```

## Customization

### Workflow Instructions

Edit `WORKFLOW_INSTRUCTIONS` in `fix-all-interactive.tsx` to customize how each workflow behaves:

```typescript
const WORKFLOW_INSTRUCTIONS: Record<string, string> = {
  'test': 'Your custom test instructions...',
  'lint': 'Your custom lint instructions...',
  // ...
};
```

### Log Display

Adjust the number of log lines shown when expanded:

```typescript
setLogLines(lines.slice(-50)); // Show last 50 lines (default)
```

## Troubleshooting

### Dashboard rendering corrupted / garbled output

**Cause**: Console output interfering with Ink's terminal UI rendering.

**Prevention**: 
- Never use `console.log()` after dashboard starts rendering
- All workflow output goes to log files only
- Log files are automatically sanitized (ANSI codes stripped)

**Fix**:
```bash
# If dashboard is corrupted, quit (Q) and restart
# The tool will resume where it left off
```

**Technical Details**:
The dashboard uses Ink (React for terminal). Any output to stdout/stderr corrupts the rendering. The code includes:
- ANSI escape code stripping in `sanitizeLogLine()`
- Safe terminal width detection with fallbacks
- Defensive rendering with try-catch blocks
- Log files isolated from console output

See top of `fix-all-interactive.tsx` for complete dashboard protection documentation.

### "Could not find package" errors

```bash
# Clear Deno cache and reinstall
rm -rf tools/gopher/node_modules
deno cache --reload tools/gopher/fix-all-interactive.tsx
```

### State issues

```bash
# Reset state
rm -rf tools/gopher/.copilot-fix-state
```

## Contributing

This tool is part of the react-18-upgrade project tooling. Improvements and bug fixes are welcome.

## License

MIT

## Credits

Built with ❤️ using Deno and Ink for the react-18-upgrade project.

