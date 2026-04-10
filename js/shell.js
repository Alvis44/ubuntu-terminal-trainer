// === Shell Layer: parsing, pipes, redirects, history, tab completion ===

import { t } from './i18n.js';

export class Shell {
    constructor(fs, commands) {
        this.fs = fs;
        this.commands = commands;
        this.history = [];
        this.historyIndex = -1;
        this.env = {
            HOME: '/home/user',
            USER: 'user',
            HOSTNAME: 'ubuntu',
            PATH: '/usr/local/bin:/usr/bin:/bin',
            SHELL: '/bin/bash',
            PWD: '/home/user',
            LANG: 'en_US.UTF-8',
            TERM: 'xterm-256color',
        };
        this.lastExitCode = 0;
        this.onCommandExecuted = null; // callback for lesson/challenge validation
    }

    getPrompt() {
        const displayPath = this.fs.displayPath(this.fs.cwd);
        return `\x1b[1;32muser@ubuntu\x1b[0m:\x1b[1;34m${displayPath}\x1b[0m$ `;
    }

    // Parse command line into tokens respecting quotes
    // Marks single-quoted segments with \x00 wrapper so expandVars can skip them
    tokenize(input) {
        const tokens = [];
        let current = '';
        let inSingle = false;
        let inDouble = false;
        let escaped = false;

        for (let i = 0; i < input.length; i++) {
            const ch = input[i];

            if (escaped) {
                current += ch;
                escaped = false;
                continue;
            }

            if (ch === '\\' && !inSingle) {
                escaped = true;
                continue;
            }

            if (ch === "'" && !inDouble) {
                inSingle = !inSingle;
                if (inSingle) {
                    current += '\x00'; // start marker for no-expand zone
                } else {
                    current += '\x00'; // end marker
                }
                continue;
            }

            if (ch === '"' && !inSingle) {
                inDouble = !inDouble;
                continue;
            }

            if (!inSingle && !inDouble && (ch === ' ' || ch === '\t')) {
                if (current) {
                    tokens.push(current);
                    current = '';
                }
                continue;
            }

            // Special chars (pipe, redirect) as separate tokens
            if (!inSingle && !inDouble) {
                if (ch === '|' || ch === '<') {
                    if (current) tokens.push(current);
                    current = '';
                    tokens.push(ch);
                    continue;
                }
                if (ch === '>') {
                    if (current) tokens.push(current);
                    current = '';
                    if (input[i + 1] === '>') {
                        tokens.push('>>');
                        i++;
                    } else {
                        tokens.push('>');
                    }
                    continue;
                }
            }

            current += ch;
        }

        if (current) tokens.push(current);
        return tokens;
    }

    // Expand environment variables in tokens, but skip single-quoted (\x00) zones
    expandVars(tokens) {
        return tokens.map(token => {
            // Split by \x00 markers: even segments are expandable, odd are protected
            const parts = token.split('\x00');
            for (let i = 0; i < parts.length; i++) {
                if (i % 2 === 0) {
                    // Outside single quotes — expand $VAR
                    parts[i] = parts[i].replace(/\$(\w+)/g, (match, name) => {
                        if (name === '?') return String(this.lastExitCode);
                        return this.env[name] || '';
                    });
                }
                // Odd parts (inside single quotes) are left as-is
            }
            return parts.join('');
        });
    }

    // Split tokens by pipes
    splitPipes(tokens) {
        const segments = [];
        let current = [];
        for (const token of tokens) {
            if (token === '|') {
                segments.push(current);
                current = [];
            } else {
                current.push(token);
            }
        }
        if (current.length > 0) segments.push(current);
        return segments;
    }

