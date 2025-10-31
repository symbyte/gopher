#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

/** @jsxImportSource npm:react@18 */
import React from "npm:react@18";
import { render, Box, Text, useInput, useApp } from "npm:ink@4";
import { useState, useEffect } from "npm:react@18";
import type { WorkflowProgress } from "./types.ts";

/**
 * IMPORTANT: Dashboard Rendering Protection
 *
 * The Ink-based dashboard is sensitive to console output. To prevent rendering issues:
 *
 * 1. NEVER use console.log/error/warn after the dashboard starts rendering
 * 2. NEVER write to stdout/stderr directly in workflow session code
 * 3. ALL workflow output must go only to log files, not console
 * 4. Log files are sanitized (ANSI codes stripped) before display
 * 5. Use status files for inter-process communication, not console
 *
 * The dashboard reads log files and displays them safely. Any output to the console
 * during dashboard rendering will corrupt the terminal UI.
 */

// Configuration
const STATE_DIR = "tools/gopher/.copilot-fix-state";
const WORKFLOWS_FILE = `${STATE_DIR}/selected-workflows.txt`;
const PROJECTS_FILE = `${STATE_DIR}/selected-projects.txt`;
const LOG_DIR = `${STATE_DIR}/logs`;
const PROGRESS_DIR = `${STATE_DIR}/progress`;

// Terminal dimensions
interface TerminalSize {
  rows: number;
  cols: number;
}

function getTerminalSize(): TerminalSize {
  try {
    return {
      rows: Deno.consoleSize().rows,
      cols: Deno.consoleSize().columns,
    };
  } catch {
    // Fallback to reasonable defaults
    return { rows: 40, cols: 120 };
  }
}

// Workflow definitions
const WORKFLOW_INSTRUCTIONS: Record<string, string> = {
  test: "TODO",
  lint: "You are a linting expert. PROCESS: 1) Run the lint command (e.g. 'npx nx lint <project>'), 2) Read all error output, 3) Fix ALL errors you can identify (unused imports, missing deps, etc), 4) Run lint again to verify. Work QUICKLY - don't ask questions, just fix the issues following the ESLint rules. Avoid disabling rules unless absolutely necessary.",
  type: "You are a TypeScript expert. PROCESS: 1) Run type check (e.g. 'npx nx type-check <project>' or 'tsc --noEmit'), 2) Read all error output, 3) Fix ALL type errors you can identify (add types, handle nulls, etc), 4) Run type check again to verify. Work QUICKLY - don't ask questions, just fix the issues. Avoid using 'any' or '@ts-ignore' unless absolutely necessary.",
  build:
    "You are a build expert. PROCESS: 1) Run build (e.g. 'npx nx build <project>'), 2) Read all error output carefully, 3) Fix ALL errors you find (missing imports/index files, wrong paths, missing deps), 4) Run build again to verify. Work QUICKLY and DIRECTLY - don't ask questions, just fix the issues. For import errors, find the correct file path or create missing index.js files. For missing dependencies, install them.",
};

const WORKFLOW_ACTIONS: Record<string, string> = {
  test: "fix the tests",
  lint: "fix all linting errors",
  type: "fix all TypeScript type errors",
  build: "fix all build errors",
};

const WORKFLOW_ORDER = ["type", "build", "test", "lint"];

// Create necessary directories
async function ensureDirectories() {
  await Deno.mkdir(STATE_DIR, { recursive: true });
  await Deno.mkdir(LOG_DIR, { recursive: true });
  await Deno.mkdir(PROGRESS_DIR, { recursive: true });
}

// Detect workspace type and get all projects
async function getAllProjects(): Promise<string[]> {
  // Check if we have yarn workspaces
  try {
    await Deno.stat("yarn.lock");
    return await getYarnWorkspaces();
  } catch {
    // Not yarn
  }

  // Check if we have pnpm workspaces
  try {
    await Deno.stat("pnpm-workspace.yaml");
    return await getPnpmWorkspaces();
  } catch {
    // Not pnpm
  }

  // Check if we have npm workspaces
  try {
    const pkgJson = JSON.parse(await Deno.readTextFile("package.json"));
    if (pkgJson.workspaces) {
      return await getNpmWorkspaces();
    }
  } catch {
    // Not npm workspaces
  }

  // Fallback: try NX if available
  try {
    return await getNxProjects();
  } catch {
    throw new Error(
      "Could not detect workspace type. Ensure you have npm/yarn/pnpm workspaces or NX configured.",
    );
  }
}

