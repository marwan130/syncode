import type { CSSProperties } from 'react';
import { IoSend } from 'react-icons/io5';
import type { ChatMessage as ChatMessageData } from '../../providers/SignalRCrdtProvider';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';
import { ChatMessage } from './ChatMessage';
import { useChatComposer } from './useChatComposer';

export interface ChatPanelProps {
  messages: ChatMessageData[];
  onSendMessage: (content: string) => Promise<void>;
  disabled?: boolean;
  style?: CSSProperties;
}

export function ChatPanel({
  messages,
  onSendMessage,
  disabled = false,
  style,
}: ChatPanelProps) {
  const {
    draft,
    sendError,
    isSending,
    messagesEndRef,
    textareaRef,
    handleInputChange,
    handleSubmit,
  } = useChatComposer(messages, onSendMessage, disabled);

  return (
    <aside className="chat-panel" style={style} aria-label="Room chat">
      <h2>Chat</h2>
      <ScrollbarPanel
        className="conversation-scroll-area chat-messages"
        aria-live="polite"
      >
        <ChatMessageList messages={messages} />
        <div ref={messagesEndRef} />
      </ScrollbarPanel>
      <form className="chat-form" onSubmit={handleSubmit}>
        <ChatSendError message={sendError} />
        <div className="chat-composer">
          <textarea
            ref={textareaRef}
            rows={1}
            aria-label="Message"
            placeholder="Write a message…"
            value={draft}
            maxLength={2000}
            disabled={disabled}
            onChange={handleInputChange}
            style={{ height: '36px' }}
            className="chat-message-input"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            className="chat-send-button"
            type="submit"
            aria-label="Send message"
            title="Send message"
            disabled={isChatSendDisabled(disabled, isSending, draft)}
          >
            <IoSend className="chat-send-icon" aria-hidden="true" />
          </button>
        </div>
      </form>
    </aside>
  );
}

function ChatMessageList({ messages }: { messages: ChatMessageData[] }) {
  if (messages.length === 0)
    return <p className="chat-empty">No messages yet.</p>;
  return messages.map((message) => (
    <ChatMessage key={message.id} message={message} />
  ));
}

function ChatSendError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="chat-error" role="alert">
      {message}
    </p>
  );
}

function isChatSendDisabled(
  disabled: boolean,
  isSending: boolean,
  draft: string
): boolean {
  return disabled || isSending || !draft.trim();
}
