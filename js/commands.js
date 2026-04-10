// === Command Implementations ===

import { t } from './i18n.js';

// Mock process list
const mockProcesses = [
    { pid: 1, user: 'root', cpu: '0.0', mem: '0.4', command: '/sbin/init' },
    { pid: 234, user: 'root', cpu: '0.1', mem: '1.2', command: '/usr/lib/systemd/systemd-journald' },
    { pid: 456, user: 'root', cpu: '0.0', mem: '0.8', command: '/usr/sbin/sshd' },
    { pid: 789, user: 'user', cpu: '0.2', mem: '1.5', command: '/usr/lib/systemd/systemd --user' },
    { pid: 892, user: 'root', cpu: '0.1', mem: '0.6', command: '/usr/sbin/NetworkManager' },
    { pid: 1100, user: 'user', cpu: '0.0', mem: '0.3', command: 'sshd: user@pts/0' },
    { pid: 1234, user: 'root', cpu: '0.0', mem: '0.1', command: '/usr/sbin/cron' },
    { pid: 1500, user: 'user', cpu: '1.2', mem: '3.4', command: '-bash' },
];

let nextPid = 2000;
let userProcesses = [];

// Mock installed packages
const installedPackages = new Set([
    'bash', 'coreutils', 'grep', 'sed', 'gawk', 'findutils',
    'tar', 'gzip', 'curl', 'wget', 'openssh-client', 'nano',
    'vim-tiny', 'apt', 'dpkg', 'systemd', 'python3', 'git',
]);

const availablePackages = new Set([
    'htop', 'tree', 'tmux', 'nodejs', 'nginx', 'docker.io',
    'postgresql', 'redis-server', 'build-essential', 'gcc', 'make',
    'python3-pip', 'net-tools', 'nmap', 'zip', 'unzip',
]);