// Get projects from yarn workspaces
async function getYarnWorkspaces(): Promise<string[]> {
  const cmd = new Deno.Command("yarn", {
    args: ["workspaces", "list", "--json"],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });

  const output = await cmd.output();
  if (!output.success) {
    throw new Error("Failed to get yarn workspaces");
  }

  const text = new TextDecoder().decode(output.stdout);
  const workspaces = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        const json = JSON.parse(line);
        return json.name || json.location;
      } catch {
        return null;
      }
    })
    .filter((name): name is string => name !== null && name !== ".");

  return workspaces;
}

// Get projects from pnpm workspaces
async function getPnpmWorkspaces(): Promise<string[]> {
  const cmd = new Deno.Command("pnpm", {
    args: ["list", "-r", "--depth", "-1", "--json"],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });

  const output = await cmd.output();
  if (!output.success) {
    throw new Error("Failed to get pnpm workspaces");
  }

  const text = new TextDecoder().decode(output.stdout);
  const workspaces = JSON.parse(text);

  return workspaces
    .map((ws: any) => ws.name)
    .filter((name: string) => name && !name.startsWith("."));
}

// Get projects from npm workspaces
async function getNpmWorkspaces(): Promise<string[]> {
  const cmd = new Deno.Command("npm", {
    args: ["query", ".workspace"],
    stdout: "piped",
    stderr: "piped",
    cwd: Deno.cwd(),
  });

  const output = await cmd.output();
  if (!output.success) {
    // Fallback: parse package.json workspaces manually
    return await parseWorkspacesFromPackageJson();
  }

  const text = new TextDecoder().decode(output.stdout);
  const workspaces = JSON.parse(text);

  return workspaces.map((ws: any) => ws.name).filter((name: string) => name);
}

// Parse workspaces from package.json (fallback)
async function parseWorkspacesFromPackageJson(): Promise<string[]> {
  const pkgJson = JSON.parse(await Deno.readTextFile("package.json"));
  const workspacePatterns = Array.isArray(pkgJson.workspaces)
    ? pkgJson.workspaces
    : pkgJson.workspaces?.packages || [];

  const projects: string[] = [];

  for (const pattern of workspacePatterns) {
    // Handle glob patterns like "applications/tio/apps/*"
    if (pattern.includes("*")) {
      const basePath = pattern.replace("/*", "");
      try {
        for await (const entry of Deno.readDir(basePath)) {
          if (entry.isDirectory) {
            const pkgPath = `${basePath}/${entry.name}/package.json`;
            try {
              const pkg = JSON.parse(await Deno.readTextFile(pkgPath));
              if (pkg.name) {
                projects.push(pkg.name);
              }
            } catch {
              // No package.json or invalid
            }
          }
        }
      } catch {
        // Directory doesn't exist
      }
    } else {
      // Direct path like "babel-deps"
      try {
        const pkg = JSON.parse(
          await Deno.readTextFile(`${pattern}/package.json`),
        );
        if (pkg.name) {
          projects.push(pkg.name);
        }
      } catch {
        // No package.json or invalid
      }
    }
  }

  return projects;
}

