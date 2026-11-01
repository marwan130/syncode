import { describe, expect, it } from 'vitest';
import { deduplicateParticipants } from '../useAwareness';
import type { ParticipantInfo } from '../../providers/signalRTypes';

const participant = (
  connectionId: string,
  memberId?: string
): ParticipantInfo => ({
  connectionId,
  memberId,
  displayName: connectionId,
  color: '#38bdf8',
});

describe('deduplicateParticipants', () => {
  it('keeps the local profile and removes another connection for the same member', () => {
    expect(
      deduplicateParticipants(
        [
          participant('stale-connection', 'member-1'),
          participant('local', 'member-1'),
        ],
        'local'
      )
    ).toEqual([]);
  });

  it('keeps only one peer per member while retaining unidentified participants', () => {
    expect(
      deduplicateParticipants(
        [
          participant('peer-1', 'member-1'),
          participant('peer-2', 'member-1'),
          participant('legacy-peer'),
        ],
        'local'
      ).map(({ connectionId }) => connectionId)
    ).toEqual(['peer-1', 'legacy-peer']);
  });

  it('filters a stale local connection when the current connection is absent', () => {
    expect(
      deduplicateParticipants(
        [participant('stale-local', 'member-1')],
        'current-local',
        'member-1'
      )
    ).toEqual([]);
  });
});
