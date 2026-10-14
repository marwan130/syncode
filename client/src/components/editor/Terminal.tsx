import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalOutputChunk } from '../../hooks/useExecutionStream';
import type {
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';

interface TerminalProps {
  chunks: TerminalOutputChunk[];
  outputRevision: number;
  message: string;
  jobId: string | null;
  isRunning: boolean;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  newTerminalRequest: number;
  startBashOnMount: boolean;
  onClose: () => void;
  onEmpty: () => void;
}

interface Tab {
  id: string;
  label: string;
  kind: 'bash' | 'output';
  sessionId: string | null;
}

export function Terminal(props: TerminalProps) {
  const {
    providerRef,
    status,
    newTerminalRequest,
    startBashOnMount,
    onEmpty,
    isRunning,
    chunks,
    message,
  } = props;
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState('');
  const tabCounter = useRef(0);
  const lastNewTerminalRequest = useRef(newTerminalRequest);
  const startedInitialTerminal = useRef(false);
  const hadTabsBefore = useRef(false);
  const pendingStarts = useRef(0);
  const sessionIds = useRef(new Set<string>());
  const mounted = useRef(true);
  const [terminalError, setTerminalError] = useState('');
  const tabsRef = useRef(tabs);
  const createBashTabRef = useRef<() => Promise<void>>(async () => undefined);
  const closeTabRef = useRef<(tab: Tab) => void>(() => undefined);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    createBashTabRef.current = async () => {
      const provider = providerRef.current;
      if (!provider || status !== 'connected') return;
      if (sessionIds.current.size >= 3 || pendingStarts.current > 0) return;
      pendingStarts.current++;
      setTerminalError('');
      try {
        const { sessionId } = await provider.startTerminal();
        if (!mounted.current) {
          await provider.closeTerminal(sessionId).catch(() => undefined);
          return;
        }
        sessionIds.current.add(sessionId);
        const tab: Tab = {
          id: sessionId,
          label: `bash ${++tabCounter.current}`,
          kind: 'bash',
          sessionId,
        };
        setTabs((current) => [...current, tab]);
        setActiveId(tab.id);
      } catch (error) {
        if (mounted.current)
          setTerminalError(
            error instanceof Error
              ? error.message
              : 'Could not start Bash terminal.'
          );
      } finally {
        pendingStarts.current--;
      }
    };
  }, [providerRef, status]);

  useEffect(() => {
    if (
      startBashOnMount &&
      status === 'connected' &&
      !startedInitialTerminal.current
    ) {
      startedInitialTerminal.current = true;
      void createBashTabRef.current();
    }
  }, [startBashOnMount, status]);

  useEffect(() => {
    if (
      status === 'connected' &&
      newTerminalRequest > lastNewTerminalRequest.current
    ) {
      lastNewTerminalRequest.current = newTerminalRequest;
      void createBashTabRef.current();
    }
  }, [newTerminalRequest, status]);

  useEffect(() => {
    if (tabs.length > 0) hadTabsBefore.current = true;
    else if (hadTabsBefore.current) onEmpty();
  }, [onEmpty, tabs.length]);
  useEffect(() => {
    if (!isRunning && chunks.length === 0 && message === 'Ready') return;
    setTabs((current) =>
      current.some((tab) => tab.kind === 'output')
        ? current
        : [
            ...current,
            {
              id: 'run-output',
              label: 'Run Output',
              kind: 'output',
              sessionId: null,
            },
          ]
    );
    setActiveId('run-output');
  }, [isRunning, chunks.length, message]);

  useEffect(
    () => () => {
      for (const tab of tabsRef.current)
        if (tab.sessionId)
          void providerRef.current
            ?.closeTerminal(tab.sessionId)
            .catch(() => undefined);
    },
    [providerRef]
  );

  useEffect(() => {
    closeTabRef.current = (tab) => {
      if (tab.sessionId) {
        sessionIds.current.delete(tab.sessionId);
        void providerRef.current
          ?.closeTerminal(tab.sessionId)
          .catch(() => undefined);
      }
      setTabs((current) => {
        const remaining = current.filter((item) => item.id !== tab.id);
        setActiveId((active) =>
          active === tab.id ? (remaining.at(-1)?.id ?? '') : active
        );
        return remaining;
      });
    };
  }, [providerRef]);

  useEffect(() => {
    const closeActive = () => {
      const active = tabsRef.current.find((tab) => tab.id === activeId);
      if (active) void closeTabRef.current(active);
    };
    window.addEventListener('syncode:terminal-close-active', closeActive);
    return () =>
      window.removeEventListener('syncode:terminal-close-active', closeActive);
  }, [activeId]);

  return (
    <section className="execution-terminal" aria-label="Terminal panel">
      <div className="execution-terminal-titlebar">
        <strong>TERMINAL</strong>
        <div
          className="execution-terminal-tabs"
          role="tablist"
          aria-label="Terminal tabs"
        >
          {tabs.map((tab) => (
            <div
              className={`execution-terminal-tab${activeId === tab.id ? ' is-active' : ''}`}
              key={tab.id}
            >
              <button
                id={`terminal-tab-${tab.id}`}
                role="tab"
                aria-controls={`terminal-panel-${tab.id}`}
                aria-selected={activeId === tab.id}
                tabIndex={activeId === tab.id ? 0 : -1}
                onClick={() => setActiveId(tab.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
                    return;
                  event.preventDefault();
                  const buttons = Array.from(
                    event.currentTarget
                      .closest('[role="tablist"]')
                      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
                      []
                  );
                  const index = buttons.indexOf(event.currentTarget);
                  const next =
                    buttons[
                      (index +
                        (event.key === 'ArrowRight' ? 1 : -1) +
                        buttons.length) %
                        buttons.length
                    ];
                  next?.focus();
                  next?.click();
                }}
              >
                {tab.label}
              </button>
              <button
                className="terminal-tab-close"
                aria-label={`Close ${tab.label}`}
                onClick={() => void closeTabRef.current(tab)}
                title={`Close ${tab.label}`}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M5.5 2h5l.6 1.5H14v1.4H2V3.5h2.9L5.5 2Zm-1.7 4h8.4l-.5 7.5H4.3L3.8 6Zm2 .9.3 5.7h1.2l-.2-5.7H5.8Zm3.2 0-.2 5.7H10l.3-5.7H9Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          ))}
          <button
            className="terminal-new-tab"
            onClick={() => void createBashTabRef.current()}
            disabled={
              props.status !== 'connected' ||
              tabs.filter((tab) => tab.kind === 'bash').length >= 3
            }
            title="New Bash terminal"
          >
            +
          </button>
        </div>
        <span className="execution-terminal-status" role="status">
          {terminalError || (props.message === 'Ready' ? '' : props.message)}
        </span>
        <div className="execution-terminal-actions">
          <button
            className="terminal-panel-close"
            type="button"
            onClick={props.onClose}
            title="Close terminal panel"
          >
            Close
          </button>
        </div>
      </div>
      {tabs.length === 0 && (
        <div className="terminal-empty">
          {terminalError ||
            (props.status === 'connected'
              ? 'Starting isolated Bash…'
              : 'Connect to the room to start a terminal.')}
        </div>
      )}
      {tabs.map((tab) => (
        <TerminalView
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          jobId={tab.kind === 'output' ? props.jobId : null}
          providerRef={props.providerRef}
          chunks={tab.kind === 'output' ? props.chunks : []}
          outputRevision={props.outputRevision}
        />
      ))}
      <div className="terminal-short-hint">
        Bash runs in an isolated container with no network access.
      </div>
    </section>
  );
}

