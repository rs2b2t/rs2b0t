/** The standard script status box: black backdrop at (6,6), 12px monospace,
 *  one accent colour, 16px line pitch. */
export function drawStatusBox(ctx: CanvasRenderingContext2D, lines: string[], accent: string, minWidth = 0): void {
    ctx.font = '12px monospace';
    const width = Math.max(...lines.map(l => ctx.measureText(l).width), minWidth) + 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(6, 6, width, lines.length * 16 + 10);
    ctx.fillStyle = accent;
    lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
}
