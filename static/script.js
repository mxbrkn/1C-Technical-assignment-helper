/**
 * Помощник формулировки ТЗ — Frontend
 * Все API-вызовы идут через Python-бекенд (FastAPI).
 */

class TZHelper {
    constructor() {
        this.state = {
            mode: 'simplified',
            provider: 'deepseek',
            currentStep: 1,
            taskDescription: '',
            questions: [],
            answers: [],
            currentQuestionIndex: 0,
            result: '',
        };

        this.init();
    }

    // ─── Инициализация ──────────────────────────────────────────────────

    init() {
        this.cacheElements();
        this.bindEvents();
        this.updateStepperUI();
    }

    cacheElements() {
        // Степпер
        this.steps = document.querySelectorAll('.step');
        this.stepLines = document.querySelectorAll('.step-line');

        // Панели шагов
        this.step1 = document.getElementById('step1Panel');
        this.step2 = document.getElementById('step2Panel');
        this.step3 = document.getElementById('step3Panel');

        // Шаг 1
        this.taskInput = document.getElementById('taskInput');
        this.charCount = document.getElementById('charCount');
        this.generateQuestionsBtn = document.getElementById('generateQuestionsBtn');

        // Шаг 2
        this.questionsList = document.getElementById('questionsList');
        this.answeredBadge = document.getElementById('answeredBadge');
        this.backToStep1Btn = document.getElementById('backToStep1Btn');
        this.addQuestionsBtn = document.getElementById('addQuestionsBtn');
        this.generateTzBtn = document.getElementById('generateTzBtn');

        // Шаг 3
        this.resultOutput = document.getElementById('resultOutput');
        this.copyBtn = document.getElementById('copyBtn');
        this.backToStep2Btn = document.getElementById('backToStep2Btn');
        this.startOverBtn = document.getElementById('startOverBtn');

        // Модалка
        this.modalOverlay = document.getElementById('questionModal');
        this.modalTitle = document.getElementById('modalTitle');
        this.modalProgressBar = document.getElementById('modalProgressBar');
        this.questionText = document.getElementById('questionText');
        this.answerInput = document.getElementById('answerInput');
        this.modalBackBtn = document.getElementById('modalBackBtn');
        this.modalSkipBtn = document.getElementById('modalSkipBtn');
        this.modalNextBtn = document.getElementById('modalNextBtn');
        this.modalCloseBtn = document.getElementById('modalCloseBtn');

        // Загрузка
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.loadingText = document.getElementById('loadingText');

        // Режимы
        this.modeBtns = document.querySelectorAll('.mode-btn');

        // Провайдеры
        this.providerBtns = document.querySelectorAll('.provider-btn');
    }

