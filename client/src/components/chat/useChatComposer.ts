import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { ChatMessage } from '../../providers/SignalRCrdtProvider';

export function useChatComposer(
  messages: ChatMessage[],
  onSendMessage: (content: string) => Promise<void>,
  disabled: boolean
) {
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleInputChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget;
    setDraft(textarea.value);
    resizeChatInput(textarea);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!canSubmitChatMessage(content, disabled, sendingRef.current)) return;
    await deliverChatMessage(content, onSendMessage, {
      sendingRef,
      setIsSending,
      setSendError,
      setDraft,
      textareaRef,
    });
  }

  return {
    draft,
    sendError,
    isSending,
    messagesEndRef,
    textareaRef,
    handleInputChange,
    handleSubmit,
  };
}

function resizeChatInput(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(150, Math.max(36, textarea.scrollHeight))}px`;
}

function canSubmitChatMessage(
  content: string,
  disabled: boolean,
  isSending: boolean
): boolean {
  return Boolean(content) && !disabled && !isSending;
}

async function deliverChatMessage(
  content: string,
  onSendMessage: (content: string) => Promise<void>,
  state: {
    sendingRef: { current: boolean };
    setIsSending: (isSending: boolean) => void;
    setSendError: (error: string) => void;
    setDraft: (draft: string) => void;
    textareaRef: { current: HTMLTextAreaElement | null };
  }
): Promise<void> {
  state.sendingRef.current = true;
  state.setIsSending(true);
  state.setSendError('');
  try {
    await onSendMessage(content);
    state.setDraft('');
    if (state.textareaRef.current) state.textareaRef.current.style.height = '36px';
  } catch {
    state.setSendError('Message could not be sent. Wait a moment and try again.');
  } finally {
    state.sendingRef.current = false;
    state.setIsSending(false);
  }
}
