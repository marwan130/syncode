import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalOutputChunk } from '../../hooks/useExecutionStream';
import type { SignalRCrdtProvider } from '../../providers/SignalRCrdtProvider';
import { userFacingError } from '../../utils/userFacingError';
import { consumeTerminalInput } from './terminalInput';
import type { TerminalTab } from './terminalTypes';

type TerminalOutputResult = Awaited<
  ReturnType<SignalRCrdtProvider['readTerminalOutput']>
>;

export interface TerminalViewProps {
  tab: TerminalTab;
  active: boolean;
  jobId: string | null;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  chunks: TerminalOutputChunk[];
  outputRevision: number;
}

export function TerminalView({
  tab,
  active,
  jobId,
  providerRef,
  chunks,
  outputRevision,
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const offsetRef = useRef(0);
  const chunkCount = useRef(0);
  const revision = useRef(outputRevision);

  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
      allowProposedApi: false,
      theme: readTerminalTheme(getComputedStyle(document.documentElement)),
      scrollback: 3000,
      allowTransparency: false,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    terminal.element
      ?.querySelector('.xterm-viewport')
      ?.classList.add('syncode-xterm-viewport');
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = readTerminalTheme(
        getComputedStyle(document.documentElement)
      );
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    terminalRef.current = terminal;
    fitRef.current = fit;
    const resize = new ResizeObserver(() => {
      if (hostRef.current?.offsetParent) fit.fit();
    });
    resize.observe(hostRef.current);
    return () => {
      themeObserver.disconnect();
      resize.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [tab.id, tab.kind]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !active || tab.kind !== 'bash' || !tab.sessionId) return;
    let stopped = false;
    let polling = false;
    let exited = false;
    const reportedWorkspaceMessages = new Set<string>();
    const poll = async () => {
      if (stopped || polling || exited) return;
      polling = true;
      try {
        exited = await pollBashOutput(
          providerRef.current,
          tab.sessionId!,
          offsetRef,
          terminal,
          reportedWorkspaceMessages
        );
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 300);
    void poll();
    let pendingInput = '';
    let inputTimer = 0;
    const flushInput = async () => {
      inputTimer = 0;
      const input = pendingInput;
      pendingInput = '';
      if (!input || !tab.sessionId) return;
      await sendBashInput(providerRef.current, tab.sessionId, input, terminal);
    };
    const input = terminal.onData((data) => {
      pendingInput += data;
      if (!inputTimer)
        inputTimer = window.setTimeout(() => void flushInput(), 20);
    });
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearTimeout(inputTimer);
      input.dispose();
    };
  }, [active, tab.kind, tab.sessionId, providerRef]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || tab.kind !== 'output') return;
    if (
      revision.current !== outputRevision ||
      chunks.length < chunkCount.current
    ) {
      terminal.reset();
      chunkCount.current = 0;
      revision.current = outputRevision;
    }
    for (const chunk of chunks.slice(chunkCount.current)) {
      terminal.write(
        chunk.stream === 'stderr' ? `\x1b[31m${chunk.text}\x1b[0m` : chunk.text
      );
      chunkCount.current++;
    }
  }, [chunks, outputRevision, tab.kind]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || tab.kind !== 'output' || !jobId || !active) return;
    let line = '';
    const sendLine = (value: string) =>
      void providerRef.current
        ?.writeExecutionInput(jobId, `${value}\n`)
        .catch((error: unknown) => {
          terminal.write(
            `\r\n${userFacingError(error, 'Input could not be sent.')}\r\n`
          );
        });
    const inputSubscription = terminal.onData((data) => {
      const update = consumeTerminalInput(data, line);
      line = update.line;
      if (update.echo) terminal.write(update.echo);
      update.submittedLines.forEach(sendLine);
    });
    return () => inputSubscription.dispose();
  }, [active, jobId, providerRef, tab.kind]);

  return (
    <div
      id={`terminal-panel-${tab.id}`}
      role="tabpanel"
      aria-labelledby={`terminal-tab-${tab.id}`}
      className="execution-terminal-output"
      ref={hostRef}
      hidden={!active}
      aria-label={tab.kind === 'bash' ? 'Bash terminal' : 'Program output'}
    />
  );
}

function readTerminalTheme(styles: CSSStyleDeclaration) {
  const get = (property: string, fallback = '') =>
    styles.getPropertyValue(property).trim() || fallback;
  return {
    background: get('--bg', '#101010'),
    foreground: get('--text', '#e5e5e5'),
    cursor: get('--text-h', '#f2f2f2'),
    selectionBackground: get('--accent-bg', '#414141'),
    scrollbarSliderBackground: get('--scrollbar-thumb'),
    scrollbarSliderHoverBackground: get('--scrollbar-thumb-hover'),
    scrollbarSliderActiveBackground: get('--scrollbar-thumb-active'),
  };
}

function writeBashOutput(terminal: XTerm, result: TerminalOutputResult) {
  if (!result) return false;
  if (result.text) terminal.write(result.text);
  if (!result.exited) return false;
  terminal.write(`\r\n[process exited ${result.exitCode ?? ''}]\r\n`);
  return true;
}

function writeConflictNotice(terminal: XTerm, conflicts: number | undefined, reportedMessages: Set<string>) {
  if (!conflicts || reportedMessages.has('conflict')) return;
  terminal.write('\r\nSome terminal changes conflict with newer shared edits and were not applied.\r\n');
  reportedMessages.add('conflict');
}

function writeUnsupportedNotice(terminal: XTerm, result: TerminalOutputResult, reportedMessages: Set<string>) {
  if (!result.unsupportedPaths.length || reportedMessages.has('unsupported')) return;
  terminal.write('\r\nSome generated, binary, oversized, or unsafe terminal files are not shared with the room.\r\n');
  reportedMessages.add('unsupported');
}

async function pollBashOutput(
  provider: SignalRCrdtProvider | null,
  sessionId: string,
  offsetRef: { current: number },
  terminal: XTerm,
  reportedMessages: Set<string>
): Promise<boolean> {
  try {
    const result = await provider?.readTerminalOutput(
      sessionId,
      offsetRef.current
    );
    if (!result) return false;
    offsetRef.current = result.offset;
    const conflicts = await provider?.syncTerminalWorkspace(
      result.changedEntries,
      result.deletedEntries
    );
    writeConflictNotice(terminal, conflicts, reportedMessages);
    writeUnsupportedNotice(terminal, result, reportedMessages);
    return writeBashOutput(terminal, result);
  } catch {
    return false;
  }
}

async function sendBashInput(
  provider: SignalRCrdtProvider | null,
  sessionId: string,
  input: string,
  terminal: XTerm
) {
  const chunkSize = 2048;
  for (let i = 0; i < input.length; i += chunkSize) {
    try {
      await provider?.writeTerminalInput(
        sessionId,
        input.slice(i, i + chunkSize)
      );
    } catch (error: unknown) {
      terminal.write(
        `\r\n${userFacingError(error, 'Terminal input could not be sent.')}\r\n`
      );
      break;
    }
  }
}