export function createCommands(fs) {
    const commands = {};

    // === pwd ===
    commands.pwd = (args, ctx) => {
        return fs.cwd;
    };

    // === cd ===
    commands.cd = (args, ctx) => {
        const target = args[0] || '~';
        const resolved = fs.resolve(target);

        if (!fs.exists(resolved)) return { error: `cd: ${target}: ${t('no_such_file')}` };
        if (!fs.isDir(resolved)) return { error: `cd: ${target}: ${t('not_a_directory')}` };

        fs.cwd = resolved;
        return '';
    };

    // === ls ===
    commands.ls = (args, ctx) => {
        let showAll = false;
        let showLong = false;
        let showHuman = false;
        const paths = [];

        for (const arg of args) {
            if (arg.startsWith('-')) {
                if (arg.includes('a')) showAll = true;
                if (arg.includes('l')) showLong = true;
                if (arg.includes('h')) showHuman = true;
            } else {
                paths.push(arg);
            }
        }

        if (paths.length === 0) paths.push('.');
        const target = paths[0];
        const resolved = fs.resolve(target);

        if (!fs.exists(resolved)) return { error: `ls: cannot access '${target}': ${t('no_such_file')}` };

        if (fs.isFile(resolved)) {
            if (showLong) {
                const stat = fs.stat(resolved);
                const name = resolved.split('/').pop();
                return `${stat.permissions} 1 user user ${formatSize(stat.size, showHuman)} Jan 15 10:00 ${name}`;
            }
            return resolved.split('/').pop();
        }

        let entries = fs.readdirWithTypes(resolved);
        if (!entries) return { error: `ls: cannot access '${target}': ${t('no_such_file')}` };

        if (!showAll) {
            entries = entries.filter(e => !e.name.startsWith('.'));
        }

        entries.sort((a, b) => a.name.localeCompare(b.name));

        if (showLong) {
            const lines = [];
            for (const e of entries) {
                const colorName = e.type === 'dir' ? `\x1b[1;34m${e.name}\x1b[0m` : e.name;
                lines.push(`${e.permissions} 1 user user ${formatSize(e.size, showHuman).padStart(5)} Jan 15 10:00 ${colorName}`);
            }
            return lines.join('\n');
        }

        return entries.map(e => {
            return e.type === 'dir' ? `\x1b[1;34m${e.name}\x1b[0m` : e.name;
        }).join('  ');
    };

    // === cat ===
    commands.cat = (args, ctx) => {
        let showNumbers = false;
        const files = [];
        for (const arg of args) {
            if (arg === '-n') showNumbers = true;
            else files.push(arg);
        }

        // Stdin mode (pipe)
        if (files.length === 0 && ctx.stdin) {
            let result = ctx.stdin;
            if (showNumbers) {
                result = result.split('\n').map((line, i) => `     ${i + 1}\t${line}`).join('\n');
            }
            return result;
        }

        if (files.length === 0) return { error: 'cat: missing file operand' };

        const output = [];
        for (const file of files) {
            const content = fs.readFile(file);
            if (content === null) return { error: `cat: ${file}: ${t('no_such_file')}` };
            if (content.error) return { error: `cat: ${file}: ${t(content.error)}` };
            output.push(content);
        }

        let result = output.join('\n');
        if (showNumbers) {
            result = result.split('\n').map((line, i) => `     ${i + 1}\t${line}`).join('\n');
        }
        return result;
    };

    // === echo ===
    commands.echo = (args, ctx) => {
        let noNewline = false;
        let interpretEscapes = false;
        const textArgs = [];

        for (const arg of args) {
            if (arg === '-n') noNewline = true;
            else if (arg === '-e') interpretEscapes = true;
            else textArgs.push(arg);
        }

        let text = textArgs.join(' ');

        // Note: $VAR expansion is already done by shell.expandVars()

        if (interpretEscapes) {
            text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
        }

        return text;
    };

    // === touch ===
    commands.touch = (args, ctx) => {
        if (args.length === 0) return { error: 'touch: missing file operand' };
        for (const file of args) {
            if (!fs.exists(file)) {
                const result = fs.writeFile(file, '');
                if (result.error) return { error: `touch: cannot touch '${file}': ${t(result.error)}` };
            }
        }
        return '';
    };

    // === mkdir ===
    commands.mkdir = (args, ctx) => {
        if (args.length === 0) return { error: 'mkdir: missing operand' };

        let recursive = false;
        const dirs = [];
        for (const arg of args) {
            if (arg === '-p') recursive = true;
            else dirs.push(arg);
        }

        for (const dir of dirs) {
            const result = fs.mkdir(dir, recursive);
            if (result.error) {
                if (result.error === 'file_exists' && recursive) continue;
                return { error: `mkdir: cannot create directory '${dir}': ${t(result.error)}` };
            }
        }
        return '';
    };

    // === rmdir ===
    commands.rmdir = (args, ctx) => {
        if (args.length === 0) return { error: 'rmdir: missing operand' };
        for (const dir of args) {
            if (!fs.exists(dir)) return { error: `rmdir: '${dir}': ${t('no_such_file')}` };
            if (!fs.isDir(dir)) return { error: `rmdir: '${dir}': ${t('not_a_directory')}` };
            const entries = fs.readdir(dir);
            if (entries && entries.length > 0) return { error: `rmdir: '${dir}': ${t('dir_not_empty')}` };
            const result = fs.rm(dir);
            if (result.error) return { error: `rmdir: '${dir}': ${t(result.error)}` };
        }
        return '';
    };

    // === rm ===
    commands.rm = (args, ctx) => {
        if (args.length === 0) return { error: 'rm: missing operand' };

        let recursive = false;
        let force = false;
        const files = [];
        for (const arg of args) {
            if (arg.startsWith('-')) {
                if (arg.includes('r') || arg.includes('R')) recursive = true;
                if (arg.includes('f')) force = true;
            } else {
                files.push(arg);
            }
        }

        for (const file of files) {
            if (!fs.exists(file)) {
                if (!force) return { error: `rm: cannot remove '${file}': ${t('no_such_file')}` };
                continue;
            }
            if (fs.isDir(file) && !recursive) {
                return { error: `rm: cannot remove '${file}': ${t('is_a_directory')}` };
            }
            const result = fs.rm(file, recursive);
            if (result.error) return { error: `rm: cannot remove '${file}': ${t(result.error)}` };
        }
        return '';
    };

    // === cp ===
    commands.cp = (args, ctx) => {
        let recursive = false;
        const paths = [];
        for (const arg of args) {
            if (arg === '-r' || arg === '-R' || arg === '-a') recursive = true;
            else paths.push(arg);
        }

        if (paths.length < 2) return { error: 'cp: missing destination operand' };

        const dst = paths.pop();
        for (const src of paths) {
            const result = fs.cp(src, dst, recursive);
            if (result.error) return { error: `cp: cannot copy '${src}': ${t(result.error)}` };
        }
        return '';
    };

    // === mv ===
    commands.mv = (args, ctx) => {
        const paths = args.filter(a => !a.startsWith('-'));
        if (paths.length < 2) return { error: 'mv: missing destination operand' };

        const dst = paths.pop();
        for (const src of paths) {
            const result = fs.mv(src, dst);
            if (result.error) return { error: `mv: cannot move '${src}': ${t(result.error)}` };
        }
        return '';
    };

    // === head ===
    commands.head = (args, ctx) => {
        let lines = 10;
        const files = [];
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '-n' && args[i + 1]) {
                lines = parseInt(args[++i]);
            } else if (args[i].startsWith('-') && !isNaN(args[i].slice(1))) {
                lines = parseInt(args[i].slice(1));
            } else {
                files.push(args[i]);
            }
        }

        if (files.length === 0 && ctx.stdin) {
            return ctx.stdin.split('\n').slice(0, lines).join('\n');
        }

        if (files.length === 0) return { error: 'head: missing file operand' };

        const output = [];
        for (const file of files) {
            const content = fs.readFile(file);
            if (content === null) return { error: `head: ${file}: ${t('no_such_file')}` };
            if (content.error) return { error: `head: ${file}: ${t(content.error)}` };
            if (files.length > 1) output.push(`==> ${file} <==`);
            output.push(content.split('\n').slice(0, lines).join('\n'));
        }
        return output.join('\n');
    };

    // === tail ===
    commands.tail = (args, ctx) => {
        let lines = 10;
        const files = [];
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '-n' && args[i + 1]) {
                lines = parseInt(args[++i]);
            } else if (args[i].startsWith('-') && !isNaN(args[i].slice(1))) {
                lines = parseInt(args[i].slice(1));
            } else {
                files.push(args[i]);
            }
        }

        if (files.length === 0 && ctx.stdin) {
            const allLines = ctx.stdin.split('\n');
            return allLines.slice(Math.max(0, allLines.length - lines)).join('\n');
        }

        if (files.length === 0) return { error: 'tail: missing file operand' };

        const output = [];
        for (const file of files) {
            const content = fs.readFile(file);
            if (content === null) return { error: `tail: ${file}: ${t('no_such_file')}` };
            if (content.error) return { error: `tail: ${file}: ${t(content.error)}` };
            if (files.length > 1) output.push(`==> ${file} <==`);
            const allLines = content.split('\n');
            output.push(allLines.slice(Math.max(0, allLines.length - lines)).join('\n'));
        }
        return output.join('\n');
    };

    // === wc ===
    commands.wc = (args, ctx) => {
        let countLines = true, countWords = true, countChars = true;
        const files = [];

        for (const arg of args) {
            if (arg.startsWith('-')) {
                countLines = arg.includes('l');
                countWords = arg.includes('w');
                countChars = arg.includes('c') || arg.includes('m');
                if (!countLines && !countWords && !countChars) {
                    countLines = true; countWords = true; countChars = true;
                }
            } else {
                files.push(arg);
            }
        }

        const countContent = (content) => {
            // Count newlines like real wc -l (number of \n characters)
            const l = (content.match(/\n/g) || []).length;
            const w = content.split(/\s+/).filter(s => s).length;
            const c = content.length;
            const parts = [];
            if (countLines) parts.push(String(l).padStart(7));
            if (countWords) parts.push(String(w).padStart(7));
            if (countChars) parts.push(String(c).padStart(7));
            return parts.join(' ');
        };

        if (files.length === 0 && ctx.stdin) {
            return countContent(ctx.stdin);
        }

        if (files.length === 0) return { error: 'wc: missing file operand' };

        const output = [];
        for (const file of files) {
            const content = fs.readFile(file);
            if (content === null) return { error: `wc: ${file}: ${t('no_such_file')}` };
            if (content.error) return { error: `wc: ${file}: ${t(content.error)}` };
            output.push(`${countContent(content)} ${file}`);
        }
        return output.join('\n');
    };

    // === grep ===
    commands.grep = (args, ctx) => {
        let ignoreCase = false;
        let showNumbers = false;
        let countOnly = false;
        let invertMatch = false;
        let recursive = false;
        let pattern = null;
        const files = [];

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg.startsWith('-') && !pattern) {
                if (arg.includes('i')) ignoreCase = true;
                if (arg.includes('n')) showNumbers = true;
                if (arg.includes('c')) countOnly = true;
                if (arg.includes('v')) invertMatch = true;
                if (arg.includes('r') || arg.includes('R')) recursive = true;
            } else if (!pattern) {
                pattern = arg;
            } else {
                files.push(arg);
            }
        }

        if (!pattern) return { error: 'grep: missing pattern' };

        const flags = ignoreCase ? 'i' : '';
        let regex;
        try {
            regex = new RegExp(pattern, flags);
        } catch (e) {
            return { error: `grep: invalid pattern '${pattern}'` };
        }

        const grepContent = (content, filename) => {
            const lines = content.split('\n');
            const results = [];
            let count = 0;

            for (let i = 0; i < lines.length; i++) {
                const match = regex.test(lines[i]);
                if (match !== invertMatch) {
                    count++;
                    if (!countOnly) {
                        let line = lines[i];
                        const prefix = (files.length > 1 || recursive) ? `${filename}:` : '';
                        const numPrefix = showNumbers ? `${i + 1}:` : '';
                        // Highlight matches
                        if (!invertMatch) {
                            line = line.replace(regex, (m) => `\x1b[1;31m${m}\x1b[0m`);
                        }
                        results.push(`${prefix}${numPrefix}${line}`);
                    }
                }
            }

            if (countOnly) return String(count);
            return results.join('\n');
        };

        // Stdin mode
        if (files.length === 0 && ctx.stdin) {
            return grepContent(ctx.stdin, '(stdin)');
        }

        if (files.length === 0 && !recursive) return { error: 'grep: missing file operand' };

        // Recursive mode
        if (recursive) {
            const searchPath = files[0] || '.';
            const foundFiles = fs.find(searchPath, { type: 'f' });
            const output = [];
            for (const f of foundFiles) {
                const content = fs.readFile(f);
                if (content !== null && !content.error) {
                    const result = grepContent(content, f);
                    if (result) output.push(result);
                }
            }
            return output.join('\n');
        }

        const output = [];
        for (const file of files) {
            const content = fs.readFile(file);
            if (content === null) { output.push(`grep: ${file}: ${t('no_such_file')}`); continue; }
            if (content.error) { output.push(`grep: ${file}: ${t(content.error)}`); continue; }
            const result = grepContent(content, file);
            if (result) output.push(result);
        }
        return output.join('\n');
    };

    // === find ===
    commands.find = (args, ctx) => {
        let startPath = '.';
        const options = {};
        let i = 0;

        // First non-flag arg is the path
        if (args.length > 0 && !args[0].startsWith('-')) {
            startPath = args[0];
            i = 1;
        }

        while (i < args.length) {
            if (args[i] === '-name' && args[i + 1]) {
                options.name = args[++i];
            } else if (args[i] === '-type' && args[i + 1]) {
                options.type = args[++i];
            }
            i++;
        }

        const results = fs.find(startPath, options);
        return results.join('\n');
    };

    // === sort ===
    commands.sort = (args, ctx) => {
        let reverse = false;
        let numeric = false;
        let unique = false;
        const files = [];

        for (const arg of args) {
            if (arg === '-r') reverse = true;
            else if (arg === '-n') numeric = true;
            else if (arg === '-u') unique = true;
            else files.push(arg);
        }

        let content;
        if (files.length > 0) {
            const fileContent = fs.readFile(files[0]);
            if (fileContent === null) return { error: `sort: ${files[0]}: ${t('no_such_file')}` };
            if (fileContent.error) return { error: `sort: ${files[0]}: ${t(fileContent.error)}` };
            content = fileContent;
        } else if (ctx.stdin) {
            content = ctx.stdin;
        } else {
            return '';
        }

        let lines = content.split('\n');
        if (numeric) {
            lines.sort((a, b) => parseFloat(a) - parseFloat(b));
        } else {
            lines.sort();
        }
        if (reverse) lines.reverse();
        if (unique) lines = [...new Set(lines)];
        return lines.join('\n');
    };

    // === uniq ===
    commands.uniq = (args, ctx) => {
        let countMode = false;
        let dupOnly = false;
        const files = [];

        for (const arg of args) {
            if (arg === '-c') countMode = true;
            else if (arg === '-d') dupOnly = true;
            else files.push(arg);
        }

        let content;
        if (files.length > 0) {
            const c = fs.readFile(files[0]);
            if (c === null || c.error) return { error: `uniq: ${files[0]}: ${t('no_such_file')}` };
            content = c;
        } else if (ctx.stdin) {
            content = ctx.stdin;
        } else {
            return '';
        }

        const lines = content.split('\n');
        const result = [];
        let prev = null;
        let count = 0;

        for (const line of lines) {
            if (line === prev) {
                count++;
            } else {
                if (prev !== null) {
                    if (!dupOnly || count > 1) {
                        result.push(countMode ? `${String(count).padStart(7)} ${prev}` : prev);
                    }
                }
                prev = line;
                count = 1;
            }
        }
        if (prev !== null && (!dupOnly || count > 1)) {
            result.push(countMode ? `${String(count).padStart(7)} ${prev}` : prev);
        }
        return result.join('\n');
    };

    // === sed ===
    commands.sed = (args, ctx) => {
        if (args.length === 0) return { error: 'sed: missing expression' };

        const expression = args[0];
        const files = args.slice(1);

        // Parse s/pattern/replacement/flags
        const match = expression.match(/^s(.)(.+?)\1(.*?)\1([gi]*)$/);
        if (!match) return { error: `sed: invalid expression '${expression}'` };

        const [, , pattern, replacement, flags] = match;
        const regex = new RegExp(pattern, flags.includes('g') ? 'g' + (flags.includes('i') ? 'i' : '') : (flags.includes('i') ? 'i' : ''));

        let content;
        if (files.length > 0) {
            const c = fs.readFile(files[0]);
            if (c === null || c.error) return { error: `sed: ${files[0]}: ${t('no_such_file')}` };
            content = c;
        } else if (ctx.stdin) {
            content = ctx.stdin;
        } else {
            return '';
        }

        return content.split('\n').map(line => line.replace(regex, replacement)).join('\n');
    };

    // === awk ===
    commands.awk = (args, ctx) => {
        if (args.length === 0) return { error: "awk: missing program" };

        const program = args[0];
        const files = args.slice(1);

        let content;
        if (files.length > 0) {
            const c = fs.readFile(files[0]);
            if (c === null || c.error) return { error: `awk: ${files[0]}: ${t('no_such_file')}` };
            content = c;
        } else if (ctx.stdin) {
            content = ctx.stdin;
        } else {
            return '';
        }

        // Simple awk: support {print $N} and /pattern/{print $N}
        const printMatch = program.match(/^\{print\s+(.+)\}$/);
        const patternPrint = program.match(/^\/(.+?)\/\s*\{print\s+(.+)\}$/);

        const lines = content.split('\n');
        const output = [];

        for (const line of lines) {
            const fields = line.split(/\s+/);
            fields.unshift(line); // $0 = whole line

            let patternOk = true;
            let printExpr;

            if (patternPrint) {
                const regex = new RegExp(patternPrint[1]);
                patternOk = regex.test(line);
                printExpr = patternPrint[2];
            } else if (printMatch) {
                printExpr = printMatch[1];
            } else {
                output.push(line);
                continue;
            }

            if (patternOk && printExpr) {
                const parts = printExpr.split(',').map(p => p.trim());
                const outParts = parts.map(p => {
                    const fieldMatch = p.match(/^\$(\d+)$/);
                    if (fieldMatch) return fields[parseInt(fieldMatch[1])] || '';
                    // String literal
                    const strMatch = p.match(/^"(.*)"$/);
                    if (strMatch) return strMatch[1];
                    return p;
                });
                output.push(outParts.join(' '));
            }
        }
        return output.join('\n');
    };

    // === whoami ===
    commands.whoami = () => 'user';

    // === hostname ===
    commands.hostname = () => 'ubuntu';

    // === date ===
    commands.date = () => {
        return new Date().toString();
    };

    // === uname ===
    commands.uname = (args) => {
        if (args.includes('-a')) {
            return 'Linux ubuntu 5.15.0-91-generic #101-Ubuntu SMP x86_64 GNU/Linux';
        }
        if (args.includes('-r')) return '5.15.0-91-generic';
        if (args.includes('-s')) return 'Linux';
        if (args.includes('-m')) return 'x86_64';
        return 'Linux';
    };

    // === clear ===
    commands.clear = (args, ctx) => {
        if (ctx.terminal) ctx.terminal.clear();
        return '';
    };

    // === ps ===
    commands.ps = (args) => {
        const showAll = args.includes('-e') || args.includes('-A') || args.includes('aux');
        const allProcs = [...mockProcesses, ...userProcesses];
        const procs = showAll ? allProcs : allProcs.filter(p => p.user === 'user');

        if (args.includes('aux') || args.includes('-ef')) {
            const header = 'USER       PID %CPU %MEM COMMAND';
            const lines = procs.map(p =>
                `${p.user.padEnd(10)} ${String(p.pid).padStart(4)} ${p.cpu.padStart(4)} ${p.mem.padStart(4)} ${p.command}`
            );
            return [header, ...lines].join('\n');
        }

        const header = '  PID TTY          TIME CMD';
        const lines = procs.map(p => `${String(p.pid).padStart(5)} pts/0    00:00:00 ${p.command.split('/').pop().split(' ')[0]}`);
        return [header, ...lines].join('\n');
    };

    // === kill ===
    commands.kill = (args) => {
        const pids = args.filter(a => !a.startsWith('-')).map(Number);
        for (const pid of pids) {
            const idx = userProcesses.findIndex(p => p.pid === pid);
            if (idx !== -1) {
                userProcesses.splice(idx, 1);
            } else if (mockProcesses.find(p => p.pid === pid)) {
                return { error: `kill: (${pid}): Operation not permitted` };
            } else {
                return { error: `kill: (${pid}): No such process` };
            }
        }
        return '';
    };

    // === top ===
    commands.top = (args, ctx) => {
        const allProcs = [...mockProcesses, ...userProcesses];
        const header = [
            `top - ${new Date().toLocaleTimeString()} up 2:34, 1 user, load average: 0.15, 0.10, 0.05`,
            `Tasks: ${allProcs.length} total, 1 running, ${allProcs.length - 1} sleeping`,
            `%Cpu(s): 1.5 us, 0.8 sy, 0.0 ni, 97.2 id, 0.5 wa`,
            `MiB Mem:  16000.0 total,  8000.0 free,  4000.0 used,  4000.0 buff/cache`,
            ``,
            `  PID USER      %CPU %MEM COMMAND`,
        ];
        const lines = allProcs.slice(0, 15).map(p =>
            `${String(p.pid).padStart(5)} ${p.user.padEnd(9)} ${p.cpu.padStart(5)} ${p.mem.padStart(5)} ${p.command}`
        );
        return [...header, ...lines].join('\n') + '\n\n(Press q to quit - simulated snapshot)';
    };

    // === chmod ===
    commands.chmod = (args, ctx) => {
        let recursive = false;
        const realArgs = [];
        for (const arg of args) {
            if (arg === '-R') recursive = true;
            else realArgs.push(arg);
        }

        if (realArgs.length < 2) return { error: 'chmod: missing operand' };
        const mode = realArgs[0];
        const targets = realArgs.slice(1);

        for (const target of targets) {
            if (!fs.exists(target)) return { error: `chmod: cannot access '${target}': ${t('no_such_file')}` };
            const result = fs.chmod(target, mode);
            if (result.error) return { error: `chmod: '${target}': ${t(result.error)}` };

            if (recursive && fs.isDir(target)) {
                const files = fs.find(target, {});
                for (const f of files) {
                    fs.chmod(f, mode);
                }
            }
        }
        return '';
    };

    // === sudo ===
    commands.sudo = (args, ctx) => {
        if (args.length === 0) return { error: 'sudo: missing command' };
        // Just run the command as-is (simulated)
        const cmd = args[0];
        const cmdArgs = args.slice(1);
        if (commands[cmd]) {
            return commands[cmd](cmdArgs, { ...ctx, sudo: true });
        }
        return { error: `sudo: ${cmd}: ${t('cmd_not_found')}` };
    };

    // === apt ===
    commands.apt = (args, ctx) => {
        if (!ctx.sudo && args[0] !== 'list' && args[0] !== 'search') {
            return { error: 'E: Could not open lock file - open (13: Permission denied)\nE: Are you root?' };
        }

        const subcommand = args[0];
        const packages = args.slice(1).filter(a => !a.startsWith('-'));

        switch (subcommand) {
            case 'update':
                return 'Hit:1 http://archive.ubuntu.com/ubuntu jammy InRelease\nHit:2 http://archive.ubuntu.com/ubuntu jammy-updates InRelease\nReading package lists... Done\nBuilding dependency tree... Done\nAll packages are up to date.';

            case 'install':
                if (packages.length === 0) return { error: 'E: No packages specified' };
                const output = [];
                for (const pkg of packages) {
                    if (installedPackages.has(pkg)) {
                        output.push(`${pkg} is already the newest version.`);
                    } else if (availablePackages.has(pkg)) {
                        installedPackages.add(pkg);
                        output.push(`Installing ${pkg}...`);
                        output.push(`Setting up ${pkg} ... Done.`);
                    } else {
                        output.push(`E: Unable to locate package ${pkg}`);
                    }
                }
                return output.join('\n');

            case 'remove':
                if (packages.length === 0) return { error: 'E: No packages specified' };
                for (const pkg of packages) {
                    if (installedPackages.has(pkg)) {
                        installedPackages.delete(pkg);
                    }
                }
                return `Removing ${packages.join(', ')}... Done.`;

            case 'list':
                if (args.includes('--installed')) {
                    return [...installedPackages].sort().map(p => `${p}/jammy,now installed`).join('\n');
                }
                return [...installedPackages, ...availablePackages].sort().map(p =>
                    `${p}/jammy ${installedPackages.has(p) ? '[installed]' : ''}`
                ).join('\n');

            case 'search':
                if (packages.length === 0) return { error: 'E: No search term specified' };
                const all = [...installedPackages, ...availablePackages];
                const matches = all.filter(p => p.includes(packages[0]));
                return matches.length > 0 ? matches.join('\n') : 'No packages found.';

            default:
                return { error: `E: Invalid operation '${subcommand}'` };
        }
    };

    // === curl ===
    commands.curl = (args) => {
        const url = args.find(a => !a.startsWith('-'));
        if (!url) return { error: 'curl: no URL specified' };
        return `<!DOCTYPE html>\n<html><body>\n<h1>Simulated response from ${url}</h1>\n<p>This is a mock response. Real network requests are not available in the simulator.</p>\n</body></html>`;
    };

    // === tar ===
    commands.tar = (args) => {
        const flags = args[0] || '';
        const files = args.slice(1).filter(a => !a.startsWith('-'));

        if (flags.includes('c')) {
            return `tar: creating archive with ${files.length} file(s) (simulated)`;
        }
        if (flags.includes('x')) {
            return `tar: extracting archive (simulated)`;
        }
        if (flags.includes('t')) {
            return 'file1.txt\nfile2.txt\ndir/\ndir/file3.txt';
        }
        return { error: 'tar: You must specify one of the -c, -t, -x options' };
    };

    // === man ===
    commands.man = (args) => {
        if (args.length === 0) return 'What manual page do you want?\nFor example, try \'man ls\'';

        const manPages = {
            ls: 'LS(1)\n\nNAME\n    ls - list directory contents\n\nSYNOPSIS\n    ls [OPTION]... [FILE]...\n\nOPTIONS\n    -a    do not ignore entries starting with .\n    -l    use a long listing format\n    -h    with -l, print human readable sizes',
            cd: 'CD(1)\n\nNAME\n    cd - change the working directory\n\nSYNOPSIS\n    cd [DIR]\n\nDESCRIPTION\n    Change the current directory to DIR.\n    The default DIR is $HOME.',
            pwd: 'PWD(1)\n\nNAME\n    pwd - print name of current/working directory\n\nSYNOPSIS\n    pwd\n\nDESCRIPTION\n    Print the full filename of the current working directory.',
            mkdir: 'MKDIR(1)\n\nNAME\n    mkdir - make directories\n\nSYNOPSIS\n    mkdir [OPTION]... DIRECTORY...\n\nOPTIONS\n    -p    make parent directories as needed',
            rm: 'RM(1)\n\nNAME\n    rm - remove files or directories\n\nSYNOPSIS\n    rm [OPTION]... FILE...\n\nOPTIONS\n    -r, -R    remove directories and their contents recursively\n    -f        ignore nonexistent files',
            cp: 'CP(1)\n\nNAME\n    cp - copy files and directories\n\nSYNOPSIS\n    cp [OPTION]... SOURCE DEST\n\nOPTIONS\n    -r, -R    copy directories recursively',
            mv: 'MV(1)\n\nNAME\n    mv - move (rename) files\n\nSYNOPSIS\n    mv [OPTION]... SOURCE DEST',
            cat: 'CAT(1)\n\nNAME\n    cat - concatenate files and print on the standard output\n\nSYNOPSIS\n    cat [OPTION]... [FILE]...\n\nOPTIONS\n    -n    number all output lines',
            grep: 'GREP(1)\n\nNAME\n    grep - print lines that match patterns\n\nSYNOPSIS\n    grep [OPTION]... PATTERN [FILE]...\n\nOPTIONS\n    -i    ignore case\n    -n    show line numbers\n    -r    recursive search\n    -c    count matches\n    -v    invert match',
            find: 'FIND(1)\n\nNAME\n    find - search for files in a directory hierarchy\n\nSYNOPSIS\n    find [path] [expression]\n\nEXPRESSIONS\n    -name pattern    match filename pattern\n    -type c          file type (f=file, d=directory)',
            chmod: 'CHMOD(1)\n\nNAME\n    chmod - change file mode bits\n\nSYNOPSIS\n    chmod [OPTION]... MODE FILE...\n\nDESCRIPTION\n    Change the file mode (permissions).\n    MODE is an octal number (e.g., 755, 644).\n\nOPTIONS\n    -R    operate recursively',
            echo: 'ECHO(1)\n\nNAME\n    echo - display a line of text\n\nSYNOPSIS\n    echo [OPTION]... [STRING]...\n\nOPTIONS\n    -n    do not output trailing newline\n    -e    enable backslash escapes',
            touch: 'TOUCH(1)\n\nNAME\n    touch - change file timestamps / create empty files\n\nSYNOPSIS\n    touch FILE...',
            head: 'HEAD(1)\n\nNAME\n    head - output the first part of files\n\nSYNOPSIS\n    head [OPTION]... [FILE]...\n\nOPTIONS\n    -n N    output the first N lines',
            tail: 'TAIL(1)\n\nNAME\n    tail - output the last part of files\n\nSYNOPSIS\n    tail [OPTION]... [FILE]...\n\nOPTIONS\n    -n N    output the last N lines',
            wc: 'WC(1)\n\nNAME\n    wc - word, line, character count\n\nSYNOPSIS\n    wc [OPTION]... [FILE]...\n\nOPTIONS\n    -l    count lines\n    -w    count words\n    -c    count characters',
            sed: 'SED(1)\n\nNAME\n    sed - stream editor\n\nSYNOPSIS\n    sed EXPRESSION [FILE]\n\nDESCRIPTION\n    Substitute: s/pattern/replacement/flags\n    Flags: g (global), i (case insensitive)',
            awk: 'AWK(1)\n\nNAME\n    awk - pattern scanning and text processing\n\nSYNOPSIS\n    awk PROGRAM [FILE]\n\nDESCRIPTION\n    Fields: $0 (whole line), $1, $2, ...\n    Example: awk \'{print $1}\'',
            sort: 'SORT(1)\n\nNAME\n    sort - sort lines of text\n\nSYNOPSIS\n    sort [OPTION]... [FILE]...\n\nOPTIONS\n    -r    reverse\n    -n    numeric sort\n    -u    unique',
            ps: 'PS(1)\n\nNAME\n    ps - report a snapshot of current processes\n\nSYNOPSIS\n    ps [OPTIONS]\n\nOPTIONS\n    -e, -A    select all processes\n    aux       show all with details',
            ln: 'LN(1)\n\nNAME\n    ln - make links between files\n\nSYNOPSIS\n    ln -s TARGET LINK_NAME\n\nOPTIONS\n    -s    make symbolic link',
            tee: 'TEE(1)\n\nNAME\n    tee - read from stdin, write to stdout and files\n\nSYNOPSIS\n    tee [OPTION]... [FILE]...\n\nOPTIONS\n    -a    append to files instead of overwriting',
            cut: 'CUT(1)\n\nNAME\n    cut - remove sections from each line of files\n\nSYNOPSIS\n    cut -d DELIMITER -f FIELDS [FILE]...\n\nOPTIONS\n    -d    use DELIMITER instead of TAB\n    -f    select only these fields (comma-separated)',
            tr: 'TR(1)\n\nNAME\n    tr - translate or delete characters\n\nSYNOPSIS\n    tr [OPTION] SET1 [SET2]\n\nOPTIONS\n    -d    delete characters in SET1\n\nEXAMPLES\n    tr \'a-z\' \'A-Z\'     convert to uppercase\n    tr -d \' \'          delete spaces',
            diff: 'DIFF(1)\n\nNAME\n    diff - compare files line by line\n\nSYNOPSIS\n    diff FILE1 FILE2\n\nDESCRIPTION\n    Show differences between two files.\n    - lines are from FILE1, + lines are from FILE2.',
            env: 'ENV(1)\n\nNAME\n    env - print environment variables\n\nSYNOPSIS\n    env\n\nDESCRIPTION\n    Display all environment variables.',
            which: 'WHICH(1)\n\nNAME\n    which - locate a command\n\nSYNOPSIS\n    which COMMAND...\n\nDESCRIPTION\n    Show the full path of commands.',
            basename: 'BASENAME(1)\n\nNAME\n    basename - strip directory and suffix from filenames\n\nSYNOPSIS\n    basename NAME [SUFFIX]\n\nEXAMPLES\n    basename /usr/bin/sort     → sort\n    basename file.txt .txt     → file',
            dirname: 'DIRNAME(1)\n\nNAME\n    dirname - strip last component from file name\n\nSYNOPSIS\n    dirname NAME\n\nEXAMPLES\n    dirname /usr/bin/sort      → /usr/bin',
            seq: 'SEQ(1)\n\nNAME\n    seq - print a sequence of numbers\n\nSYNOPSIS\n    seq [FIRST [INCREMENT]] LAST\n\nEXAMPLES\n    seq 5            → 1 2 3 4 5\n    seq 2 5          → 2 3 4 5\n    seq 1 2 10       → 1 3 5 7 9',
            uniq: 'UNIQ(1)\n\nNAME\n    uniq - report or omit repeated lines\n\nSYNOPSIS\n    uniq [OPTION]... [FILE]\n\nOPTIONS\n    -c    prefix lines by the number of occurrences\n    -d    only print duplicate lines',
        };

        const page = manPages[args[0]];
        if (page) return page;
        return `No manual entry for ${args[0]}`;
    };

    // === help ===
    commands.help = () => {
        return [
            'Available commands:',
            '',
            '\x1b[1;33mNavigation & Files:\x1b[0m',
            '  ls       List directory contents',
            '  cd       Change directory',
            '  pwd      Print working directory',
            '  mkdir    Create directory',
            '  rmdir    Remove empty directory',
            '  touch    Create empty file',
            '  rm       Remove files/directories',
            '  cp       Copy files',
            '  mv       Move/rename files',
            '  cat      Display file contents',
            '  echo     Display text',
            '  head     Show first lines',
            '  tail     Show last lines',
            '  wc       Word/line count',
            '  ln       Create symbolic links',
            '  diff     Compare files',
            '',
            '\x1b[1;33mSearch & Text Processing:\x1b[0m',
            '  grep     Search text patterns',
            '  find     Search for files',
            '  sed      Stream editor',
            '  awk      Text processing',
            '  sort     Sort lines',
            '  uniq     Remove duplicates',
            '  cut      Extract columns/fields',
            '  tr       Translate characters',
            '  tee      Write to stdout and files',
            '',
            '\x1b[1;33mSystem:\x1b[0m',
            '  ps       Show processes',
            '  kill     Terminate process',
            '  top      System monitor',
            '  whoami   Current user',
            '  hostname Show hostname',
            '  date     Show date/time',
            '  uname    System information',
            '  clear    Clear terminal',
            '  env      Show environment variables',
            '  which    Locate a command',
            '',
            '\x1b[1;33mOther:\x1b[0m',
            '  chmod    Change permissions',
            '  sudo     Run as superuser',
            '  apt      Package manager',
            '  curl     Transfer URL data',
            '  tar      Archive utility',
            '  man      Manual pages',
            '  help     Show this help',
            '  history  Show command history',
            '  export   Set environment variable',
            '  basename Strip directory from path',
            '  dirname  Strip filename from path',
            '  seq      Generate number sequences',
        ].join('\n');
    };

    // === history ===
    commands.history = (args, ctx) => {
        if (!ctx.history) return '';
        return ctx.history.map((cmd, i) => `  ${String(i + 1).padStart(4)}  ${cmd}`).join('\n');
    };

    // === export ===
    commands.export = (args, ctx) => {
        for (const arg of args) {
            const eqIdx = arg.indexOf('=');
            if (eqIdx !== -1) {
                const name = arg.slice(0, eqIdx);
                const value = arg.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
                ctx.env[name] = value;
            }
        }
        return '';
    };

    // === ln ===
    commands.ln = (args, ctx) => {
        let symbolic = false;
        const paths = [];
        for (const arg of args) {
            if (arg === '-s') symbolic = true;
            else paths.push(arg);
        }

        if (!symbolic) {
            return { error: 'ln: hard links not supported in simulator' };
        }

        if (paths.length < 2) return { error: 'ln: missing operand' };

        const target = paths[0];
        const linkname = paths[1];

        const result = fs.writeFile(linkname, `-> ${target}`);
        if (result && result.error) return { error: `ln: failed to create symbolic link '${linkname}': ${t(result.error)}` };
        return '';
    };

    // === tee ===
    commands.tee = (args, ctx) => {
        let append = false;
        const files = [];
        for (const arg of args) {
            if (arg === '-a') append = true;
            else files.push(arg);
        }

        const input = ctx.stdin || '';

        for (const file of files) {
            if (append) {
                fs.appendFile(file, input);
            } else {
                fs.writeFile(file, input);
            }
        }

        return input;
    };

    // === cut ===
    commands.cut = (args, ctx) => {
        let delimiter = '\t';
        let fields = null;
        const files = [];

        for (let i = 0; i < args.length; i++) {
            if (args[i] === '-d' && args[i + 1] !== undefined) {
                delimiter = args[++i];
            } else if (args[i].startsWith('-d')) {
                delimiter = args[i].slice(2);
            } else if (args[i] === '-f' && args[i + 1] !== undefined) {
                fields = args[++i];
            } else if (args[i].startsWith('-f')) {
                fields = args[i].slice(2);
            } else {
                files.push(args[i]);
            }
        }

        if (!fields) return { error: 'cut: you must specify a list of fields' };

        const fieldNums = fields.split(',').map(f => parseInt(f)).filter(n => !isNaN(n));

        const cutLine = (line) => {
            const parts = line.split(delimiter);
            return fieldNums.map(f => parts[f - 1] || '').join(delimiter);
        };

        let content;
        if (files.length > 0) {
            const c = fs.readFile(files[0]);
            if (c === null) return { error: `cut: ${files[0]}: ${t('no_such_file')}` };
            if (c.error) return { error: `cut: ${files[0]}: ${t(c.error)}` };
            content = c;
        } else if (ctx.stdin) {
            content = ctx.stdin;
        } else {
            return '';
        }

        return content.split('\n').map(cutLine).join('\n');
    };

    // === tr ===
    commands.tr = (args, ctx) => {
        let deleteMode = false;
        const sets = [];
        for (const arg of args) {
            if (arg === '-d') deleteMode = true;
            else sets.push(arg);
        }

        const input = ctx.stdin || '';

        const expandRange = (s) => {
            let result = '';
            for (let i = 0; i < s.length; i++) {
                if (i + 2 < s.length && s[i + 1] === '-') {
                    const start = s.charCodeAt(i);
                    const end = s.charCodeAt(i + 2);
                    for (let c = start; c <= end; c++) {
                        result += String.fromCharCode(c);
                    }
                    i += 2;
                } else {
                    result += s[i];
                }
            }
            return result;
        };

        if (deleteMode) {
            if (sets.length < 1) return { error: 'tr: missing operand' };
            const delChars = expandRange(sets[0]);
            let output = '';
            for (const ch of input) {
                if (!delChars.includes(ch)) output += ch;
            }
            return output;
        }

        if (sets.length < 2) return { error: 'tr: missing operand' };
        const set1 = expandRange(sets[0]);
        const set2 = expandRange(sets[1]);

        let output = '';
        for (const ch of input) {
            const idx = set1.indexOf(ch);
            if (idx !== -1) {
                output += set2[Math.min(idx, set2.length - 1)] || ch;
            } else {
                output += ch;
            }
        }
        return output;
    };

    // === diff ===
    commands.diff = (args, ctx) => {
        const files = args.filter(a => !a.startsWith('-'));
        if (files.length < 2) return { error: 'diff: missing operand' };

        const content1 = fs.readFile(files[0]);
        if (content1 === null) return { error: `diff: ${files[0]}: ${t('no_such_file')}` };
        if (content1.error) return { error: `diff: ${files[0]}: ${t(content1.error)}` };

        const content2 = fs.readFile(files[1]);
        if (content2 === null) return { error: `diff: ${files[1]}: ${t('no_such_file')}` };
        if (content2.error) return { error: `diff: ${files[1]}: ${t(content2.error)}` };

        const lines1 = content1.split('\n');
        const lines2 = content2.split('\n');

        if (content1 === content2) return '';

        const output = [];
        output.push(`--- ${files[0]}`);
        output.push(`+++ ${files[1]}`);

        const maxLen = Math.max(lines1.length, lines2.length);
        let inHunk = false;
        let hunkStart = -1;
        let hunkLines = [];

        for (let i = 0; i < maxLen; i++) {
            const l1 = i < lines1.length ? lines1[i] : undefined;
            const l2 = i < lines2.length ? lines2[i] : undefined;

            if (l1 !== l2) {
                if (!inHunk) {
                    inHunk = true;
                    hunkStart = i;
                    hunkLines = [];
                }
                if (l1 !== undefined) hunkLines.push(`-${l1}`);
                if (l2 !== undefined) hunkLines.push(`+${l2}`);
            } else {
                if (inHunk) {
                    output.push(`@@ -${hunkStart + 1},${lines1.length} +${hunkStart + 1},${lines2.length} @@`);
                    output.push(...hunkLines);
                    inHunk = false;
                }
                if (l1 !== undefined) {
                    // context line (not shown in basic diff to keep output concise)
                }
            }
        }

        if (inHunk) {
            output.push(`@@ -${hunkStart + 1},${lines1.length} +${hunkStart + 1},${lines2.length} @@`);
            output.push(...hunkLines);
        }

        return output.join('\n');
    };

    // === env ===
    commands.env = (args, ctx) => {
        const defaults = {
            HOME: '/home/user',
            USER: 'user',
            SHELL: '/bin/bash',
            PWD: fs.cwd,
            LANG: 'en_US.UTF-8',
            PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        };

        const merged = { ...defaults, ...(ctx.env || {}) };
        return Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n');
    };

    // === which ===
    commands.which = (args, ctx) => {
        if (args.length === 0) return { error: 'which: missing operand' };

        const output = [];
        for (const name of args) {
            if (commands[name]) {
                output.push(`/usr/bin/${name}`);
            } else {
                output.push(`which: no ${name} in PATH`);
            }
        }
        return output.join('\n');
    };

    // === basename ===
    commands.basename = (args, ctx) => {
        if (args.length === 0) return { error: 'basename: missing operand' };

        let path = args[0];
        const suffix = args[1] || '';

        // Remove trailing slashes
        path = path.replace(/\/+$/, '');

        let base = path.split('/').pop() || '/';

        if (suffix && base.endsWith(suffix)) {
            base = base.slice(0, base.length - suffix.length);
        }

        return base;
    };

    // === dirname ===
    commands.dirname = (args, ctx) => {
        if (args.length === 0) return { error: 'dirname: missing operand' };

        let path = args[0];

        // Remove trailing slashes
        path = path.replace(/\/+$/, '');

        const lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return '.';
        if (lastSlash === 0) return '/';
        return path.slice(0, lastSlash);
    };

    // === seq ===
    commands.seq = (args, ctx) => {
        if (args.length === 0) return { error: 'seq: missing operand' };

        let first, increment, last;

        const nums = args.map(Number);
        if (nums.some(isNaN)) return { error: 'seq: invalid argument' };

        if (nums.length === 1) {
            first = 1;
            increment = 1;
            last = nums[0];
        } else if (nums.length === 2) {
            first = nums[0];
            increment = 1;
            last = nums[1];
        } else {
            first = nums[0];
            increment = nums[1];
            last = nums[2];
        }

        if (increment === 0) return { error: 'seq: zero increment' };

        const result = [];
        if (increment > 0) {
            for (let i = first; i <= last; i += increment) {
                result.push(String(i));
            }
        } else {
            for (let i = first; i >= last; i += increment) {
                result.push(String(i));
            }
        }

        return result.join('\n');
    };

    return commands;
}

function formatSize(bytes, human) {
    if (!human) return String(bytes);
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
    return (bytes / (1024 * 1024)).toFixed(1) + 'M';
}