function TerminalView({
  tab,
  active,
  jobId,
  providerRef,
  chunks,
  outputRevision,
}: {
  tab: Tab;
  active: boolean;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  jobId: string | null;
  chunks: TerminalOutputChunk[];
  outputRevision: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const offsetRef = useRef(0);
  const chunkCount = useRef(0);
  const revision = useRef(outputRevision);

  useEffect(() => {
    if (!hostRef.current) return;
    const styles = getComputedStyle(document.documentElement);
    const terminal = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
      allowProposedApi: false,
      theme: {
        background: styles.getPropertyValue('--bg').trim() || '#101010',
        foreground: styles.getPropertyValue('--text').trim() || '#e5e5e5',
        cursor: styles.getPropertyValue('--text-h').trim() || '#f2f2f2',
        selectionBackground:
          styles.getPropertyValue('--accent-bg').trim() || '#414141',
        scrollbarSliderBackground: styles
          .getPropertyValue('--scrollbar-thumb')
          .trim(),
        scrollbarSliderHoverBackground: styles
          .getPropertyValue('--scrollbar-thumb-hover')
          .trim(),
        scrollbarSliderActiveBackground: styles
          .getPropertyValue('--scrollbar-thumb-active')
          .trim(),
      },
      scrollback: 3000,
      allowTransparency: false,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    const themeObserver = new MutationObserver(() => {
      const root = getComputedStyle(document.documentElement);
      terminal.options.theme = {
        background: root.getPropertyValue('--bg').trim() || '#101010',
        foreground: root.getPropertyValue('--text').trim() || '#e5e5e5',
        cursor: root.getPropertyValue('--text-h').trim() || '#f2f2f2',
        selectionBackground:
          root.getPropertyValue('--accent-bg').trim() || '#414141',
        scrollbarSliderBackground: root
          .getPropertyValue('--scrollbar-thumb')
          .trim(),
        scrollbarSliderHoverBackground: root
          .getPropertyValue('--scrollbar-thumb-hover')
          .trim(),
        scrollbarSliderActiveBackground: root
          .getPropertyValue('--scrollbar-thumb-active')
          .trim(),
      };
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
    if (active)
      requestAnimationFrame(() => {
        fitRef.current?.fit();
        terminalRef.current?.focus();
      });
  }, [active]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !active || tab.kind !== 'bash' || !tab.sessionId) return;
    let stopped = false;
    let polling = false;
    let exited = false;
    const poll = async () => {
      if (stopped || polling || exited) return;
      polling = true;
      try {
        const result = await providerRef.current?.readTerminalOutput(
          tab.sessionId!,
          offsetRef.current
        );
        if (result) {
          if (result.text) terminal.write(result.text);
          offsetRef.current = result.offset;
          if (result.exited) {
            exited = true;
            terminal.write(`\r\n[process exited ${result.exitCode ?? ''}]\r\n`);
          }
        }
      } catch {
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
      const chunkSize = 2048;
      for (let i = 0; i < input.length; i += chunkSize) {
        const slice = input.slice(i, i + chunkSize);
        try {
          await providerRef.current?.writeTerminalInput(tab.sessionId, slice);
        } catch (error: unknown) {
          terminal.write(
            `\r\n${error instanceof Error ? error.message : 'Input could not be sent.'}\r\n`
          );
          break;
        }
      }
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
            `\r\n${error instanceof Error ? error.message : 'Input could not be sent.'}\r\n`
          );
        });
    const inputSubscription = terminal.onData((data) => {
      for (const character of data) {
        if (character === '\r' || character === '\n') {
          terminal.write('\r\n');
          sendLine(line);
          line = '';
        } else if (character === '\x7f' || character === '\b') {
          if (line.length > 0) {
            line = line.slice(0, -1);
            terminal.write('\b \b');
          }
        } else if (
          character >= ' ' &&
          character !== '\x7f' &&
          line.length < 4096
        ) {
          line += character;
          terminal.write(character);
        }
      }
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
