import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import { userFacingError } from '../../utils/userFacingError';
import type { TerminalTab } from './terminalTypes';

const RUN_OUTPUT_TAB: TerminalTab = {
  id: 'run-output',
  label: 'Run Output',
  kind: 'output',
  sessionId: null,
};

export interface UseTerminalTabsOptions {
  outputRevision: number;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  newTerminalRequest: number;
  startBashOnMount: boolean;
  onEmpty: () => void;
}

export function useTerminalTabs({
  outputRevision,
  providerRef,
  status,
  newTerminalRequest,
  startBashOnMount,
  onEmpty,
}: UseTerminalTabsOptions) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState('');
  const [activeRevision, setActiveRevision] = useState(outputRevision - 1);
  const [dismissedOutputRevision, setDismissedOutputRevision] = useState(0);
  const [terminalError, setTerminalError] = useState('');
  const tabCounter = useRef(0);
  const lastNewTerminalRequest = useRef(newTerminalRequest);
  const startedInitialTerminal = useRef(false);
  const hadTabsBefore = useRef(false);
  const pendingStarts = useRef(0);
  const sessionIds = useRef(new Set<string>());
  const mounted = useRef(true);
  const tabsRef = useRef(tabs);
  const createBashTabRef = useRef<() => Promise<void>>(async () => undefined);
  const closeTabRef = useRef<(tab: TerminalTab) => void>(() => undefined);
  const showOutputTab = outputRevision > dismissedOutputRevision;
  const visibleTabs = useMemo(
    () =>
      showOutputTab && !tabs.some((tab) => tab.kind === 'output')
        ? [...tabs, RUN_OUTPUT_TAB]
        : tabs,
    [showOutputTab, tabs]
  );
  const visibleActiveId =
    showOutputTab && activeRevision !== outputRevision
      ? 'run-output'
      : activeId;

  useEffect(() => {
    tabsRef.current = visibleTabs;
  }, [visibleTabs]);

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
        const tab: TerminalTab = {
          id: sessionId,
          label: `bash ${++tabCounter.current}`,
          kind: 'bash',
          sessionId,
        };
        setTabs((current) => [...current, tab]);
        setActiveId(tab.id);
        setActiveRevision(outputRevision);
      } catch (error) {
        if (mounted.current)
          setTerminalError(
            userFacingError(
              error,
              'Could not start a Bash terminal. Try again.'
            )
          );
      } finally {
        pendingStarts.current--;
      }
    };
  }, [outputRevision, providerRef, status]);

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
    if (visibleTabs.length > 0) hadTabsBefore.current = true;
    else {
      startedInitialTerminal.current = false;
      if (hadTabsBefore.current) onEmpty();
    }
  }, [onEmpty, visibleTabs.length]);

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
      if (tab.kind === 'output') setDismissedOutputRevision(outputRevision);
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
      setActiveRevision(outputRevision);
    };
  }, [outputRevision, providerRef]);

  useEffect(() => {
    const closeActive = () => {
      const active = tabsRef.current.find((tab) => tab.id === visibleActiveId);
      if (active) void closeTabRef.current(active);
    };
    window.addEventListener('syncode:terminal-close-active', closeActive);
    return () =>
      window.removeEventListener('syncode:terminal-close-active', closeActive);
  }, [visibleActiveId]);

  return {
    visibleTabs,
    visibleActiveId,
    terminalError,
    canStartBash:
      status === 'connected' &&
      visibleTabs.filter((tab) => tab.kind === 'bash').length < 3,
    selectTab(tab: TerminalTab) {
      setActiveId(tab.id);
      setActiveRevision(outputRevision);
    },
    closeTab(tab: TerminalTab) {
      void closeTabRef.current(tab);
    },
    startBash() {
      void createBashTabRef.current();
    },
  };
}
