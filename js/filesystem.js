// === Virtual In-Memory Filesystem ===

let defaultFsData = null;

export async function loadDefaultFS() {
    const res = await fetch('data/default-fs.json');
    defaultFsData = await res.json();
}

export class VirtualFS {
    constructor() {
        this.root = null;
        this.cwd = '/home/user';
        this.reset();
    }

    reset() {
        this.root = JSON.parse(JSON.stringify(defaultFsData['/']));
        this.cwd = '/home/user';
    }

    // Normalize path: resolve ., .., ~, relative paths
    resolve(path) {
        if (!path) return this.cwd;
        if (path === '~' || path === '$HOME') return '/home/user';
        if (path.startsWith('~/')) path = '/home/user/' + path.slice(2);
        if (path.startsWith('$HOME/')) path = '/home/user/' + path.slice(6);
        if (!path.startsWith('/')) path = this.cwd + '/' + path;

        const parts = path.split('/').filter(p => p !== '');
        const resolved = [];
        for (const part of parts) {
            if (part === '.') continue;
            if (part === '..') {
                resolved.pop();
            } else {
                resolved.push(part);
            }
        }
        return '/' + resolved.join('/');
    }

    // Get node at path
    _getNode(path) {
        const resolved = this.resolve(path);
        if (resolved === '/') return this.root;

        const parts = resolved.split('/').filter(p => p !== '');
        let node = this.root;
        for (const part of parts) {
            if (!node || node.type !== 'dir' || !node.children || !(part in node.children)) {
                return null;
            }
            node = node.children[part];
        }
        return node;
    }

    // Get parent node and entry name
    _getParent(path) {
        const resolved = this.resolve(path);
        const parts = resolved.split('/').filter(p => p !== '');
        if (parts.length === 0) return { parent: null, name: '' };

        const name = parts.pop();
        const parentPath = '/' + parts.join('/');
        const parent = parts.length === 0 ? this.root : this._getNode(parentPath);
        return { parent, name };
    }

    exists(path) {
        return this._getNode(path) !== null;
    }

    isDir(path) {
        const node = this._getNode(path);
        return node !== null && node.type === 'dir';
    }

    isFile(path) {
        const node = this._getNode(path);
        return node !== null && node.type === 'file';
    }

