// === Lesson Engine (manifest-based, bilingual) ===

import { localized } from './i18n.js';

export class LessonEngine {
    constructor(progress, shell, fs) {
        this.progress = progress;
        this.shell = shell;
        this.fs = fs;
        this.lessons = [];          // Single array of bilingual lesson objects
        this.currentLesson = null;
        this.currentStep = 0;
        this.onUpdate = null;       // callback to update UI
        this.stepCompleted = false;
    }

    async loadLessons() {
        try {
            const manifestRes = await fetch('data/manifest.json');
            const manifest = await manifestRes.json();

            const lessonPromises = manifest.lessons.map(p =>
                fetch(`data/${p}`).then(r => r.json())
            );
            this.lessons = await Promise.all(lessonPromises);

            // Sort by level then by order within level
            const levelOrder = { beginner: 0, intermediate: 1, advanced: 2 };
            this.lessons.sort((a, b) =>
                (levelOrder[a.level] ?? 99) - (levelOrder[b.level] ?? 99) || a.order - b.order
            );
        } catch (e) {
            console.error('Failed to load lessons:', e);
        }
    }

    /** Returns raw bilingual lesson objects (use localized() for display fields). */
    getLessons() {
        return this.lessons;
    }

    startLesson(lessonId) {
        this.currentLesson = this.lessons.find(l => l.id === lessonId);
        if (!this.currentLesson) return;

        // Reset filesystem for clean lesson state
        this.fs.reset();

        this.currentStep = this.progress.getLessonStep(lessonId);
        this.stepCompleted = false;

        // Hook into shell command execution
        this.shell.onCommandExecuted = (cmd, output) => {
            this._validateStep(cmd, output);
        };

        if (this.onUpdate) this.onUpdate();
    }

    stopLesson() {
        this.currentLesson = null;
        this.currentStep = 0;
        this.stepCompleted = false;
        this.shell.onCommandExecuted = null;
    }

    /** Returns current step info with all text already localized to current language. */
    getCurrentStepInfo() {
        if (!this.currentLesson) return null;
        const step = this.currentLesson.steps[this.currentStep];
        if (!step) return null;

        return {
            lessonTitle: localized(this.currentLesson.title),
            stepNumber: this.currentStep + 1,
            totalSteps: this.currentLesson.steps.length,
            instruction: localized(step.instruction),
            hint: localized(step.hint),
            isCompleted: this.stepCompleted,
            isLastStep: this.currentStep >= this.currentLesson.steps.length - 1,
            isLessonDone: this.stepCompleted && this.currentStep >= this.currentLesson.steps.length - 1,
        };
    }

    _validateStep(command, _output) {
        if (!this.currentLesson || this.stepCompleted) return;

        const step = this.currentLesson.steps[this.currentStep];
        if (!step) return;

        const regex = new RegExp(step.validate);
        if (regex.test(command)) {
            this.stepCompleted = true;
            if (this.onUpdate) this.onUpdate();
        }
    }

    nextStep() {
        if (!this.currentLesson) return;

        if (this.currentStep >= this.currentLesson.steps.length - 1) {
            // Lesson complete
            this.progress.completeLesson(this.currentLesson.id);
            this.progress.setLessonStep(this.currentLesson.id, 0);
            if (this.onUpdate) this.onUpdate();
            return true; // signals lesson done
        }

        this.currentStep++;
        this.stepCompleted = false;
        this.progress.setLessonStep(this.currentLesson.id, this.currentStep);
        if (this.onUpdate) this.onUpdate();
        return false;
    }
}
