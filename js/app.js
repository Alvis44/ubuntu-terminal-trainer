// === Main Application ===

import { t, getLang, toggleLang, updatePageTranslations, localized } from './i18n.js';
import { VirtualFS, loadDefaultFS } from './filesystem.js';
import { createCommands } from './commands.js';
import { Shell } from './shell.js';
import { Terminal } from './terminal.js';
import { Progress } from './progress.js';
import { LessonEngine } from './lessons.js';
import { ChallengeEngine } from './challenges.js';

class App {
    constructor() {
        this.fs = new VirtualFS();
        this.commands = createCommands(this.fs);
        this.shell = new Shell(this.fs, this.commands);
        this.terminal = null;
        this.progress = new Progress();
        this.lessonEngine = new LessonEngine(this.progress, this.shell, this.fs);
        this.challengeEngine = new ChallengeEngine(this.progress, this.shell, this.fs);
        this.currentMode = null; // 'learn', 'sandbox', 'challenges'
    }

    async init() {
        // Load data
        await Promise.all([
            this.lessonEngine.loadLessons(),
            this.challengeEngine.loadChallenges(),
        ]);

        // Set up callbacks
        this.lessonEngine.onUpdate = () => this._updateInfoPanel();
        this.challengeEngine.onUpdate = () => this._updateInfoPanel();

        // Bind UI events
        this._bindEvents();

        // Apply translations
        updatePageTranslations();
    }

    _bindEvents() {
        // Language toggle
        document.getElementById('lang-toggle').addEventListener('click', () => {
            toggleLang();
            updatePageTranslations();
            // Rebuild current view
            if (this.currentMode) {
                this._renderSidebar();
                this._updateInfoPanel();
                // Show language switch notice in terminal
                if (this.terminal) {
                    this.terminal.writeln(`\n\x1b[1;33m[${getLang().toUpperCase()}] ${t('welcome_msg')}\x1b[0m`);
                }
            }
        });

        // Mode cards on welcome screen
        document.querySelectorAll('.mode-card').forEach(card => {
            card.addEventListener('click', () => {
                const mode = card.dataset.mode;
                this._enterMode(mode);
            });
        });

        // Back button
        document.getElementById('btn-back').addEventListener('click', () => {
            this._exitMode();
        });
    }

    _enterMode(mode) {
        this.currentMode = mode;

        // Switch screens
        document.getElementById('welcome-screen').classList.remove('active');
        document.getElementById('main-screen').classList.add('active');

        // Init terminal if not yet
        if (!this.terminal) {
            this.terminal = new Terminal(this.shell);
            this.terminal.init(document.getElementById('terminal-container'));
        }

        // Reset filesystem for fresh start
        this.fs.reset();

        // Stop any active lesson/challenge
        this.lessonEngine.stopLesson();
        this.challengeEngine.stopChallenge();

        // Render sidebar
        this._renderSidebar();

        // Mode-specific setup
        if (mode === 'sandbox') {
            document.getElementById('info-panel').classList.add('hidden');
            this.terminal.writeWelcome(t('welcome_msg'));
        } else if (mode === 'learn') {
            document.getElementById('sidebar-title').textContent = t('lessons');
            // Auto-start first incomplete lesson
            const lessons = this.lessonEngine.getLessons();
            const firstIncomplete = lessons.find(l => !this.progress.isLessonCompleted(l.id));
            if (firstIncomplete) {
                this._startLesson(firstIncomplete.id);
            } else {
                document.getElementById('info-panel').classList.add('hidden');
                this.terminal.writeWelcome(t('all_lessons_complete'));
            }
        } else if (mode === 'challenges') {
            document.getElementById('sidebar-title').textContent = t('challenges');
            document.getElementById('info-panel').classList.add('hidden');
            this.terminal.writeWelcome(t('welcome_msg'));
        }

        // Focus terminal
        setTimeout(() => {
            this.terminal.fit();
            this.terminal.focus();
        }, 100);
    }

    _exitMode() {
        this.currentMode = null;
        this.lessonEngine.stopLesson();
        this.challengeEngine.stopChallenge();

        // Destroy terminal to reclaim resources
        if (this.terminal) {
            this.terminal.dispose();
            this.terminal = null;
            document.getElementById('terminal-container').innerHTML = '';
        }

        document.getElementById('main-screen').classList.remove('active');
        document.getElementById('welcome-screen').classList.add('active');

        // Refresh translations in case lang changed
        updatePageTranslations();
    }

