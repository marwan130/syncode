export interface EditorGroupState {
  id: string;
  fileIds: string[];
  activeFileId: string;
  width: number;
}

export const INITIAL_EDITOR_GROUP: EditorGroupState = {
  id: 'group-1',
  fileIds: [],
  activeFileId: '',
  width: 100,
};

const MIN_EDITOR_GROUP_WIDTH = 12.5;

export function canSplitEditorGroup(group: EditorGroupState): boolean {
  return group.width >= MIN_EDITOR_GROUP_WIDTH * 2;
}

export function splitEditorGroup(
  groups: EditorGroupState[],
  groupId: string,
  newGroupId: string
): EditorGroupState[] {
  const index = groups.findIndex((group) => group.id === groupId);
  const target = groups[index];
  if (!target || !canSplitEditorGroup(target)) return groups;

  const width = target.width / 2;
  const next = groups.slice();
  next[index] = { ...target, width };
  next.splice(index + 1, 0, {
    id: newGroupId,
    fileIds: [],
    activeFileId: '',
    width,
  });
  return next;
}

export function openEditorGroupFile(
  groups: EditorGroupState[],
  groupId: string,
  fileId: string
): EditorGroupState[] {
  if (!groups.some((group) => group.id === groupId)) return groups;
  return groups.map((group) => {
    const fileIds =
      group.id === groupId
        ? group.fileIds.includes(fileId)
          ? group.fileIds
          : [...group.fileIds, fileId]
        : group.fileIds.filter((id) => id !== fileId);
    const activeFileId =
      group.id === groupId
        ? fileId
        : group.activeFileId === fileId
          ? (fileIds.at(-1) ?? '')
          : group.activeFileId;
    return { ...group, fileIds, activeFileId };
  });
}

export function closeEditorGroupFile(
  groups: EditorGroupState[],
  groupId: string,
  fileId: string
): EditorGroupState[] {
  return groups.map((group) => {
    if (group.id !== groupId) return group;
    const index = group.fileIds.indexOf(fileId);
    if (index < 0) return group;
    const fileIds = group.fileIds.filter((id) => id !== fileId);
    const activeFileId =
      group.activeFileId === fileId
        ? (fileIds[Math.min(index, fileIds.length - 1)] ?? '')
        : group.activeFileId;
    return { ...group, fileIds, activeFileId };
  });
}

export function pruneEditorGroupFiles(
  groups: EditorGroupState[],
  validFileIds: ReadonlySet<string>
): EditorGroupState[] {
  return groups.map((group) => {
    const fileIds = group.fileIds.filter((id) => validFileIds.has(id));
    const activeFileId = validFileIds.has(group.activeFileId)
      ? group.activeFileId
      : (fileIds.at(-1) ?? '');
    return { ...group, fileIds, activeFileId };
  });
}

export function removeEditorGroup(
  groups: EditorGroupState[],
  groupId: string
): { groups: EditorGroupState[]; activeGroupId: string } {
  if (groups.length <= 1) return { groups, activeGroupId: groups[0]?.id ?? '' };
  const index = groups.findIndex((group) => group.id === groupId);
  if (index < 0) return { groups, activeGroupId: groups[0]?.id ?? '' };

  const removed = groups[index];
  const targetIndex = index === 0 ? 1 : index - 1;
  const target = groups[targetIndex];
  const mergedFiles = [...target.fileIds];
  for (const fileId of removed.fileIds) {
    if (!mergedFiles.includes(fileId)) mergedFiles.push(fileId);
  }
  const next = groups.filter((group) => group.id !== groupId);
  const nextTargetIndex = next.findIndex((group) => group.id === target.id);
  next[nextTargetIndex] = {
    ...target,
    fileIds: mergedFiles,
    activeFileId: target.activeFileId || removed.activeFileId,
    width: target.width + removed.width,
  };
  return { groups: next, activeGroupId: target.id };
}

export function resizeEditorGroupBoundary(
  groups: EditorGroupState[],
  leftGroupId: string,
  deltaPercent: number
): EditorGroupState[] {
  const leftIndex = groups.findIndex((group) => group.id === leftGroupId);
  const left = groups[leftIndex];
  const right = groups[leftIndex + 1];
  if (!left || !right) return groups;

  const lowerBound = MIN_EDITOR_GROUP_WIDTH;
  const upperBound = left.width + right.width - lowerBound;
  const nextLeftWidth = Math.max(
    lowerBound,
    Math.min(upperBound, left.width + deltaPercent)
  );
  const next = groups.slice();
  next[leftIndex] = { ...left, width: nextLeftWidth };
  next[leftIndex + 1] = {
    ...right,
    width: left.width + right.width - nextLeftWidth,
  };
  return next;
}