    // Extract redirects from a segment
    extractRedirects(tokens) {
        const args = [];
        let stdout = null;
        let stdoutAppend = false;
        let stdin = null;

        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i] === '>' && tokens[i + 1]) {
                stdout = tokens[++i];
                stdoutAppend = false;
            } else if (tokens[i] === '>>' && tokens[i + 1]) {
                stdout = tokens[++i];
                stdoutAppend = true;
            } else if (tokens[i] === '<' && tokens[i + 1]) {
                stdin = tokens[++i];
            } else {
                args.push(tokens[i]);
            }
        }

        return { args, stdout, stdoutAppend, stdin };
    }

    // Execute a single command line
    execute(input, terminal) {
        const trimmed = input.trim();
        if (!trimmed) return '';

        // Add to history
        if (this.history[this.history.length - 1] !== trimmed) {
            this.history.push(trimmed);
        }
        this.historyIndex = this.history.length;

        // Handle && and || (simplified: just split by && and run sequentially)
        if (trimmed.includes('&&')) {
            const parts = trimmed.split('&&').map(s => s.trim());
            const outputs = [];
            for (const part of parts) {
                const result = this._executeSingle(part, terminal);
                if (result.error) {
                    outputs.push(result.error);
                    break;
                }
                if (result.output) outputs.push(result.output);
            }
            return outputs.join('\n');
        }

        const result = this._executeSingle(trimmed, terminal);
        if (result.error) return result.error;
        return result.output || '';
    }

    _executeSingle(input, terminal) {
        let tokens = this.tokenize(input);
        tokens = this.expandVars(tokens);

        const pipeSegments = this.splitPipes(tokens);
        let pipeInput = null;
        let lastOutput = '';

        for (let i = 0; i < pipeSegments.length; i++) {
            const segment = pipeSegments[i];
            const { args, stdout, stdoutAppend, stdin } = this.extractRedirects(segment);

            if (args.length === 0) continue;

            const cmdName = args[0];
            const cmdArgs = args.slice(1);

            // Read stdin from file if specified
            let stdinContent = pipeInput;
            if (stdin) {
                const content = this.fs.readFile(stdin);
                if (content === null) return { error: `bash: ${stdin}: ${t('no_such_file')}` };
                if (content.error) return { error: `bash: ${stdin}: ${t(content.error)}` };
                stdinContent = content;
            }

            // Execute command
            const cmd = this.commands[cmdName];
            if (!cmd) {
                this.lastExitCode = 127;
                return { error: `${cmdName}: ${t('cmd_not_found')}` };
            }

            const ctx = {
                stdin: stdinContent,
                env: this.env,
                history: this.history,
                terminal: terminal,
                sudo: false,
            };

            let result = cmd(cmdArgs, ctx);

            // Update PWD
            this.env.PWD = this.fs.cwd;

            if (result && typeof result === 'object' && result.error) {
                this.lastExitCode = 1;
                return { error: result.error };
            }

            if (result === undefined || result === null) result = '';

            // Handle stdout redirect (add trailing newline like real bash)
            if (stdout) {
                const data = result ? result + '\n' : '';
                if (stdoutAppend) {
                    this.fs.appendFile(stdout, data);
                } else {
                    this.fs.writeFile(stdout, data);
                }
                lastOutput = '';
            } else {
                lastOutput = result;
            }

            // Pass output to next pipe segment
            pipeInput = lastOutput;
        }

        this.lastExitCode = 0;

        // Notify callback (for lesson/challenge validation)
        if (this.onCommandExecuted) {
            this.onCommandExecuted(input, lastOutput);
        }

        return { output: lastOutput };
    }

    // Tab completion
    getCompletions(partial) {
        const tokens = this.tokenize(partial);
        const isFirstToken = tokens.length <= 1;
        const lastToken = tokens[tokens.length - 1] || '';

        if (isFirstToken) {
            // Complete command names
            return Object.keys(this.commands)
                .filter(cmd => cmd.startsWith(lastToken))
                .sort();
        }

        // Complete file/directory paths
        let dir, prefix;
        const lastSlash = lastToken.lastIndexOf('/');
        if (lastSlash !== -1) {
            dir = lastToken.slice(0, lastSlash) || '/';
            prefix = lastToken.slice(lastSlash + 1);
        } else {
            dir = '.';
            prefix = lastToken;
        }

        const resolved = this.fs.resolve(dir);
        const entries = this.fs.readdir(resolved);
        if (!entries) return [];

        const matches = entries
            .filter(name => name.startsWith(prefix))
            .map(name => {
                const fullPath = lastSlash !== -1 ? lastToken.slice(0, lastSlash + 1) + name : name;
                const isDir = this.fs.isDir(resolved + '/' + name);
                return isDir ? fullPath + '/' : fullPath;
            })
            .sort();

        return matches;
    }

    // History navigation
    historyUp() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            return this.history[this.historyIndex];
        }
        return null;
    }

    historyDown() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            return this.history[this.historyIndex];
        }
        this.historyIndex = this.history.length;
        return '';
    }
}
