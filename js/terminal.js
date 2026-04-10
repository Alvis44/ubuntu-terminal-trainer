// === Terminal: xterm.js integration ===

export class Terminal {
    constructor(shell) {
        this.shell = shell;
        this.xterm = null;
        this.fitAddon = null;
        this.currentLine = '';
        this.cursorPos = 0;
        this._resizeObserver = null;
    }

    init(container) {
        // xterm.js is loaded globally via CDN
        this.xterm = new window.Terminal({
            theme: {
                background: '#1e1e1e',
                foreground: '#e0e0e0',
                cursor: '#e95420',
                cursorAccent: '#1e1e1e',
                selectionBackground: '#44475a',
                black: '#1e1e1e',
                red: '#f44336',
                green: '#4caf50',
                yellow: '#ff9800',
                blue: '#2196f3',
                magenta: '#ce93d8',
                cyan: '#80cbc4',
                white: '#e0e0e0',
                brightBlack: '#777777',
                brightRed: '#ff5252',
                brightGreen: '#69f0ae',
                brightYellow: '#ffd740',
                brightBlue: '#448aff',
                brightMagenta: '#ea80fc',
                brightCyan: '#a7ffeb',
                brightWhite: '#ffffff',
            },
            fontSize: 14,
            fontFamily: "'Ubuntu Mono', 'Courier New', monospace",
            cursorBlink: true,
            cursorStyle: 'block',
            allowProposedApi: true,
            scrollback: 1000,
        });

        this.fitAddon = new window.FitAddon.FitAddon();
        this.xterm.loadAddon(this.fitAddon);
        this.xterm.open(container);

        // Fit to container
        setTimeout(() => this.fit(), 50);

        // Observe resize
        this._resizeObserver = new ResizeObserver(() => {
            setTimeout(() => this.fit(), 50);
        });
        this._resizeObserver.observe(container);

        // Handle input
        this.xterm.onData(data => this._onData(data));

        return this;
    }

    fit() {
        try {
            if (this.fitAddon) this.fitAddon.fit();
        } catch (e) {
            // ignore fit errors during transitions
        }
    }

    writeWelcome(msg) {
        this.xterm.writeln(`\x1b[1;33m${msg}\x1b[0m`);
        this.xterm.writeln('');
        this._writePrompt();
    }

    _writePrompt() {
        this.xterm.write(this.shell.getPrompt());
        this.currentLine = '';
        this.cursorPos = 0;
    }

    _onData(data) {
        // Handle special sequences
        switch (data) {
            case '\r': // Enter
                this.xterm.writeln('');
                this._handleEnter();
                return;

            case '\x7f': // Backspace
                this._handleBackspace();
                return;

            case '\x03': // Ctrl+C
                this.xterm.writeln('^C');
                this._writePrompt();
                return;

            case '\x0c': { // Ctrl+L (clear)
                const savedLine = this.currentLine;
                const savedPos = this.cursorPos;
                // Clear screen and scrollback, move cursor to top-left
                this.xterm.write('\x1b[2J\x1b[3J\x1b[H');
                this._writePrompt();
                // Restore current input if any
                if (savedLine) {
                    this.xterm.write(savedLine);
                    this.currentLine = savedLine;
                    this.cursorPos = savedPos;
                }
                return;
            }

            case '\x04': // Ctrl+D
                if (this.currentLine.length === 0) {
                    this.xterm.writeln('');
                    this.xterm.writeln('logout');
                }
                return;

            case '\t': // Tab
                this._handleTab();
                return;
        }

        // Arrow keys and other escape sequences
        if (data.startsWith('\x1b[')) {
            switch (data) {
                case '\x1b[A': // Up arrow
                    this._handleHistoryUp();
                    return;
                case '\x1b[B': // Down arrow
                    this._handleHistoryDown();
                    return;
                case '\x1b[C': // Right arrow
                    if (this.cursorPos < this.currentLine.length) {
                        this.cursorPos++;
                        this.xterm.write(data);
                    }
                    return;
                case '\x1b[D': // Left arrow
                    if (this.cursorPos > 0) {
                        this.cursorPos--;
                        this.xterm.write(data);
                    }
                    return;
                case '\x1b[H': // Home
                    while (this.cursorPos > 0) {
                        this.xterm.write('\x1b[D');
                        this.cursorPos--;
                    }
                    return;
                case '\x1b[F': // End
                    while (this.cursorPos < this.currentLine.length) {
                        this.xterm.write('\x1b[C');
                        this.cursorPos++;
                    }
                    return;
                case '\x1b[3~': // Delete
                    this._handleDelete();
                    return;
            }
            return;
        }

        // Regular character input
        if (data >= ' ') {
            // Insert character at cursor position
            if (this.cursorPos < this.currentLine.length) {
                const before = this.currentLine.slice(0, this.cursorPos);
                const after = this.currentLine.slice(this.cursorPos);
                this.currentLine = before + data + after;
                this.cursorPos += data.length;

                // Rewrite from cursor to end
                this.xterm.write(data + after);
                // Move cursor back to right position
                for (let i = 0; i < after.length; i++) {
                    this.xterm.write('\x1b[D');
                }
            } else {
                this.currentLine += data;
                this.cursorPos += data.length;
                this.xterm.write(data);
            }
        }
    }

