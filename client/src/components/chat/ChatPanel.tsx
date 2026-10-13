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
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || disabled || sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);
    setSendError('');
    try {
      await onSendMessage(content);
      setDraft('');
    } catch {
      setSendError('Message could not be sent. Wait a moment and try again.');
    } finally {
      sendingRef.current = false;
      setIsSending(false);
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
        <div className="chat-composer">
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
            rows={1}
          />
          <button
            type="submit"
            aria-label="Send message"
            title="Send message"
            disabled={disabled || isSending || !draft.trim()}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M2.5 9.1 17.2 2.7c.6-.3 1.2.3.9.9l-6.4 14.7c-.3.7-1.3.6-1.4-.2l-.9-5.7-5.7-.9c-.8-.1-.9-1.1-.2-1.4Zm7.5 1.2 5.2-5.2-6.5 4.3 1.3.9Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </form>
    </aside>
  );
}
