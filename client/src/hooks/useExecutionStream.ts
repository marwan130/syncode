import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {
  ConnectionStatus,
  ExecutionEvent,
  ExecutionLanguage,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';

export interface TerminalOutputChunk {
  stream: 'stdout' | 'stderr';
  text: string;
}

interface UseExecutionStreamProps {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
}

export function useExecutionStream({
  providerRef,
  status,
}: UseExecutionStreamProps) {
  const [chunks, setChunks] = useState<TerminalOutputChunk[]>([]);
  const [outputRevision, setOutputRevision] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState('Ready');
  const [jobId, setJobId] = useState<string | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;

    return provider.onExecutionEvent((event: ExecutionEvent) => {
      if (event.requestId !== activeRequestId.current) return;

      if (event.type === 'output' && event.text) {
        setChunks((current) => [
          ...current,
          {
            stream: event.stream === 'stderr' ? 'stderr' : 'stdout',
            text: event.text!,
          },
        ]);
        return;
      }

      runningRef.current = false;
      setIsRunning(false);
      if (event.type === 'failed') {
        setMessage('Execution failed.');
      } else {
        const result = event.timedOut
          ? 'Execution timed out.'
          : `Process exited with code ${event.exitCode ?? 0}.`;
        const outputLimit = event.outputLimitExceeded
          ? ' Output limit reached.'
          : '';
        setMessage(`${result}${outputLimit}`);
      }
    });
  }, [providerRef, status]);

  const runCode = useCallback(
    async (language: ExecutionLanguage, source: string) => {
      if (runningRef.current) return;
      const provider = providerRef.current;
      if (!provider || status !== 'connected') {
        setMessage('Connect to the room before running code.');
        return;
      }

      const requestId = crypto.randomUUID();
      activeRequestId.current = requestId;
      runningRef.current = true;
      setIsRunning(true);
      setChunks([]);
      setOutputRevision((revision) => revision + 1);
      setJobId(null);
      setMessage('Submitting…');

      try {
        const submission = await provider.runExecution(
          language,
          source,
          requestId
        );
        if (activeRequestId.current !== requestId || !runningRef.current)
          return;
        setJobId(submission.jobId);
        setMessage(
          submission.queuePosition > 1
            ? `Queued · position ${submission.queuePosition}`
            : 'Running…'
        );
      } catch (error) {
        if (activeRequestId.current !== requestId) return;
        runningRef.current = false;
        setIsRunning(false);
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not start code execution.'
        );
      }
    },
    [providerRef, status]
  );

  return { chunks, outputRevision, isRunning, message, jobId, runCode };
}
