// === Progress Tracker (localStorage) ===

const STORAGE_KEY = 'ubuntu_sim_progress';

export class Progress {
    constructor() {
        this.data = this._load();
    }

    _load() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch (e) {
            // ignore parse errors
        }
        return {
            completedLessons: [],
            completedChallenges: [],
            lessonProgress: {}, // { lessonId: currentStep }
        };
    }

    _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        } catch (e) {
            // ignore storage errors
        }
    }

    // Lessons
    isLessonCompleted(lessonId) {
        return this.data.completedLessons.includes(lessonId);
    }

    completeLesson(lessonId) {
        if (!this.data.completedLessons.includes(lessonId)) {
            this.data.completedLessons.push(lessonId);
            this._save();
        }
    }

    getLessonStep(lessonId) {
        return this.data.lessonProgress[lessonId] || 0;
    }

    setLessonStep(lessonId, step) {
        this.data.lessonProgress[lessonId] = step;
        this._save();
    }

    getCompletedLessonsCount() {
        return this.data.completedLessons.length;
    }

    // Challenges
    isChallengeCompleted(challengeId) {
        return this.data.completedChallenges.includes(challengeId);
    }

    completeChallenge(challengeId) {
        if (!this.data.completedChallenges.includes(challengeId)) {
            this.data.completedChallenges.push(challengeId);
            this._save();
        }
    }

    getCompletedChallengesCount() {
        return this.data.completedChallenges.length;
    }

    // Reset
    reset() {
        this.data = {
            completedLessons: [],
            completedChallenges: [],
            lessonProgress: {},
        };
        this._save();
    }
}
