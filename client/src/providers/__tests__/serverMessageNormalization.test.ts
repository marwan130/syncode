import { describe, expect, it } from 'vitest';
import {
  normalizeChatMessage,
  normalizeParticipant,
} from '../serverMessageNormalization';

describe('server message normalization', () => {
  it('normalizes camel-case participant data', () => {
    expect(
      normalizeParticipant({
        connectionId: 'connection-1',
        displayName: 'Miro',
        color: '#22d3ee',
        isAdmin: true,
        isLocked: false,
      })
    ).toEqual({
      connectionId: 'connection-1',
      displayName: 'Miro',
      color: '#22d3ee',
      isAdmin: true,
      isLocked: false,
    });
  });

  it('accepts Pascal-case payloads and supplies safe participant defaults', () => {
    expect(
      normalizeParticipant({ ConnectionId: 42, IsAdmin: 1, IsLocked: 0 })
    ).toEqual({
      connectionId: '42',
      displayName: 'Anonymous',
      color: '#38bdf8',
      isAdmin: true,
      isLocked: false,
    });
  });

  it('normalizes chat messages and supports either server casing', () => {
    expect(
      normalizeChatMessage({
        Id: 'message-1',
        Author: 'Ahmed',
        Color: '#f472b6',
        Content: 'Hello',
        SentAt: '2026-10-20T00:00:00.000Z',
      })
    ).toEqual({
      id: 'message-1',
      author: 'Ahmed',
      color: '#f472b6',
      content: 'Hello',
      sentAt: '2026-10-20T00:00:00.000Z',
    });
  });

  it('supplies defaults for incomplete message payloads', () => {
    expect(normalizeChatMessage({})).toMatchObject({
      id: '',
      author: 'Anonymous',
      color: '#38bdf8',
      content: '',
    });
    expect(Number.isNaN(Date.parse(normalizeChatMessage({}).sentAt))).toBe(
      false
    );
  });
});