    bindEvents() {
        // Провайдер
        this.providerBtns.forEach(btn => {
            btn.addEventListener('click', () => this.switchProvider(btn.dataset.provider));
        });

        // Режим
        this.modeBtns.forEach(btn => {
            btn.addEventListener('click', () => this.switchMode(btn.dataset.mode));
        });

        // Шаг 1
        this.taskInput.addEventListener('input', () => {
            this.state.taskDescription = this.taskInput.value;
            this.charCount.textContent = this.taskInput.value.length;
        });

        this.generateQuestionsBtn.addEventListener('click', () => this.generateQuestions());

        // Шаг 2
        this.backToStep1Btn.addEventListener('click', () => this.goToStep(1));
        this.addQuestionsBtn.addEventListener('click', () => this.generateQuestions(true));
        this.generateTzBtn.addEventListener('click', () => this.generateTZ());

        // Шаг 3
        this.copyBtn.addEventListener('click', () => this.copyResult());
        this.backToStep2Btn.addEventListener('click', () => this.goToStep(2));
        this.startOverBtn.addEventListener('click', () => this.resetAll());

        // Модалка
        this.modalBackBtn.addEventListener('click', () => this.modalPrev());
        this.modalSkipBtn.addEventListener('click', () => this.modalSkip());
        this.modalNextBtn.addEventListener('click', () => this.modalNext());
        this.modalCloseBtn.addEventListener('click', () => this.closeModal());
        this.modalOverlay.addEventListener('click', (e) => {
            if (e.target === this.modalOverlay) this.closeModal();
        });

        // Горячие клавиши
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                if (this.modalOverlay.classList.contains('open')) {
                    this.modalNext();
                }
            }
        });

        // Ctrl+Enter в textarea шага 1
        this.taskInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                this.generateQuestions();
            }
        });
    }

    // ─── Навигация ──────────────────────────────────────────────────────

    goToStep(step) {
        this.state.currentStep = step;
        this.updateStepperUI();
        this.updatePanels();
    }

    updateStepperUI() {
        const current = this.state.currentStep;

        this.steps.forEach((el, i) => {
            const stepNum = i + 1;
            el.classList.toggle('active', stepNum === current);
            el.classList.toggle('completed', stepNum < current);
        });

        this.stepLines.forEach((el, i) => {
            el.classList.toggle('completed', i + 1 < current);
        });
    }

    updatePanels() {
        [this.step1, this.step2, this.step3].forEach((panel, i) => {
            panel.classList.toggle('active', i + 1 === this.state.currentStep);
        });
    }

    // ─── Режим ──────────────────────────────────────────────────────────

    switchProvider(provider) {
        this.state.provider = provider;
        this.providerBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.provider === provider);
        });
        this.showToast(`Модель: ${provider === 'claude' ? 'Claude' : 'DeepSeek'}`, 'info');
    }

    switchMode(mode) {
        this.state.mode = mode;
        this.modeBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }

    // ─── API-вызовы ─────────────────────────────────────────────────────

    async apiCall(endpoint, body) {
        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: resp.statusText }));
            throw new Error(err.detail || 'Ошибка сервера');
        }

        return resp.json();
    }

    // ─── Генерация вопросов ─────────────────────────────────────────────

    async generateQuestions(addMore = false) {
        const desc = this.state.taskDescription.trim();
        if (!desc) {
            this.showToast('Введите описание задачи', 'warning');
            this.taskInput.focus();
            return;
        }

        this.showLoading('Генерируем уточняющие вопросы...');

        try {
            const data = await this.apiCall('/api/generate-questions', {
                task_description: desc,
                existing_questions: this.state.questions,
                mode: this.state.mode,
                provider: this.state.provider,
            });

            const newQuestions = this.parseQuestions(data.content);

            if (newQuestions.length === 0) {
                this.showToast('Не удалось сгенерировать вопросы. Попробуйте изменить описание.', 'warning');
                return;
            }

            const maxQ = this.state.mode === 'simplified' ? 5 : 15;

            newQuestions.forEach(q => {
                if (!this.state.questions.includes(q) && this.state.questions.length < maxQ) {
                    this.state.questions.push(q);
                    this.state.answers.push('');
                }
            });

            this.renderQuestions();
            this.goToStep(2);
            this.showToast(`Сгенерировано вопросов: ${newQuestions.length}`, 'success');
        } catch (err) {
            this.showToast(err.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    parseQuestions(raw) {
        return raw
            .split('\n')
            .map(q => q.replace(/^\d+\.\s*/, '').replace(/^[-•]\s*/, '').trim())
            .filter(q => q.endsWith('?') && q.length > 10 && !q.includes('```'));
    }

    // ─── Отображение вопросов ───────────────────────────────────────────

    renderQuestions() {
        const answered = this.state.answers.filter(a => a).length;
        const total = this.state.questions.length;
        this.answeredBadge.textContent = `${answered} / ${total} отвечено`;

        if (total === 0) {
            this.questionsList.innerHTML = '<p class="placeholder-text">Вопросы ещё не сгенерированы</p>';
            return;
        }

        this.questionsList.innerHTML = this.state.questions.map((q, i) => {
            const isAnswered = !!this.state.answers[i];
            const answerPreview = isAnswered
                ? `<div class="q-answer">${this.escapeHtml(this.state.answers[i])}</div>`
                : '';

            return `
                <div class="q-card ${isAnswered ? 'q-answered' : ''}" data-index="${i}">
                    <div class="q-card-body" data-action="open" data-index="${i}">
                        <span class="q-num">${i + 1}</span>
                        <div class="q-content">
                            <div class="q-text">${this.escapeHtml(q)}</div>
                            ${answerPreview}
                        </div>
                    </div>
                    <div class="q-actions">
                        <button class="q-action-btn" data-action="refresh" data-index="${i}" title="Переформулировать">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                        </button>
                        <button class="q-action-btn q-delete" data-action="delete" data-index="${i}" title="Удалить">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Привязываем события
        this.questionsList.querySelectorAll('[data-action="open"]').forEach(el => {
            el.addEventListener('click', () => {
                this.openModal(parseInt(el.dataset.index));
            });
        });

        this.questionsList.querySelectorAll('[data-action="refresh"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.refreshQuestion(parseInt(btn.dataset.index));
            });
        });

        this.questionsList.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteQuestion(parseInt(btn.dataset.index));
            });
        });
    }

    // ─── Переформулировка вопроса ───────────────────────────────────────

    async refreshQuestion(index) {
        const card = this.questionsList.querySelector(`[data-index="${index}"].q-card`);
        if (card) card.classList.add('q-loading');

        try {
            const data = await this.apiCall('/api/refresh-question', {
                question: this.state.questions[index],
                provider: this.state.provider,
            });

            const newQ = data.content.trim().replace(/^["']|["']$/g, '');
            if (newQ && newQ.endsWith('?')) {
                this.state.questions[index] = newQ;
                this.renderQuestions();
                this.showToast('Вопрос переформулирован', 'success');
            } else {
                this.showToast('Не удалось переформулировать', 'warning');
            }
        } catch (err) {
            this.showToast(err.message, 'error');
        } finally {
            if (card) card.classList.remove('q-loading');
        }
    }

    deleteQuestion(index) {
        this.state.questions.splice(index, 1);
        this.state.answers.splice(index, 1);
        this.renderQuestions();
    }

    // ─── Модалка вопросов ───────────────────────────────────────────────

    openModal(startIndex = 0) {
        if (this.state.questions.length === 0) return;

        // Если startIndex не задан, ищем первый неотвеченный
        if (startIndex === undefined || startIndex === null) {
            startIndex = this.state.answers.findIndex(a => !a);
            if (startIndex === -1) startIndex = 0;
        }

        this.state.currentQuestionIndex = startIndex;
        this.renderModalQuestion();
        this.modalOverlay.classList.add('open');
        setTimeout(() => this.answerInput.focus(), 100);
    }

    closeModal() {
        this.modalOverlay.classList.remove('open');
        this.renderQuestions(); // обновляем карточки
    }

    renderModalQuestion() {
        const idx = this.state.currentQuestionIndex;
        const total = this.state.questions.length;
        const pct = ((idx + 1) / total) * 100;

        this.modalTitle.textContent = `Вопрос ${idx + 1} из ${total}`;
        this.modalProgressBar.style.width = `${pct}%`;
        this.questionText.textContent = this.state.questions[idx];
        this.answerInput.value = this.state.answers[idx] || '';

        this.modalBackBtn.disabled = idx === 0;
        this.modalNextBtn.textContent = idx === total - 1 ? 'Завершить' : 'Далее';
    }

    modalPrev() {
        if (this.state.currentQuestionIndex > 0) {
            // Сохраняем текущий ответ перед переходом
            this.state.answers[this.state.currentQuestionIndex] = this.answerInput.value.trim();
            this.state.currentQuestionIndex--;
            this.renderModalQuestion();
            this.answerInput.focus();
        }
    }

    modalSkip() {
        this.state.answers[this.state.currentQuestionIndex] = '';
        this.advanceModal();
    }

    modalNext() {
        this.state.answers[this.state.currentQuestionIndex] = this.answerInput.value.trim();
        this.advanceModal();
    }

    advanceModal() {
        if (this.state.currentQuestionIndex < this.state.questions.length - 1) {
            this.state.currentQuestionIndex++;
            this.renderModalQuestion();
            this.answerInput.focus();
        } else {
            this.closeModal();
            this.enrichDescription();
            this.showToast('Ответы сохранены', 'success');
        }
    }

    enrichDescription() {
        // Дополняем описание задачи ответами (без дубликатов)
        const additions = this.state.questions
            .map((q, i) => this.state.answers[i]
                ? `\n\nВопрос: ${q}\nОтвет: ${this.state.answers[i]}`
                : '')
            .filter(Boolean)
            .join('');

        if (additions) {
            // Убираем старые уточнения если были
            const base = this.state.taskDescription.split('\n\n--- УТОЧНЯЮЩАЯ ИНФОРМАЦИЯ ---')[0];
            this.state.taskDescription = base + '\n\n--- УТОЧНЯЮЩАЯ ИНФОРМАЦИЯ ---' + additions;
            this.taskInput.value = this.state.taskDescription;
            this.charCount.textContent = this.state.taskDescription.length;
        }
    }

    // ─── Генерация ТЗ ───────────────────────────────────────────────────

    async generateTZ() {
        const unanswered = this.state.answers.filter(a => !a).length;
        if (unanswered === this.state.questions.length) {
            // Все вопросы без ответов — предложить ответить
            this.openModal(0);
            this.showToast('Ответьте хотя бы на несколько вопросов для лучшего ТЗ', 'info');
            return;
        }

        this.showLoading('Формируем техническое задание...');

        try {
            const data = await this.apiCall('/api/generate-tz', {
                task_description: this.state.taskDescription,
                provider: this.state.provider,
            });

            this.state.result = data.content;
            this.renderResult();
            this.goToStep(3);
            this.showToast('ТЗ успешно сформировано!', 'success');
        } catch (err) {
            this.showToast(err.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    renderResult() {
        if (!this.state.result) {
            this.resultOutput.innerHTML = '<p class="placeholder-text">Здесь появится готовое ТЗ</p>';
            return;
        }

        if (typeof marked !== 'undefined') {
            marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });
            this.resultOutput.innerHTML = marked.parse(this.state.result);
        } else {
            this.resultOutput.textContent = this.state.result;
        }
    }

    // ─── Копирование ────────────────────────────────────────────────────

    async copyResult() {
        if (!this.state.result) return;

        try {
            await navigator.clipboard.writeText(this.state.result);
            this.copyBtn.classList.add('copied');
            this.copyBtn.querySelector('.btn-icon + *')?.remove();
            const span = this.copyBtn.querySelector('.btn-icon');
            const text = document.createTextNode(' Скопировано!');
            this.copyBtn.appendChild(text);

            setTimeout(() => {
                this.copyBtn.classList.remove('copied');
                text.textContent = ' Скопировать';
            }, 2000);
        } catch {
            this.showToast('Не удалось скопировать', 'error');
        }
    }

    // ─── Сброс ──────────────────────────────────────────────────────────

    resetAll() {
        this.state = {
            mode: this.state.mode,
            provider: this.state.provider,
            currentStep: 1,
            taskDescription: '',
            questions: [],
            answers: [],
            currentQuestionIndex: 0,
            result: '',
        };

        this.taskInput.value = '';
        this.charCount.textContent = '0';
        this.resultOutput.innerHTML = '<p class="placeholder-text">Здесь появится готовое ТЗ</p>';
        this.questionsList.innerHTML = '';
        this.answeredBadge.textContent = '0 / 0 отвечено';
        this.goToStep(1);
        this.showToast('Данные очищены', 'info');
    }

    // ─── Toast-уведомления ──────────────────────────────────────────────

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        };

        toast.innerHTML = `${icons[type] || icons.info}<span>${this.escapeHtml(message)}</span>`;
        container.appendChild(toast);

        // Анимация появления
        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove());
        }, 4000);
    }

    // ─── Загрузка ───────────────────────────────────────────────────────

    showLoading(text) {
        this.loadingText.textContent = text;
        this.loadingOverlay.classList.add('visible');
    }

    hideLoading() {
        this.loadingOverlay.classList.remove('visible');
    }

    // ─── Утилиты ────────────────────────────────────────────────────────

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// ─── Запуск ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    window.app = new TZHelper();
});