    stat(path) {
        const node = this._getNode(path);
        if (!node) return null;
        return {
            type: node.type,
            permissions: node.permissions || (node.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--'),
            size: node.type === 'file' ? (node.content || '').length : 4096,
        };
    }

    readdir(path) {
        const node = this._getNode(path);
        if (!node || node.type !== 'dir') return null;
        return Object.keys(node.children || {});
    }

    readdirWithTypes(path) {
        const node = this._getNode(path);
        if (!node || node.type !== 'dir') return null;
        const entries = [];
        for (const [name, child] of Object.entries(node.children || {})) {
            entries.push({
                name,
                type: child.type,
                permissions: child.permissions || (child.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--'),
                size: child.type === 'file' ? (child.content || '').length : 4096,
            });
        }
        return entries;
    }

    readFile(path) {
        const node = this._getNode(path);
        if (!node) return null;
        if (node.type === 'dir') return { error: 'is_a_directory' };
        return node.content || '';
    }

    writeFile(path, content) {
        const { parent, name } = this._getParent(path);
        if (!parent || parent.type !== 'dir') return { error: 'no_such_file' };

        if (parent.children[name] && parent.children[name].type === 'dir') {
            return { error: 'is_a_directory' };
        }

        parent.children[name] = {
            type: 'file',
            permissions: parent.children[name]?.permissions || '-rw-r--r--',
            content: content,
        };
        return true;
    }

    appendFile(path, content) {
        const node = this._getNode(path);
        if (!node) {
            return this.writeFile(path, content);
        }
        if (node.type === 'dir') return { error: 'is_a_directory' };
        node.content = (node.content || '') + content;
        return true;
    }

    mkdir(path, recursive = false) {
        const resolved = this.resolve(path);
        if (this.exists(resolved)) return { error: 'file_exists' };

        if (recursive) {
            const parts = resolved.split('/').filter(p => p !== '');
            let current = this.root;
            for (const part of parts) {
                if (!current.children) current.children = {};
                if (!current.children[part]) {
                    current.children[part] = {
                        type: 'dir',
                        permissions: 'drwxr-xr-x',
                        children: {},
                    };
                }
                current = current.children[part];
                if (current.type !== 'dir') return { error: 'not_a_directory' };
            }
            return true;
        }

        const { parent, name } = this._getParent(resolved);
        if (!parent || parent.type !== 'dir') return { error: 'no_such_file' };
        if (parent.children[name]) return { error: 'file_exists' };

        parent.children[name] = {
            type: 'dir',
            permissions: 'drwxr-xr-x',
            children: {},
        };
        return true;
    }

    rm(path, recursive = false) {
        const resolved = this.resolve(path);
        if (resolved === '/') return { error: 'permission_denied' };

        const node = this._getNode(resolved);
        if (!node) return { error: 'no_such_file' };

        if (node.type === 'dir' && !recursive) {
            if (Object.keys(node.children || {}).length > 0) {
                return { error: 'dir_not_empty' };
            }
        }

        const { parent, name } = this._getParent(resolved);
        if (!parent) return { error: 'permission_denied' };
        delete parent.children[name];
        return true;
    }

    cp(src, dst, recursive = false) {
        const srcNode = this._getNode(src);
        if (!srcNode) return { error: 'no_such_file' };
        if (srcNode.type === 'dir' && !recursive) return { error: 'is_a_directory' };

        const copy = JSON.parse(JSON.stringify(srcNode));
        const dstResolved = this.resolve(dst);
        const dstNode = this._getNode(dst);

        // If dst is a directory, copy into it with same name
        if (dstNode && dstNode.type === 'dir') {
            const srcParts = this.resolve(src).split('/').filter(p => p !== '');
            const name = srcParts[srcParts.length - 1];
            dstNode.children[name] = copy;
            return true;
        }

        const { parent, name } = this._getParent(dstResolved);
        if (!parent || parent.type !== 'dir') return { error: 'no_such_file' };
        parent.children[name] = copy;
        return true;
    }

    mv(src, dst) {
        const srcResolved = this.resolve(src);
        const srcNode = this._getNode(src);
        if (!srcNode) return { error: 'no_such_file' };

        const copy = JSON.parse(JSON.stringify(srcNode));
        const dstNode = this._getNode(dst);
        const dstResolved = this.resolve(dst);

        // If dst is a directory, move into it
        if (dstNode && dstNode.type === 'dir') {
            const srcParts = srcResolved.split('/').filter(p => p !== '');
            const name = srcParts[srcParts.length - 1];
            dstNode.children[name] = copy;
        } else {
            const { parent, name } = this._getParent(dstResolved);
            if (!parent || parent.type !== 'dir') return { error: 'no_such_file' };
            parent.children[name] = copy;
        }

        // Remove source
        const { parent: srcParent, name: srcName } = this._getParent(srcResolved);
        delete srcParent.children[srcName];
        return true;
    }

    chmod(path, mode) {
        const node = this._getNode(path);
        if (!node) return { error: 'no_such_file' };

        // Simple chmod — just store the numeric mode as a permission string
        // Convert numeric like 755 to rwx format
        const modeStr = this._numericToPermStr(mode, node.type === 'dir');
        if (modeStr) {
            node.permissions = modeStr;
        }
        return true;
    }

    _numericToPermStr(mode, isDir) {
        const modeNum = parseInt(mode, 8);
        if (isNaN(modeNum)) return null;

        const prefix = isDir ? 'd' : '-';
        const digits = [(modeNum >> 6) & 7, (modeNum >> 3) & 7, modeNum & 7];
        let str = prefix;
        for (const d of digits) {
            str += (d & 4) ? 'r' : '-';
            str += (d & 2) ? 'w' : '-';
            str += (d & 1) ? 'x' : '-';
        }
        return str;
    }

    // Find files matching a pattern
    find(startPath, options = {}) {
        const results = [];
        const start = this.resolve(startPath);

        const walk = (path, node) => {
            const name = path.split('/').pop() || '/';

            if (options.name) {
                const pattern = options.name.replace(/\*/g, '.*').replace(/\?/g, '.');
                const regex = new RegExp('^' + pattern + '$');
                if (regex.test(name)) {
                    if (!options.type || (options.type === 'f' && node.type === 'file') || (options.type === 'd' && node.type === 'dir')) {
                        results.push(path);
                    }
                }
            } else {
                if (!options.type || (options.type === 'f' && node.type === 'file') || (options.type === 'd' && node.type === 'dir')) {
                    results.push(path);
                }
            }

            if (node.type === 'dir' && node.children) {
                for (const [childName, childNode] of Object.entries(node.children)) {
                    walk(path === '/' ? '/' + childName : path + '/' + childName, childNode);
                }
            }
        };

        const startNode = this._getNode(start);
        if (startNode) walk(start, startNode);
        return results;
    }

    // Get display path (replace /home/user with ~)
    displayPath(path) {
        if (!path) path = this.cwd;
        if (path === '/home/user') return '~';
        if (path.startsWith('/home/user/')) return '~/' + path.slice(11);
        return path;
    }
}
