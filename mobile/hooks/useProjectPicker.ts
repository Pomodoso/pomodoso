import { useState } from 'react';

type OnAssign = (projectId: string | null) => void;

/** Same request/pick/cancel pattern as useStatusPicker.ts/useStartPicker.ts:
 *  requestProject stashes which task (or "new task" via a null id) is being
 *  assigned, onAssign is called once a selection is made, then the picker
 *  closes. Spread `pickerProps` onto <ProjectPicker /> (still needs
 *  `projects`/`onCreate`/`onUpdate`/`onRemove` passed in directly). */
export function useProjectPicker(onAssign: OnAssign) {
  const [pending, setPending] = useState<{ selectedId: string | null } | null>(null);

  function requestProject(currentProjectId: string | null): void {
    setPending({ selectedId: currentProjectId });
  }

  function select(projectId: string | null): void {
    onAssign(projectId);
    setPending(null);
  }

  function cancel(): void {
    setPending(null);
  }

  return {
    requestProject,
    pickerProps: {
      visible: pending !== null,
      selectedId: pending?.selectedId ?? null,
      onSelect: select,
      onCancel: cancel,
    },
  };
}
