import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalOutputChunk } from '../../hooks/useExecutionStream';

interface TerminalProps {
  chunks: TerminalOutputChunk[];
  message: string;
  jobId: string | null;
  isRunning: boolean;
  onClear: () => void;
  onClose: () => void;
}

export function Terminal({
  chunks,
  message,
  jobId,
  isRunning,
  onClear,
  onClose,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const styles = getComputedStyle(document.documentElement);
    const terminal = new XTerm({
      allowTransparency: false,
      convertEol: true,
      disableStdin: true,
      fontFamily: 'ui-monospace, Consolas, monospace',
      fontSize: 12,
      scrollback: 1000,
      theme: {
        background: styles.getPropertyValue('--app-bg').trim(),
        foreground: styles.getPropertyValue('--text').trim(),
        cursor: styles.getPropertyValue('--accent').trim(),
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    fit.fit();
    terminalRef.current = terminal;

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.reset();
    for (const chunk of chunks) {
      if (chunk.stream === 'stderr') terminal.write(`\x1b[31m${chunk.text}\x1b[0m`);
      else terminal.write(chunk.text);
    }
  }, [chunks]);

  return (
    <section className="execution-terminal" aria-label="Execution terminal">
      <header className="execution-terminal-header">
        <strong>TERMINAL</strong>
        <span className="execution-terminal-status" role="status">
          {message}
        </span>
        {jobId && <span className="execution-terminal-job">{jobId}</span>}
        <div>
          <button type="button" onClick={onClear} title="Clear terminal">
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close terminal"
            aria-label="Close terminal"
            disabled={isRunning}
          >
            ×
          </button>
        </div>
      </header>
      <div className="execution-terminal-output" ref={containerRef} />
    </section>
  );
}