    _renderSidebar() {
        const content = document.getElementById('sidebar-content');
        content.innerHTML = '';

        if (this.currentMode === 'learn') {
            document.getElementById('sidebar-title').textContent = t('lessons');
            this._renderLessonSidebar(content);
        } else if (this.currentMode === 'challenges') {
            document.getElementById('sidebar-title').textContent = t('challenges');
            this._renderChallengeSidebar(content);
        } else if (this.currentMode === 'sandbox') {
            document.getElementById('sidebar-title').textContent = t('sandbox');
            this._renderSandboxSidebar(content);
        }
    }

    _renderLessonSidebar(container) {
        const lessons = this.lessonEngine.getLessons();
        const levels = ['beginner', 'intermediate', 'advanced'];

        // Progress bar
        const total = lessons.length;
        const completed = this.progress.getCompletedLessonsCount();
        container.innerHTML = `
            <div class="progress-bar-container">
                <div class="progress-bar">
                    <div class="progress-bar-fill" style="width: ${total > 0 ? (completed / total * 100) : 0}%"></div>
                </div>
                <div class="progress-text">${completed} / ${total} ${t('completed')}</div>
            </div>
        `;

        for (const level of levels) {
            const levelLessons = lessons.filter(l => l.level === level);
            if (levelLessons.length === 0) continue;

            const section = document.createElement('div');
            section.className = 'sidebar-section';
            section.textContent = t(level);
            container.appendChild(section);

            for (const lesson of levelLessons) {
                const isCompleted = this.progress.isLessonCompleted(lesson.id);
                const isActive = this.lessonEngine.currentLesson?.id === lesson.id;

                const item = document.createElement('div');
                item.className = `sidebar-item${isCompleted ? ' completed' : ''}${isActive ? ' active' : ''}`;
                item.innerHTML = `
                    <span class="check">${isCompleted ? '\u2713' : ''}</span>
                    <span>${localized(lesson.title)}</span>
                `;
                item.addEventListener('click', () => this._startLesson(lesson.id));
                container.appendChild(item);
            }
        }

        // Reset button
        const resetBtn = document.createElement('button');
        resetBtn.className = 'btn-reset-progress';
        resetBtn.textContent = t('reset_progress');
        resetBtn.addEventListener('click', () => {
            if (confirm(t('reset_confirm'))) {
                this.progress.reset();
                this._renderSidebar();
            }
        });
        container.appendChild(resetBtn);
    }

    _renderChallengeSidebar(container) {
        const challenges = this.challengeEngine.getChallenges();
        const difficulties = ['easy', 'medium', 'hard'];

        // Progress bar
        const total = challenges.length;
        const completed = this.progress.getCompletedChallengesCount();
        container.innerHTML = `
            <div class="progress-bar-container">
                <div class="progress-bar">
                    <div class="progress-bar-fill" style="width: ${total > 0 ? (completed / total * 100) : 0}%"></div>
                </div>
                <div class="progress-text">${completed} / ${total} ${t('completed')}</div>
            </div>
        `;

        for (const diff of difficulties) {
            const diffChallenges = challenges.filter(c => c.difficulty === diff);
            if (diffChallenges.length === 0) continue;

            const section = document.createElement('div');
            section.className = 'sidebar-section';
            section.textContent = t(diff);
            container.appendChild(section);

            for (const challenge of diffChallenges) {
                const isCompleted = this.progress.isChallengeCompleted(challenge.id);
                const isActive = this.challengeEngine.currentChallenge?.id === challenge.id;

                const item = document.createElement('div');
                item.className = `sidebar-item${isCompleted ? ' completed' : ''}${isActive ? ' active' : ''}`;
                item.innerHTML = `
                    <span class="check">${isCompleted ? '\u2713' : ''}</span>
                    <span>${localized(challenge.title)}</span>
                    <span class="badge badge-${diff}">${t(diff)}</span>
                `;
                item.addEventListener('click', () => this._startChallenge(challenge.id));
                container.appendChild(item);
            }
        }

        // Reset button
        const resetBtn = document.createElement('button');
        resetBtn.className = 'btn-reset-progress';
        resetBtn.textContent = t('reset_progress');
        resetBtn.addEventListener('click', () => {
            if (confirm(t('reset_confirm'))) {
                this.progress.reset();
                this._renderSidebar();
            }
        });
        container.appendChild(resetBtn);
    }

