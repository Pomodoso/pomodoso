import { useState } from 'react';

import type { ProjectRow } from '@/db/schema';

import { useProjectPicker } from './useProjectPicker';
import { useProjects } from './useProjects';
import { useTasks } from './useTasks';
import { useWorkspace } from './useWorkspace';

// Everything the "new task" sheet needs, in one place, because two screens
// open it now: Tasks (into the backlog) and Home (into Today).
//
// Extracted rather than copied. The pieces here have to agree with each
// other — which workspace the task is filed into, which projects the picker
// may offer, which workspace a project created from that picker belongs to —
// and the last bug in this area came from exactly that rule living in two
// components and only being applied in one of them.

export function useAddTask({ intoToday = false }: { intoToday?: boolean } = {}) {
  const { addTask } = useTasks();
  const { projects, addProject, updateProject, removeProject } = useProjects();
  const { workspaceId, isAll, workspaces } = useWorkspace();

  const [visible, setVisible] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  // Seeded from the active workspace; under "All" that's the write fallback,
  // which the chips then let the user override before submitting.
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>(workspaceId);

  const { requestProject, pickerProps } = useProjectPicker(setProjectId);

  // The single definition of "projects available for the task being created",
  // read by both the sheet and the picker it opens.
  const scopedProjects = projects.filter(p => p.workspaceId === targetWorkspaceId);

  function open(): void {
    // Re-seed on open: the active workspace may have changed since last time.
    setTargetWorkspaceId(workspaceId);
    setVisible(true);
  }

  function close(): void {
    setVisible(false);
    setProjectId(null);
  }

  return {
    open,
    /** Spread onto <AddTaskModal />. */
    modalProps: {
      visible,
      projects: scopedProjects,
      selectedProjectId: projectId,
      // Only under "All workspaces" is there a choice to make; with one
      // active, the task belongs where the user is already looking.
      workspaces: isAll ? workspaces : ([] as typeof workspaces),
      workspaceId: targetWorkspaceId,
      onWorkspaceChange: (id: string) => {
        setTargetWorkspaceId(id);
        // A project belongs to one workspace, so it can't survive the move.
        setProjectId(null);
      },
      onRequestProject: () => requestProject(projectId),
      onSubmit: (title: string) => {
        addTask(title, projectId, targetWorkspaceId, intoToday);
        close();
      },
      onCancel: close,
    },
    /** Spread onto <ProjectPicker />, scoped to the same workspace. */
    projectPickerProps: {
      ...pickerProps,
      projects: scopedProjects,
      onCreate: (name: string, color: string): string => addProject(name, color, targetWorkspaceId),
      onUpdate: updateProject,
      onRemove: removeProject,
    } satisfies Record<string, unknown> & { projects: ProjectRow[] },
  };
}
