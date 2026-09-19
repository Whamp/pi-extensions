/** Pads an Answer box row while reserving the terminal's final cell to prevent delayed soft wrapping. */
export function padAnswerBoxLine(
  line: string,
  terminalWidth: number,
  measureVisibleWidth: (value: string) => number,
): string {
  const lineWidth = measureVisibleWidth(line);
  const safeRenderWidth = Math.max(0, terminalWidth - 1);
  return line + " ".repeat(Math.max(0, safeRenderWidth - lineWidth));
}
