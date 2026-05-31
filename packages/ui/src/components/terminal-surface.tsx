import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface TerminalSurfaceHandle {
  write(data: string): void;
  focus(): void;
}

interface TerminalSurfaceProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export const TerminalSurface = forwardRef<TerminalSurfaceHandle, TerminalSurfaceProps>(function TerminalSurface(
  { onData, onResize },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const pendingInputRef = useRef('');
  const inputTimerRef = useRef<number | undefined>(undefined);

  useImperativeHandle(ref, () => ({
    write(data: string) {
      terminalRef.current?.write(data);
    },
    focus() {
      terminalRef.current?.focus();
    },
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#101214',
        foreground: '#d8dee9',
        cursor: '#f8f8f2',
        selectionBackground: '#3b4252',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;

    const flushInput = () => {
      inputTimerRef.current = undefined;
      const data = pendingInputRef.current;
      pendingInputRef.current = '';
      if (data) onData?.(data);
    };

    const dataSubscription = terminal.onData((data) => {
      pendingInputRef.current += data;
      if (inputTimerRef.current === undefined) {
        inputTimerRef.current = window.setTimeout(flushInput, 24);
      }
    });

    const fit = () => {
      try {
        fitAddon.fit();
        onResize?.(terminal.cols, terminal.rows);
      } catch {
        // The terminal may not be visible yet; the next resize/focus will fit.
      }
    };

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : undefined;
    resizeObserver?.observe(host);
    window.setTimeout(() => {
      fit();
      terminal.focus();
    }, 0);

    return () => {
      if (inputTimerRef.current !== undefined) {
        window.clearTimeout(inputTimerRef.current);
        flushInput();
      }
      resizeObserver?.disconnect();
      dataSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [onData, onResize]);

  return <div className="terminal-surface" ref={hostRef} />;
});