    _renderSandboxSidebar(container) {
        container.innerHTML = `
            <div style="padding: 16px; color: var(--text-secondary); font-size: 13px; line-height: 1.6;">
                <p style="margin-bottom: 12px;">${getLang() === 'ru'
                    ? 'Свободный режим. Практикуйте любые команды!'
                    : 'Free mode. Practice any commands!'}</p>
                <p style="margin-bottom: 8px; color: var(--text-muted);">${getLang() === 'ru' ? 'Подсказки:' : 'Tips:'}</p>
                <ul style="padding-left: 16px; color: var(--text-muted);">
                    <li><code>help</code> — ${getLang() === 'ru' ? 'список команд' : 'list commands'}</li>
                    <li><code>man cmd</code> — ${getLang() === 'ru' ? 'справка' : 'manual'}</li>
                    <li><code>Tab</code> — ${getLang() === 'ru' ? 'автодополнение' : 'autocomplete'}</li>
                    <li><code>\u2191\u2193</code> — ${getLang() === 'ru' ? 'история' : 'history'}</li>
                    <li><code>Ctrl+L</code> — ${getLang() === 'ru' ? 'очистить' : 'clear'}</li>
                </ul>
            </div>
        `;

        // Reset filesystem button
        const resetBtn = document.createElement('button');
        resetBtn.className = 'btn-reset-progress';
        resetBtn.textContent = getLang() === 'ru' ? 'Сбросить файловую систему' : 'Reset filesystem';
        resetBtn.addEventListener('click', () => {
            this.fs.reset();
            this.terminal.writeln('\n\x1b[1;33m' + (getLang() === 'ru' ? 'Файловая система сброшена.' : 'Filesystem reset.') + '\x1b[0m');
        });
        container.appendChild(resetBtn);
    }

    _startLesson(lessonId) {
        this.challengeEngine.stopChallenge();
        this.lessonEngine.startLesson(lessonId);

        // Show welcome in terminal
        if (this.terminal) {
            this.terminal.xterm.reset();
            const info = this.lessonEngine.getCurrentStepInfo();
            if (info) {
                this.terminal.xterm.writeln(`\x1b[1;33m--- ${info.lessonTitle} ---\x1b[0m`);
                this.terminal.xterm.writeln('');
            }
            this.terminal.writeWelcome(t('welcome_msg'));
        }

        this._renderSidebar();
        this._updateInfoPanel();
    }

    _startChallenge(challengeId) {
        this.lessonEngine.stopLesson();
        this.challengeEngine.startChallenge(challengeId);

        // Show welcome in terminal
        if (this.terminal) {
            this.terminal.xterm.reset();
            const info = this.challengeEngine.getCurrentChallengeInfo();
            if (info) {
                this.terminal.xterm.writeln(`\x1b[1;33m--- ${info.title} ---\x1b[0m`);
                this.terminal.xterm.writeln('');
            }
            this.terminal.writeWelcome(t('welcome_msg'));
        }

        this._renderSidebar();
        this._updateInfoPanel();
    }

