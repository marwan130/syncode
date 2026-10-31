import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import type { BottomPanelView } from './terminalTypes';
import { userFacingError } from '../../utils/userFacingError';
import type { TerminalTab } from './terminalTypes';

export interface UseTerminalTabsOptions {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  isPanelOpen: boolean;
  activeView: BottomPanelView;
  newTerminalRequest: number;
  onEmpty: () => void;
}

export function useTerminalTabs({
  providerRef,
  status,
  isPanelOpen,
  activeView,
  newTerminalRequest,
  onEmpty,
}: UseTerminalTabsOptions) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState('');
  const [terminalError, setTerminalError] = useState('');
  const allocatedTabNumbers = useRef(new Set<number>());
  const lastNewTerminalRequest = useRef(newTerminalRequest);
  const autoStartRequested = useRef(false);
  const hadTabsBefore = useRef(false);
  const pendingStarts = useRef(0);
  const cancelledStarts = useRef(new Set<string>());
  const sessionIds = useRef(new Set<string>());
  const mounted = useRef(true);
  const tabsRef = useRef(tabs);
  const createBashTabRef = useRef<() => Promise<void>>(async () => undefined);
  const closeTabRef = useRef<(tab: TerminalTab) => void>(() => undefined);
  const visibleTabs = tabs;
  const visibleActiveId = activeId;

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
      const bashCount =
        tabsRef.current.filter((tab) => tab.kind === 'bash').length +
        pendingStarts.current;
      if (bashCount >= 3) return;
      pendingStarts.current++;
      const pendingId = `pending-${crypto.randomUUID()}`;
      let tabNumber = 1;
      while (allocatedTabNumbers.current.has(tabNumber)) tabNumber++;
      allocatedTabNumbers.current.add(tabNumber);
      const label = `bash ${tabNumber}`;
      const pendingTab: TerminalTab = {
        id: pendingId,
        label,
        kind: 'bash',
        sessionId: null,
      };
      setTerminalError('');
      setTabs((current) => [...current, pendingTab]);
      setActiveId(pendingId);
      try {
        const { sessionId } = await provider.startTerminal();
        if (!mounted.current || cancelledStarts.current.delete(pendingId)) {
          allocatedTabNumbers.current.delete(tabNumber);
          await provider.closeTerminal(sessionId).catch(() => undefined);
          return;
        }
        sessionIds.current.add(sessionId);
        setTabs((current) =>
          current.map((tab) =>
            tab.id === pendingId ? { ...tab, id: sessionId, sessionId } : tab
          )
        );
        setActiveId((active) => (active === pendingId ? sessionId : active));
      } catch (error) {
        allocatedTabNumbers.current.delete(tabNumber);
        setTabs((current) => current.filter((tab) => tab.id !== pendingId));
        setActiveId((active) => (active === pendingId ? '' : active));
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
  }, [providerRef, status]);

  useEffect(() => {
    if (
      isPanelOpen &&
      activeView === 'terminal' &&
      status === 'connected' &&
      visibleTabs.length === 0 &&
      !autoStartRequested.current
    ) {
      autoStartRequested.current = true;
      void createBashTabRef.current();
    }
  }, [activeView, isPanelOpen, status, visibleTabs.length]);

  useEffect(() => {
    if (!isPanelOpen || activeView !== 'terminal' || status !== 'connected')
      autoStartRequested.current = false;
  }, [activeView, isPanelOpen, status]);

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
      const tabNumber = Number(tab.label.match(/^bash (\d+)$/)?.[1]);
      if (Number.isInteger(tabNumber))
        allocatedTabNumbers.current.delete(tabNumber);
      if (!tab.sessionId) cancelledStarts.current.add(tab.id);
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
    },
    closeTab(tab: TerminalTab) {
      void closeTabRef.current(tab);
    },
    startBash() {
      void createBashTabRef.current();
    },
  };
}
