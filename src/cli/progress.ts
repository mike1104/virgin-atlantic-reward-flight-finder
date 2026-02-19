import * as readline from "readline";

export type ScrapeProgressSnapshot = {
  completed: number;
  successful: number;
  empty: number;
  failed: number;
  fallbackUsed: number;
  cached: number;
};

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export class ScrapeProgressBar {
  private readonly enabled: boolean;
  private lastLine = "";
  private rendered = false;
  private readonly startedAtMs: number;

  constructor(private readonly total: number) {
    this.enabled = process.stdout.isTTY === true && process.env.VA_PROGRESS_BAR !== "0";
    this.startedAtMs = Date.now();
  }

  private msPerSuccess(successful: number, cached: number): string {
    const nonCachedSuccesses = Math.max(successful - cached, 0);
    if (nonCachedSuccesses <= 0) return "--";
    const elapsedMs = Math.max(Date.now() - this.startedAtMs, 1);
    return (elapsedMs / nonCachedSuccesses).toFixed(0);
  }

  private truncateToTerminal(line: string): string {
    if (!this.enabled) return line;
    const columns = process.stdout.columns || 120;
    if (line.length < columns) return line;
    return line.slice(0, Math.max(columns - 1, 1));
  }

  private writeLine(line: string): void {
    const truncated = this.truncateToTerminal(line);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(truncated);
  }

  private buildLine(snapshot: ScrapeProgressSnapshot): string {
    const percent = this.total === 0 ? 100 : Math.round((snapshot.completed / this.total) * 100);
    const barWidth = 30;
    const filled = Math.max(0, Math.min(barWidth, Math.round((percent / 100) * barWidth)));
    const bar = `${"#".repeat(filled)}${"-".repeat(barWidth - filled)}`;
    const msPerSuccess = this.msPerSuccess(snapshot.successful, snapshot.cached);
    const avgText = msPerSuccess === "--" ? "--" : `${msPerSuccess}ms`;
    return `  [${bar}] ${snapshot.completed}/${this.total} ${percent}% | ok:${snapshot.successful} empty:${snapshot.empty} fail:${snapshot.failed} fb:${snapshot.fallbackUsed} cache:${snapshot.cached} ok_avg:${avgText}`;
  }

  update(snapshot: ScrapeProgressSnapshot): void {
    if (!this.enabled) {
      const percent = this.total === 0 ? 100 : Math.round((snapshot.completed / this.total) * 100);
      const msPerSuccess = this.msPerSuccess(snapshot.successful, snapshot.cached);
      const avgText = msPerSuccess === "--" ? "--" : `${msPerSuccess}ms`;
      console.log(
        `  Progress ${snapshot.completed}/${this.total} (${percent}%) | ok:${snapshot.successful} empty:${snapshot.empty} failed:${snapshot.failed} fallback:${snapshot.fallbackUsed} cache:${snapshot.cached} ok_avg:${avgText}`
      );
      return;
    }

    this.lastLine = this.buildLine(snapshot);
    this.writeLine(this.lastLine);
    this.rendered = true;
  }

  log(message: string): void {
    if (!this.enabled) {
      console.log(message);
      return;
    }
    if (!this.rendered) {
      console.log(message);
      return;
    }
    this.writeLine("");
    process.stdout.write(`${message}\n`);
    this.writeLine(this.lastLine);
  }

  finish(): void {
    if (!this.enabled || !this.rendered) return;
    this.writeLine(this.lastLine);
    process.stdout.write("\n");
    this.rendered = false;
  }
}
