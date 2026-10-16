import type { FC } from 'react';
import { ChatPanel } from '../chat/ChatPanel';
import { ResizeHandle } from './ResizeHandle';
import { DEFAULT_CHAT_WIDTH, MIN_CHAT_WIDTH } from './editorLayoutStorage';
import type {
  ChatMessage,
  ConnectionStatus,
} from '../../providers/SignalRCrdtProvider';

interface ChatPanelContainerProps {
  isOpen: boolean;
  width: number;
  messages: ChatMessage[];
  status: ConnectionStatus;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onSendMessage: (content: string) => Promise<void>;
}

export const ChatPanelContainer: FC<ChatPanelContainerProps> = ({
  isOpen,
  width,
  messages,
  status,
  onWidthChange,
  onClose,
  onSendMessage,
}) => {
  if (!isOpen) return null;

  return (
    <>
      <ChatPanel
        messages={messages}
        onSendMessage={onSendMessage}
        disabled={status !== 'connected'}
        style={{ flexBasis: width }}
      />
      <ResizeHandle
        label="Resize chat panel"
        onResize={(delta) => {
          const next = width + delta;
          if (next < MIN_CHAT_WIDTH) {
            onClose();
            onWidthChange(DEFAULT_CHAT_WIDTH);
            return;
          }
          onWidthChange(Math.max(MIN_CHAT_WIDTH, Math.min(600, next)));
        }}
      />
    </>
  );
};
