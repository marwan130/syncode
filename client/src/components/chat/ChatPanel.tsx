import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CSSProperties } from 'react';
import type { ChatMessage as ChatMessageData } from '../../providers/SignalRCrdtProvider';
import { ChatMessage } from './ChatMessage';

interface ChatPanelProps {
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
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || disabled) return;
    setSendError('');
    try {
      await onSendMessage(content);
      setDraft('');
    } catch {
      setSendError('Message could not be sent. Wait a moment and try again.');
    }
  }

  return (
    <aside className="chat-panel" style={style} aria-label="Room chat">
      <h2>Chat</h2>
      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 ? (
          <p className="chat-empty">No messages yet.</p>
        ) : (
          messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <form className="chat-form" onSubmit={handleSubmit}>
        {sendError && (
          <p className="chat-error" role="alert">
            {sendError}
          </p>
        )}
        <textarea
          aria-label="Message"
          placeholder="Write a message…"
          value={draft}
          maxLength={2000}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2}
        />
        <button type="submit" disabled={disabled || !draft.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