// Get projects from NX (fallback)
async function getNxProjects(): Promise<string[]> {
  const cmd = new Deno.Command("npx", {
    args: ["nx", "show", "projects"],
    stdout: "piped",
    stderr: "piped",
  });

  const output = await cmd.output();
  if (!output.success) {
    throw new Error("Failed to get NX projects");
  }

  const text = new TextDecoder().decode(output.stdout);
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// Build TODO prompt for a workflow
function buildWorkflowTodo(workflow: string, projects: string[]): string {
  const workflowAction = WORKFLOW_ACTIONS[workflow];
  const instructions = WORKFLOW_INSTRUCTIONS[workflow];

  let todo = `You are a code quality automation expert. You have a structured TODO list to complete.

EXECUTION RULES:
1. Complete tasks in the EXACT order listed below
2. For each task, run the command, analyze output, and fix any issues found
3. After completing a task, mark it as DONE and move to the next
4. Report progress after completing each task
5. If a task passes with no errors, mark it DONE and proceed immediately
6. Work continuously without waiting for confirmation

PROGRESS TRACKING:
IMPORTANT - Before starting each task, create/update a progress file to help the dashboard track your work:
- Create: ${PROGRESS_DIR}/${workflow}-progress.json
- Format: {"current_project": "project-name", "current_task": N, "completed_projects": ["proj1", "proj2"]}
- Update this file BEFORE starting each new project
- Example: echo '{"current_project": "vulnerability-management", "current_task": 1, "completed_projects": []}' > ${PROGRESS_DIR}/${workflow}-progress.json
- When a project completes successfully, add it to completed_projects array
- This allows the dashboard to show real-time progress accurately

WORKFLOW: ${workflowAction}
Instructions: ${instructions}

TODO LIST:
`;

  projects.forEach((project, idx) => {
    todo += `  ${idx + 1}. ${workflowAction} in ${project}\n`;
  });

  todo += `
After completing ALL tasks above, create a summary report showing:
- Which projects had issues that were fixed
- Which projects passed all checks
- Any remaining issues that need manual attention
`;

  return todo;
}

// Check if a workflow was abandoned mid-run
async function wasWorkflowAbandoned(workflow: string): Promise<boolean> {
  const statusFile = `${LOG_DIR}/${workflow}.status`;
  try {
    const status = await Deno.readTextFile(statusFile);
    return status.trim() === "RUNNING";
  } catch {
    return false;
  }
}

// Synchronous version for UI components
function wasWorkflowAbandonedSync(workflow: string): boolean {
  const statusFile = `${LOG_DIR}/${workflow}.status`;
  try {
    const status = Deno.readTextFileSync(statusFile);
    return status.trim() === "RUNNING";
  } catch {
    return false;
  }
}

// Run a single workflow session
async function runWorkflowSession(
  workflow: string,
  projects: string[],
): Promise<boolean> {
  const logFile = `${LOG_DIR}/${workflow}.log`;
  const statusFile = `${LOG_DIR}/${workflow}.status`;
  const promptFile = `${LOG_DIR}/${workflow}.prompt`;

  // Check if we should resume
  const shouldResume = await wasWorkflowAbandoned(workflow);

  let copilotArgs: string[];

  if (shouldResume) {
    // Resume the previous conversation (don't log to stdout as it interferes with dashboard)
    copilotArgs = ["--resume", "--allow-all-tools", "--allow-all-paths"];
  } else {
    // Write status
    await Deno.writeTextFile(statusFile, "RUNNING");

    // Build and save prompt
    const prompt = buildWorkflowTodo(workflow, projects);
    await Deno.writeTextFile(promptFile, prompt);

    // Start fresh conversation
    copilotArgs = ["-p", prompt, "--allow-all-tools", "--allow-all-paths"];
  }

  // Run copilot and redirect output to log file
  const cmd = new Deno.Command("copilot", {
    args: copilotArgs,
    stdout: "piped",
    stderr: "piped",
  });

  const process = cmd.spawn();

  // Create file handle for writing (append if resuming, truncate if new)
  const logFileHandle = await Deno.open(logFile, {
    write: true,
    create: true,
    truncate: !shouldResume,
    append: shouldResume,
  });
  const encoder = new TextEncoder();

  // Add a resume marker to the log if resuming
  if (shouldResume) {
    const timestamp = new Date().toISOString();
    const marker = `\n\n${"=".repeat(80)}\nRESUMING WORKFLOW AT ${timestamp}\n${"=".repeat(80)}\n\n`;
    await logFileHandle.write(encoder.encode(marker));
  }

  try {
    // Read and write stdout and stderr manually
    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();

    const writeStdout = (async () => {
      try {
        while (true) {
          const { done, value } = await stdoutReader.read();
          if (done) break;
          await logFileHandle.write(value);
        }
      } catch (e) {
        // Stream closed
      }
    })();

    const writeStderr = (async () => {
      try {
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          await logFileHandle.write(value);
        }
      } catch (e) {
        // Stream closed
      }
    })();

    // Wait for both streams to complete and get process status
    await Promise.all([writeStdout, writeStderr]);
    const status = await process.status;

    if (status.success) {
      await Deno.writeTextFile(statusFile, "COMPLETED");
      return true;
    } else {
      await Deno.writeTextFile(statusFile, "FAILED");
      return false;
    }
  } finally {
    logFileHandle.close();
  }
}