    _updateInfoPanel() {
        const panel = document.getElementById('info-panel');
        const content = document.getElementById('info-panel-content');

        if (this.currentMode === 'learn' && this.lessonEngine.currentLesson) {
            const info = this.lessonEngine.getCurrentStepInfo();
            if (!info) {
                panel.classList.add('hidden');
                return;
            }

            panel.classList.remove('hidden');
            let html = `
                <div class="step-counter">${t('step')} ${info.stepNumber} ${t('of')} ${info.totalSteps}</div>
                <h3>${info.lessonTitle}</h3>
                <p>${this._formatMarkdown(info.instruction)}</p>
            `;

            if (info.isCompleted) {
                if (info.isLessonDone) {
                    html += `<p class="success-msg">${t('lesson_complete')}</p>`;
                    // Check if there's a next lesson
                    const lessons = this.lessonEngine.getLessons();
                    const currentIdx = lessons.findIndex(l => l.id === this.lessonEngine.currentLesson.id);
                    if (currentIdx < lessons.length - 1) {
                        html += `<button class="btn-next" id="btn-next-lesson">${t('next_lesson')}</button>`;
                    } else {
                        html += `<p class="success-msg">${t('all_lessons_complete')}</p>`;
                    }
                } else {
                    html += `<p class="success-msg">\u2713 ${getLang() === 'ru' ? 'Правильно!' : 'Correct!'}</p>`;
                    html += `<button class="btn-next" id="btn-next-step">${t('next_step')}</button>`;
                }
            } else {
                html += `<button class="btn-hint" id="btn-hint">${t('hint')}</button>`;
                html += `<span id="hint-text" style="display:none;"> ${info.hint}</span>`;
            }

            content.innerHTML = html;

            // Bind hint button
            const hintBtn = document.getElementById('btn-hint');
            if (hintBtn) {
                hintBtn.addEventListener('click', () => {
                    const hintText = document.getElementById('hint-text');
                    if (hintText) {
                        hintText.style.display = 'inline';
                        hintText.className = 'hint';
                    }
                    hintBtn.style.display = 'none';
                });
            }

            // Bind next step button
            const nextStepBtn = document.getElementById('btn-next-step');
            if (nextStepBtn) {
                nextStepBtn.addEventListener('click', () => {
                    this.lessonEngine.nextStep();
                    this.terminal.focus();
                });
            }

            // Bind next lesson button
            const nextLessonBtn = document.getElementById('btn-next-lesson');
            if (nextLessonBtn) {
                nextLessonBtn.addEventListener('click', () => {
                    this.lessonEngine.nextStep(); // completes current lesson
                    const lessons = this.lessonEngine.getLessons();
                    const currentIdx = lessons.findIndex(l => l.id === this.lessonEngine.currentLesson?.id);
                    const nextLesson = lessons[currentIdx + 1];
                    if (nextLesson) {
                        this._startLesson(nextLesson.id);
                    }
                    this._renderSidebar();
                    this.terminal.focus();
                });
            }

        } else if (this.currentMode === 'challenges' && this.challengeEngine.currentChallenge) {
            const info = this.challengeEngine.getCurrentChallengeInfo();
            if (!info) {
                panel.classList.add('hidden');
                return;
            }

            panel.classList.remove('hidden');
            let html = `
                <h3>${info.title} <span class="badge badge-${info.difficulty}">${t(info.difficulty)}</span></h3>
                <p>${this._formatMarkdown(info.description)}</p>
            `;

            if (info.isCompleted) {
                html += `<p class="success-msg">${t('challenge_complete')}</p>`;
            } else {
                html += `
                    <button class="btn-next" id="btn-check">${t('check')}</button>
                    <button class="btn-reset-challenge" id="btn-reset-challenge">${t('reset_challenge')}</button>
                `;
            }

            content.innerHTML = html;

            // Bind check button
            const checkBtn = document.getElementById('btn-check');
            if (checkBtn) {
                checkBtn.addEventListener('click', () => {
                    const passed = this.challengeEngine.check();
                    if (passed) {
                        this._renderSidebar();
                        this.terminal.writeln(`\n\x1b[1;32m\u2713 ${t('challenge_complete')}\x1b[0m`);
                    } else {
                        this.terminal.writeln(`\n\x1b[1;31m\u2717 ${t('challenge_fail')}\x1b[0m`);
                    }
                    this.terminal.focus();
                });
            }

            // Bind reset button
            const resetBtn = document.getElementById('btn-reset-challenge');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    this.challengeEngine.resetChallenge();
                    this.terminal.xterm.reset();
                    this.terminal.writeWelcome(t('welcome_msg'));
                    this.terminal.focus();
                });
            }
        } else {
            panel.classList.add('hidden');
        }
    }

    _formatMarkdown(text) {
        // Simple markdown: **bold** and `code`
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`(.+?)`/g, '<code style="background:#444;padding:1px 4px;border-radius:3px;">$1</code>');
    }
}

// Initialize — ES modules are deferred, so DOM is ready when this runs
await loadDefaultFS();
const app = new App();
await app.init();
window._app = app;
