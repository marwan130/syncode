import type { OnMount } from '@monaco-editor/react';
import type { GithubChangeReviewTab } from '../../github/changeTracker';

export interface EditorGroupActions {
  onMountGroup: (
    groupId: string,
    editor: Parameters<OnMount>[0],
    monacoApi: Parameters<OnMount>[1]
  ) => void;
  onDisposeGroup: (groupId: string) => void;
  onOpenFile: (fileId: string, groupId?: string) => void;
  onOpenReviewTab: (tab: GithubChangeReviewTab, groupId?: string) => void;
  onCloseFileTab: (fileId: string, groupId: string) => void;
  onSplitWorkspace: (groupId: string) => void;
}