// Run all workflows in parallel
async function runAllWorkflows(
  workflows: string[],
  projects: string[],
): Promise<void> {
  // Save original workflows for restoration
  const workflowsSnapshot = workflows.slice();

  // Order workflows correctly
  const orderedWorkflows = WORKFLOW_ORDER.filter((w) => workflows.includes(w));

  // Check for abandoned workflows and log to a status file instead of stdout
  const abandonedWorkflows: string[] = [];
  for (const workflow of orderedWorkflows) {
    if (await wasWorkflowAbandoned(workflow)) {
      abandonedWorkflows.push(workflow);
    }
  }

  if (abandonedWorkflows.length > 0) {
    const statusMsg = `Resuming abandoned workflows: ${abandonedWorkflows.join(", ")}\n`;
    await Deno.writeTextFile(`${STATE_DIR}/resume-status.txt`, statusMsg);
  }

  // Run all workflows in parallel
  const workflowPromises = orderedWorkflows.map((workflow) =>
    runWorkflowSession(workflow, projects),
  );

  // Wait for all to complete
  await Promise.all(workflowPromises);

  // Restore original workflows file
  await Deno.writeTextFile(WORKFLOWS_FILE, workflowsSnapshot.join("\n"));
}

// Dashboard rendering
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerIndex = 0;
let frameCounter = 0;

function getWorkflowProgress(workflow: string): WorkflowProgress | null {
  try {
    const content = Deno.readTextFileSync(
      `${PROGRESS_DIR}/${workflow}-progress.json`,
    );
    return JSON.parse(content) as WorkflowProgress;
  } catch {
    return null;
  }
}

function getProjectStatus(project: string, workflow: string): string {
  // Check progress file first
  const progress = getWorkflowProgress(workflow);
  if (progress) {
    if (progress.completed_projects.includes(project)) {
      return "✅ PASS";
    }
    if (progress.current_project === project) {
      return "🔄 RUNNING";
    }
  }

  // Fallback to log parsing
  try {
    const log = Deno.readTextFileSync(`${LOG_DIR}/${workflow}.log`);
    if (log.toLowerCase().includes(project.toLowerCase())) {
      if (log.match(new RegExp(`${project}.*(?:done|completed|pass)`, "i"))) {
        return "✅ PASS";
      }
      return "🔄 RUNNING";
    }
  } catch {
    // Log doesn't exist yet
  }

  return "⏸ PENDING";
}

// Strip ANSI codes and control characters from log lines
function sanitizeLogLine(line: string): string {
  // Remove ANSI escape codes
  let cleaned = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  // Remove other control characters except newline and tab
  cleaned = cleaned.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
  // Remove carriage returns
  cleaned = cleaned.replace(/\r/g, "");
  // Trim whitespace
  cleaned = cleaned.trim();
  return cleaned;
}

