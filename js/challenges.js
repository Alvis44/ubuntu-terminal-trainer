// === Challenge System (manifest-based, bilingual) ===

import { localized } from './i18n.js';

export class ChallengeEngine {
    constructor(progress, shell, fs) {
        this.progress = progress;
        this.shell = shell;
        this.fs = fs;
        this.challenges = [];       // Single array of bilingual challenge objects
        this.currentChallenge = null;
        this.lastCommand = '';
        this.lastOutput = '';
        this.onUpdate = null;
    }

    async loadChallenges() {
        try {
            const manifestRes = await fetch('data/manifest.json');
            const manifest = await manifestRes.json();

            const challengePromises = manifest.challenges.map(p =>
                fetch(`data/${p}`).then(r => r.json())
            );
            this.challenges = await Promise.all(challengePromises);

            // Sort by difficulty then by order within difficulty
            const diffOrder = { easy: 0, medium: 1, hard: 2 };
            this.challenges.sort((a, b) =>
                (diffOrder[a.difficulty] ?? 99) - (diffOrder[b.difficulty] ?? 99) || a.order - b.order
            );
        } catch (e) {
            console.error('Failed to load challenges:', e);
        }
    }

    /** Returns raw bilingual challenge objects (use localized() for display fields). */
    getChallenges() {
        return this.challenges;
    }

    startChallenge(challengeId) {
        this.currentChallenge = this.challenges.find(c => c.id === challengeId);
        if (!this.currentChallenge) return;

        // Reset filesystem for clean challenge state
        this.fs.reset();
        this.lastCommand = '';
        this.lastOutput = '';

        // Track commands for validation
        this.shell.onCommandExecuted = (cmd, output) => {
            this.lastCommand = cmd;
            this.lastOutput = output;
        };

        if (this.onUpdate) this.onUpdate();
    }

    stopChallenge() {
        this.currentChallenge = null;
        this.shell.onCommandExecuted = null;
    }

    resetChallenge() {
        if (this.currentChallenge) {
            this.startChallenge(this.currentChallenge.id);
        }
    }

    /** Returns current challenge info with all text already localized to current language. */
    getCurrentChallengeInfo() {
        if (!this.currentChallenge) return null;
        return {
            title: localized(this.currentChallenge.title),
            description: localized(this.currentChallenge.description),
            difficulty: this.currentChallenge.difficulty,
            isCompleted: this.progress.isChallengeCompleted(this.currentChallenge.id),
        };
    }

    // Validate the challenge
    check() {
        if (!this.currentChallenge) return false;

        const checkDef = this.currentChallenge.check;
        let passed = false;

        switch (checkDef.type) {
            case 'file_content': {
                const content = this.fs.readFile(checkDef.path);
                if (content && typeof content === 'string' && content.includes(checkDef.contains)) {
                    passed = true;
                }
                break;
            }
            case 'file_exists': {
                passed = this.fs.exists(checkDef.path) && this.fs.isFile(checkDef.path);
                break;
            }
            case 'dir_exists': {
                passed = this.fs.exists(checkDef.path) && this.fs.isDir(checkDef.path);
                break;
            }
            case 'cwd': {
                passed = this.fs.cwd === checkDef.path;
                break;
            }
            case 'command': {
                const regex = new RegExp(checkDef.pattern);
                passed = regex.test(this.lastCommand);
                break;
            }
            case 'file_permissions': {
                const stat = this.fs.stat(checkDef.path);
                if (stat && stat.permissions === checkDef.permissions) {
                    passed = true;
                }
                break;
            }
        }

        if (passed) {
            this.progress.completeChallenge(this.currentChallenge.id);
        }

        if (this.onUpdate) this.onUpdate();
        return passed;
    }
}
