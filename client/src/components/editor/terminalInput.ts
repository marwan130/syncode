export interface TerminalInputUpdate {
  line: string;
  echo: string;
  submittedLines: string[];
}

export function consumeTerminalInput(
  data: string,
  currentLine: string,
  maxLineLength = 4096
): TerminalInputUpdate {
  let line = currentLine;
  let echo = '';
  const submittedLines: string[] = [];

  for (const character of data) {
    if (character === '\r' || character === '\n') {
      echo += '\r\n';
      submittedLines.push(line);
      line = '';
      continue;
    }

    if (character === '\x7f' || character === '\b') {
      if (line.length > 0) {
        line = Array.from(line).slice(0, -1).join('');
        echo += '\b \b';
      }
      continue;
    }

    if (character >= ' ' && line.length < maxLineLength) {
      line += character;
      echo += character;
    }
  }

  return { line, echo, submittedLines };
}