// Workflow Row Component
function WorkflowRow({
  workflow,
  projects,
  isSelected,
  isExpanded,
  logHeight,
  onToggle,
}: any) {
  const [logLines, setLogLines] = useState<string[]>([]);
  const [isResumed, setIsResumed] = useState(false);

  useEffect(() => {
    // Check if this workflow was resumed (using sync version to avoid blocking)
    const resumed = wasWorkflowAbandonedSync(workflow);
    setIsResumed(resumed);
  }, [workflow]);

  useEffect(() => {
    if (!isExpanded) return;

    const interval = setInterval(() => {
      try {
        const log = Deno.readTextFileSync(`${LOG_DIR}/${workflow}.log`);
        const lines = log
          .split("\n")
          .map(sanitizeLogLine)
          .filter((l: string) => l.length > 0);
        // Show exactly the number of lines that will fit
        const linesToShow = Math.max(1, logHeight - 2); // -2 for project line and padding
        setLogLines(lines.slice(-linesToShow));
      } catch (err) {
        // Log file doesn't exist yet or can't be read - this is fine
        setLogLines([]);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [workflow, isExpanded, logHeight]);

  let status = "PENDING";
  try {
    status = Deno.readTextFileSync(`${LOG_DIR}/${workflow}.status`).trim();
  } catch {
    // Status file doesn't exist yet
  }

  const statusIcon =
    status === "RUNNING"
      ? "🔄"
      : status === "COMPLETED"
        ? "✅"
        : status === "FAILED"
          ? "❌"
          : "⏸";

  const expandIcon = isExpanded ? "▼" : "▶";
  const selectionMarker = isSelected ? "→" : " ";
  const resumeMarker = isResumed && status === "RUNNING" ? " [RESUMED]" : "";

  // Get project statuses
  const projectIcons = projects
    .map((project: string) => {
      const taskStatus = getProjectStatus(project, workflow);
      return taskStatus === "✅ PASS"
        ? "✅"
        : taskStatus === "🔄 RUNNING"
          ? "🔄"
          : taskStatus === "❌ ERRORS"
            ? "❌"
            : "⏸";
    })
    .join(" ");

  return (
    <Box
      flexDirection="column"
      borderStyle={isSelected ? "round" : "single"}
      borderColor={isSelected ? "cyan" : "gray"}
      paddingX={1}
    >
      <Box>
        <Text bold color={isSelected ? "cyan" : undefined}>
          {selectionMarker} {expandIcon} {statusIcon} {workflow.toUpperCase()} [
          {status}]{resumeMarker}
        </Text>
      </Box>
      {!isExpanded && (
        <Box>
          <Text dimColor>{projectIcons}</Text>
        </Box>
      )}
      {isExpanded && (
        <Box flexDirection="column" height={logHeight}>
          <Box>
            <Text dimColor>Projects: {projectIcons}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {logLines.length === 0 ? (
              <Text dimColor>Waiting for output...</Text>
            ) : (
              logLines.map((line: string, idx: number) => {
                try {
                  const isRecent = idx >= logLines.length - 15;
                  let color = isRecent ? undefined : "gray";

                  if (line.match(/error|fail|✗/i)) color = "red";
                  else if (line.match(/success|pass|✓|done|completed/i))
                    color = "green";
                  else if (line.match(/warning|warn/i)) color = "yellow";
                  else if (line.match(/running|starting|processing/i))
                    color = "cyan";

                  // Safely get terminal width, default to reasonable value
                  const termWidth =
                    typeof process !== "undefined" && process.stdout?.columns
                      ? process.stdout.columns
                      : 120;

                  // Truncate line to fit terminal, with safety margin
                  const maxLineLength = Math.max(40, termWidth - 8);
                  const displayLine =
                    line.length > maxLineLength
                      ? line.substring(0, maxLineLength - 3) + "..."
                      : line;

                  return (
                    <Text key={idx} color={color} dimColor={!isRecent}>
                      {displayLine}
                    </Text>
                  );
                } catch (err) {
                  // If any line fails to render, show error indicator instead of crashing
                  return (
                    <Text key={idx} color="red" dimColor>
                      [Invalid log line]
                    </Text>
                  );
                }
              })
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// Main Dashboard Component
function Dashboard({
  workflows,
  projects,
}: {
  workflows: string[];
  projects: string[];
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedSet, setExpandedSet] = useState(new Set<string>());
  const { exit } = useApp();

  const orderedWorkflows = WORKFLOW_ORDER.filter((w: string) =>
    workflows.includes(w),
  );

  // Calculate available height for logs
  // Terminal height - header (3 lines) - footer (3 lines) - workflow headers
  const terminalHeight = process.stdout.rows || 40;
  const headerHeight = 3;
  const footerHeight = 3;
  const workflowHeaderHeight = 4; // Border + title + projects + border

  const expandedCount = expandedSet.size;
  const collapsedCount = orderedWorkflows.length - expandedCount;

  const availableHeight =
    terminalHeight -
    headerHeight -
    footerHeight -
    expandedCount * workflowHeaderHeight -
    collapsedCount * workflowHeaderHeight;

  // Divide available space equally among expanded workflows
  const logHeightPerWorkflow =
    expandedCount > 0 ? Math.floor(availableHeight / expandedCount) : 0;

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
    } else if (key.upArrow || input === "k") {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex(
        Math.min(orderedWorkflows.length - 1, selectedIndex + 1),
      );
    } else if (input === " " || key.return || input === "l") {
      const workflow = orderedWorkflows[selectedIndex];
      setExpandedSet((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(workflow)) {
          newSet.delete(workflow);
        } else {
          newSet.add(workflow);
        }
        return newSet;
      });
    } else if (input === "h") {
      // Collapse selected
      const workflow = orderedWorkflows[selectedIndex];
      setExpandedSet((prev) => {
        const newSet = new Set(prev);
        newSet.delete(workflow);
        return newSet;
      });
    } else if (input === "e") {
      // Expand all
      setExpandedSet(new Set(orderedWorkflows));
    } else if (input === "c") {
      // Collapse all
      setExpandedSet(new Set());
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box
        borderStyle="double"
        borderColor="cyan"
        justifyContent="center"
        paddingX={2}
      >
        <Text bold>
          COPILOT {workflows.join("/").toUpperCase()} FIXING DASHBOARD
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {orderedWorkflows.map((workflow: string, idx: number) => (
          <WorkflowRow
            key={workflow}
            workflow={workflow}
            projects={projects}
            isSelected={idx === selectedIndex}
            isExpanded={expandedSet.has(workflow)}
            logHeight={expandedSet.has(workflow) ? logHeightPerWorkflow : 0}
            onToggle={() => {}}
          />
        ))}
      </Box>

      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          ↑/↓/k/j: Navigate | Space/Enter/l: Expand | h: Collapse | E: Expand
          All | C: Collapse All | Q: Quit
        </Text>
      </Box>
    </Box>
  );
}

// Main function
export async function main() {
  // Clear console immediately for clean start
  console.clear();

  await ensureDirectories();

  // Import Select and Checkbox from cliffy for initial selection
  const { Select, Checkbox } = await import(
    "https://deno.land/x/cliffy@v1.0.0-rc.4/prompt/mod.ts"
  );

  console.log("=".repeat(60));
  console.log("  COPILOT INTERACTIVE FIX TOOL");
  console.log("=".repeat(60));
  console.log("");

  // Select workflows (using cliffy for prompts)
  const workflows = await selectWorkflowsWithCliffy();
  console.log(`Selected workflows: ${workflows.join(", ")}`);
  console.log("");

  // Get and select projects
  console.log("Loading projects...");
  const allProjects = await getAllProjects();
  const projects = await selectProjectsWithCliffy(allProjects);
  console.log(`Selected ${projects.length} project(s)`);
  console.log("");

  // Check for abandoned workflows before starting
  const orderedWorkflows = WORKFLOW_ORDER.filter((w) => workflows.includes(w));
  const abandonedWorkflows: string[] = [];
  for (const workflow of orderedWorkflows) {
    if (await wasWorkflowAbandoned(workflow)) {
      abandonedWorkflows.push(workflow);
    }
  }

  if (abandonedWorkflows.length > 0) {
    console.log("🔄 Detected abandoned workflows that will be resumed:");
    abandonedWorkflows.forEach((w) => console.log(`   - ${w}`));
    console.log("");
  }

  console.log("Starting workflows...");
  console.log("");

  // Give a moment for the user to read the message
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Clear screen again before showing dashboard for full-screen view
  console.clear();

  // Start workflows in background (all running in parallel)
  const workflowPromise = runAllWorkflows(workflows, projects);

  // Render Ink UI
  const { waitUntilExit } = render(
    React.createElement(Dashboard, { workflows, projects }),
  );

  // Wait for either workflows to complete or user to quit
  await Promise.race([workflowPromise, waitUntilExit()]);

  // Show final results
  console.log("");
  console.log("═".repeat(60));
  console.log("                    SESSION COMPLETE");
  console.log("═".repeat(60));
  console.log("");
  console.log("✅ All workflows completed");
  console.log("");
  console.log("View workflow logs:");
  for (const workflow of workflows) {
    console.log(`  - ${workflow}: ${LOG_DIR}/${workflow}.log`);
  }
  console.log("");
}

// Helper functions for cliffy prompts
async function selectWorkflowsWithCliffy(): Promise<string[]> {
  const { Select, Checkbox } = await import(
    "https://deno.land/x/cliffy@v1.0.0-rc.4/prompt/mod.ts"
  );

  // Check for previous selection
  try {
    const previous = await Deno.readTextFile(WORKFLOWS_FILE);
    const previousList = previous
      .split("\n")
      .filter((l) => l.trim())
      .join(", ");

    console.log("Previously selected workflows:", previousList);
    console.log("");

    const keepChoice = await Select.prompt({
      message: "Keep these selections?",
      options: [
        { name: "Yes, keep them", value: "keep" },
        { name: "Reselect", value: "reselect" },
        { name: "Exit", value: "exit" },
      ],
    });

    if (keepChoice === "exit") {
      Deno.exit(0);
    }

    if (keepChoice === "keep") {
      return previous.split("\n").filter((l) => l.trim());
    }
  } catch {
    // No previous selection
  }

  const selected = await Checkbox.prompt({
    message: "Select workflows to run",
    options: [
      { name: "Type checking", value: "type" },
      { name: "Build", value: "build" },
      { name: "Tests", value: "test" },
      { name: "Linting", value: "lint" },
    ],
  });

  if (selected.length === 0) {
    console.log("No workflows selected. Exiting.");
    Deno.exit(0);
  }

  await Deno.writeTextFile(WORKFLOWS_FILE, selected.join("\n"));
  return selected;
}

async function selectProjectsWithCliffy(
  allProjects: string[],
): Promise<string[]> {
  const { Select, Checkbox } = await import(
    "https://deno.land/x/cliffy@v1.0.0-rc.4/prompt/mod.ts"
  );

  // Check for previous selection
  try {
    const previous = await Deno.readTextFile(PROJECTS_FILE);
    const previousList = previous.split("\n").filter((l) => l.trim());
    const count = previousList.length;

    console.log(`Previously selected projects (${count}):`);
    previousList.slice(0, 10).forEach((p) => console.log(`  ${p}`));
    if (count > 10) {
      console.log(`  ... and ${count - 10} more`);
    }
    console.log("");

    const keepChoice = await Select.prompt({
      message: "Keep these selections?",
      options: [
        { name: "Yes, keep them", value: "keep" },
        { name: "Reselect", value: "reselect" },
        { name: "Exit", value: "exit" },
      ],
    });

    if (keepChoice === "exit") {
      Deno.exit(0);
    }

    if (keepChoice === "keep") {
      return previousList;
    }
  } catch {
    // No previous selection
  }

  const selected = await Checkbox.prompt({
    message: `Select projects to fix (${allProjects.length} total)`,
    options: allProjects.map((p) => ({ name: p, value: p })),
    search: true,
  });

  if (selected.length === 0) {
    console.log("No projects selected. Exiting.");
    Deno.exit(0);
  }

  await Deno.writeTextFile(PROJECTS_FILE, selected.join("\n"));
  return selected;
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err);
    Deno.exit(1);
  });
}
