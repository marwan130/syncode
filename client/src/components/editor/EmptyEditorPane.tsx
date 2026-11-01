import type { FC } from 'react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import {
  EditorWelcomePane,
  type EditorWelcomeActions,
} from './EditorWelcomePane';
import { SplitEditorPane } from './SplitEditorPane';

export type { EditorWelcomeActions };

export interface EmptyEditorPaneProps {
  entries: RoomEntry[];
  group?: 'primary' | 'secondary' | string;
  onOpenFile: (fileId: string, group?: string) => void;
  welcome?: EditorWelcomeActions;
}

export const EmptyEditorPane: FC<EmptyEditorPaneProps> = ({
  entries,
  group = 'primary',
  onOpenFile,
  welcome,
}) => {
  if (group !== 'primary' && group !== 'group-1') {
    return (
      <SplitEditorPane
        entries={entries}
        group={group}
        onOpenFile={onOpenFile}
      />
    );
  }

  return <EditorWelcomePane welcome={welcome} />;
};
