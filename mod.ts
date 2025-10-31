/**
 * Gopher - Interactive Fix Tool
 * 
 * A terminal UI for running and monitoring multiple fix workflows
 * (type checking, building, testing, linting) across multiple NX projects.
 * 
 * @module
 */

export { main } from "./fix-all-interactive.tsx";

// Re-export for programmatic usage if needed
export type { WorkflowType, ProjectSelection } from "./types.ts";
