import { describe, expect, it } from 'vitest';
import { consumeTerminalInput } from '../terminalInput';

describe('consumeTerminalInput', () => {
  it('echoes printable input and keeps the current line', () => {
    expect(consumeTerminalInput('name', '')).toEqual({
      line: 'name',
      echo: 'name',
      submittedLines: [],
    });
  });

  it('submits each entered line and starts a fresh line', () => {
    expect(consumeTerminalInput('first\rsecond\n', '')).toEqual({
      line: '',
      echo: 'first\r\nsecond\r\n',
      submittedLines: ['first', 'second'],
    });
  });

  it('handles backspace without splitting supplementary Unicode characters', () => {
    expect(consumeTerminalInput('\x7f', 'A😀')).toEqual({
      line: 'A',
      echo: '\b \b',
      submittedLines: [],
    });
  });

  it('ignores control characters and caps the editable line', () => {
    expect(consumeTerminalInput('\u0003abcd', 'x', 3)).toEqual({
      line: 'xab',
      echo: 'ab',
      submittedLines: [],
    });
  });
});
