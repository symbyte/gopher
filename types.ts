/**
 * Type definitions for Gopher
 * @module
 */

export type WorkflowType = 'type' | 'build' | 'test' | 'lint';

export interface ProjectSelection {
  workflows: WorkflowType[];
  projects: string[];
}

export interface WorkflowProgress {
  current_project: string;
  current_task: number;
  completed_projects: string[];
}

export interface WorkflowRowProps {
  workflow: string;
  projects: string[];
  isSelected: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

export interface DashboardProps {
  workflows: string[];
  projects: string[];
}