    _handleEnter() {
        const input = this.currentLine.trim();
        if (input) {
            const output = this.shell.execute(input, this);
            if (output) {
                // xterm.js needs \r\n for proper line breaks
                const lines = output.split('\n');
                for (const line of lines) {
                    this.xterm.writeln(line);
                }
            }
        }
        this._writePrompt();
    }

    _handleBackspace() {
        if (this.cursorPos > 0) {
            const before = this.currentLine.slice(0, this.cursorPos - 1);
            const after = this.currentLine.slice(this.cursorPos);
            this.currentLine = before + after;
            this.cursorPos--;

            // Move back, rewrite, clear last char
            this.xterm.write('\b' + after + ' ');
            // Move cursor back
            for (let i = 0; i <= after.length; i++) {
                this.xterm.write('\x1b[D');
            }
        }
    }

    _handleDelete() {
        if (this.cursorPos < this.currentLine.length) {
            const before = this.currentLine.slice(0, this.cursorPos);
            const after = this.currentLine.slice(this.cursorPos + 1);
            this.currentLine = before + after;

            this.xterm.write(after + ' ');
            for (let i = 0; i <= after.length; i++) {
                this.xterm.write('\x1b[D');
            }
        }
    }

    _handleTab() {
        // Build partial command line up to cursor
        const partial = this.currentLine.slice(0, this.cursorPos);
        const completions = this.shell.getCompletions(partial);

        if (completions.length === 0) return;

        if (completions.length === 1) {
            // Single completion — fill it in
            const tokens = this.shell.tokenize(partial);
            const lastToken = tokens[tokens.length - 1] || '';
            const completion = completions[0];
            const suffix = completion.slice(lastToken.length) + (completion.endsWith('/') ? '' : ' ');

            this.currentLine = this.currentLine.slice(0, this.cursorPos) + suffix + this.currentLine.slice(this.cursorPos);
            this.cursorPos += suffix.length;
            this.xterm.write(suffix + this.currentLine.slice(this.cursorPos));
            // Move cursor back if needed
            const after = this.currentLine.slice(this.cursorPos);
            for (let i = 0; i < after.length; i++) {
                this.xterm.write('\x1b[D');
            }
        } else {
            // Multiple completions — show them
            this.xterm.writeln('');
            this.xterm.writeln(completions.join('  '));
            this.xterm.write(this.shell.getPrompt() + this.currentLine);
            // Position cursor
            const after = this.currentLine.slice(this.cursorPos);
            for (let i = 0; i < after.length; i++) {
                this.xterm.write('\x1b[D');
            }
        }
    }

    _handleHistoryUp() {
        const cmd = this.shell.historyUp();
        if (cmd !== null) {
            this._replaceLine(cmd);
        }
    }

    _handleHistoryDown() {
        const cmd = this.shell.historyDown();
        if (cmd !== null) {
            this._replaceLine(cmd);
        }
    }

    _replaceLine(newLine) {
        // Clear current line
        while (this.cursorPos > 0) {
            this.xterm.write('\b \b');
            this.cursorPos--;
        }
        // Clear anything after cursor
        const remaining = this.currentLine.length - this.cursorPos;
        for (let i = 0; i < remaining; i++) {
            this.xterm.write(' ');
        }
        for (let i = 0; i < remaining; i++) {
            this.xterm.write('\b');
        }

        // Write new line
        this.currentLine = newLine;
        this.cursorPos = newLine.length;
        this.xterm.write(newLine);
    }

    clear() {
        this.xterm.clear();
    }

    writeln(text) {
        // Split by \n and write each line separately for proper \r\n handling
        const lines = text.split('\n');
        for (const line of lines) {
            this.xterm.writeln(line);
        }
    }

    focus() {
        if (this.xterm) this.xterm.focus();
    }

    dispose() {
        if (this._resizeObserver) this._resizeObserver.disconnect();
        if (this.xterm) this.xterm.dispose();
    }
}
