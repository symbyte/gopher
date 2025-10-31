# Changelog

All notable changes to Gopher will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2025-10-31

### Added
- Vim-style hjkl navigation support
- Fixed height log sections that maximize available vertical space
- Dynamic height calculation based on terminal size and expanded workflows

### Changed
- Log sections now take up their full allotted space
- Better space distribution among expanded workflows
- Removed console output from workflow sessions (all output to logs only)

### Fixed
- Dashboard now starts with completely clean screen
- No more workflow startup messages cluttering the display

## [1.2.0] - 2025-10-31

### Added
- Parallel workflow execution - all workflows now run simultaneously
- Screen clearing before dashboard display for immediate full-screen view

### Changed
- **BREAKING**: Workflows now run in parallel instead of sequentially
- Improved responsiveness - all workflows start immediately
- Better resource utilization with concurrent execution

### Fixed
- Fixed issue where second and subsequent workflows appeared stuck in PENDING
- Fixed dashboard not showing full-screen on launch

## [1.1.0] - 2025-10-31

### Added
- Automatic workspace detection (Yarn, pnpm, npm, NX)
- Support for Yarn workspaces via `yarn workspaces list --json`
- Support for pnpm workspaces via `pnpm list -r --depth -1 --json`
- Support for npm workspaces via `npm query .workspace`
- Fallback to manual package.json parsing for npm workspaces
- NX fallback for non-workspace projects

### Changed
- **BREAKING**: Projects are no longer hardcoded to NX
- Project detection is now automatic based on workspace type
- Improved error messages for workspace detection failures

## [1.0.0] - 2025-10-31

### Added
- Initial release of Gopher as a proper Deno module
- Interactive terminal UI with Ink and React
- Collapsible workflow rows for space optimization
- Keyboard navigation (arrow keys, space, E, C, Q)
- Real-time log streaming with color coding
- Workflow orchestration (type, build, test, lint)
- Project selection from NX workspace
- Persistent state management
- Module exports via mod.ts
- TypeScript type definitions
- Comprehensive README documentation
- Deno task configuration

### Technical
- Built with Deno 2.x
- Uses npm: specifiers for React 18 and Ink 4
- JSX support via @jsxImportSource pragma
- Auto node_modules directory management
- State directory: `.copilot-fix-state/`
