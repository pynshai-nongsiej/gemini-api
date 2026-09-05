/**
 * MPSC LDA Quiz Platform - Core Web Client Application
 * Matches the exact Neobrutalist UI, WebGL backgrounds, bento layouts,
 * Quiz Arena, animated results, KaTeX math, and Active Recall from mpsc_quiz.
 */

class MPSCApp {
    constructor() {
        this.currentView = 'home';
        this.categories = [];
        this.authToken = localStorage.getItem('mpsc_token') || null;
        this.user = this.loadStoredUser();
        this.authTab = 'login';
        this.activeQuiz = null;
        this.lastResults = null;
        this.recallState = {
            category: 'synonym',
            questions: [],
            currentIndex: 0,
            isFlipped: false
        };

        this.init();
    }

    // --- Dynamic SVG Avatar Renderer (matches avatar_renderer.php) ---
    renderAvatarSVG(configStr, username = 'User') {
        if (!configStr) {
            configStr = 'bg:#cae6ff;hair:short;face:happy;glasses:1';
        }

        const parts = {};
        configStr.split(';').forEach(p => {
            const kv = p.split(':');
            if (kv.length === 2) parts[kv[0]] = kv[1];
        });

        const bg = parts.bg || '#e2dfff';
        const hair = parts.hair || 'short';
        const face = parts.face || 'happy';
        const glasses = parts.glasses === '1';

        let svg = `<svg viewBox="0 0 100 100" class="w-full h-full rounded-full" xmlns="http://www.w3.org/2000/svg">`;
        svg += `<rect width="100" height="100" fill="${bg}"/>`;
        svg += `<path d="M32,92 L68,92 L68,82 C68,72 61,66 50,66 C39,66 32,72 32,82 Z" fill="#e0a96d" stroke="#1a1b21" stroke-width="3.5" stroke-linejoin="round"/>`;
        svg += `<rect x="46" y="55" width="8" height="15" fill="#e0a96d" stroke="#1a1b21" stroke-width="3.5"/>`;
        svg += `<circle cx="50" cy="45" r="19" fill="#f8c390" stroke="#1a1b21" stroke-width="3.5"/>`;

        // Expression
        if (face === 'happy') {
            svg += `<path d="M41,43 C41,40 45,40 45,43" fill="none" stroke="#1a1b21" stroke-width="3" stroke-linecap="round"/>`;
            svg += `<path d="M55,43 C55,40 59,40 59,43" fill="none" stroke="#1a1b21" stroke-width="3" stroke-linecap="round"/>`;
            svg += `<path d="M45,52 C47,56 53,56 55,52" fill="none" stroke="#1a1b21" stroke-width="3" stroke-linecap="round"/>`;
        } else if (face === 'nerd') {
            svg += `<circle cx="43" cy="43" r="2.5" fill="#1a1b21"/>`;
            svg += `<circle cx="57" cy="43" r="2.5" fill="#1a1b21"/>`;
            svg += `<path d="M46,52 L54,52" fill="none" stroke="#1a1b21" stroke-width="3" stroke-linecap="round"/>`;
        } else { // focused
            svg += `<line x1="40" y1="43" x2="46" y2="43" stroke="#1a1b21" stroke-width="3" stroke-linecap="round"/>`;
            svg += `<line x1="54" y1="43" x2="60" y2="43" stroke="#1a1b21" stroke-width="3" stroke-linecap="round"/>`;
            svg += `<line x1="46" y1="52" x2="54" y2="52" stroke="#1a1b21" stroke-width="3" stroke-linecap="round"/>`;
        }

        // Glasses
        if (glasses) {
            svg += `<circle cx="42" cy="43" r="7" fill="none" stroke="#1a1b21" stroke-width="3"/>`;
            svg += `<circle cx="58" cy="43" r="7" fill="none" stroke="#1a1b21" stroke-width="3"/>`;
            svg += `<line x1="49" y1="43" x2="51" y2="43" stroke="#1a1b21" stroke-width="3"/>`;
            svg += `<path d="M35,43 L32,41" stroke="#1a1b21" stroke-width="2.5"/>`;
            svg += `<path d="M65,43 L68,41" stroke="#1a1b21" stroke-width="2.5"/>`;
        }

        // Hair
        if (hair === 'short') {
            svg += `<path d="M30,38 C32,24 45,19 50,21 C55,19 68,24 70,38 C72,42 70,29 65,27 C60,25 55,27 50,29 C45,27 40,25 35,27 C30,29 28,42 30,38 Z" fill="#5c3d2e" stroke="#1a1b21" stroke-width="3.5" stroke-linejoin="round"/>`;
        } else if (hair === 'long') {
            svg += `<path d="M31,52 C29,29 32,21 50,21 C68,21 71,29 69,52 C69,62 71,72 71,78 L65,78 C65,63 66,43 64,38 C59,33 54,36 50,36 C46,36 41,33 36,38 C34,43 35,63 35,78 L29,78 C29,72 31,62 31,52 Z" fill="#2d2727" stroke="#1a1b21" stroke-width="3.5" stroke-linejoin="round"/>`;
        } else if (hair === 'grad') {
            svg += `<polygon points="50,14 84,24 50,34 16,24" fill="#1a1b21" stroke="#1a1b21" stroke-width="3.5" stroke-linejoin="round"/>`;
            svg += `<rect x="42" y="29" width="16" height="8" fill="#1a1b21" stroke="#1a1b21" stroke-width="3.5"/>`;
            svg += `<path d="M80,25 L80,44" fill="none" stroke="#ffe08b" stroke-width="2" stroke-linecap="round"/>`;
            svg += `<circle cx="80" cy="46" r="1.5" fill="#ffe08b"/>`;
        } else if (hair === 'cap') {
            svg += `<path d="M31,41 C31,21 69,21 69,41 Z" fill="#ff5e5b" stroke="#1a1b21" stroke-width="3.5"/>`;
            svg += `<path d="M67,38 L86,44 C88,45 80,47 67,44 Z" fill="#ff5e5b" stroke="#1a1b21" stroke-width="3.5" stroke-linejoin="round"/>`;
        } else { // headband
            svg += `<path d="M31,37 C40,34 60,34 69,37" fill="none" stroke="#ff5e5b" stroke-width="7" stroke-linecap="round"/>`;
        }

        svg += `</svg>`;
        return svg;
    }

    getAuthHeaders(includeContentType = true) {
        const headers = {};
        if (includeContentType) headers['Content-Type'] = 'application/json';
        if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;
        return headers;
    }

    loadStoredUser() {
        try {
            const raw = localStorage.getItem('mpsc_user');
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return null;
    }

    saveUser() {
        try {
            if (this.user) {
                localStorage.setItem('mpsc_user', JSON.stringify(this.user));
            } else {
                localStorage.removeItem('mpsc_user');
            }
        } catch (e) {}
    }

    async init() {
        await this.checkAuthSession();
        this.updateUserUI();
        this.fetchCategories();
        this.setupKeyboardShortcuts();

        // Check path on init
        const path = window.location.pathname.replace(/^\//, '');
        if (['leaderboard', 'analytics', 'recall'].includes(path)) {
            this.navigate(path);
        } else {
            this.navigate('home');
        }
    }

    updateUserUI() {
        const guestNav = document.getElementById('nav-guest-container');
        const userNav = document.getElementById('nav-user-container');
        const headerAvatar = document.getElementById('header-avatar-container');
        const headerName = document.getElementById('header-username-display');
        const dropdownName = document.getElementById('dropdown-username');
        const sidebarAvatar = document.getElementById('sidebar-avatar');
        const sidebarName = document.getElementById('sidebar-user-name');
        const sidebarStreak = document.getElementById('sidebar-streak-days');
        const heroStreak = document.getElementById('hero-streak-text');

        if (this.user && this.user.username) {
            if (guestNav) guestNav.classList.add('hidden');
            if (userNav) userNav.classList.remove('hidden');

            const initial = this.user.username[0].toUpperCase();
            if (headerAvatar) headerAvatar.innerText = initial;
            if (headerName) headerName.innerText = this.user.username;
            if (dropdownName) dropdownName.innerText = `@${this.user.username}`;

            if (sidebarName) sidebarName.innerText = this.user.username;
            if (sidebarAvatar) {
                sidebarAvatar.innerHTML = `<span class="font-headline-md font-bold text-primary">${initial}</span>`;
            }
            const streak = this.user.streak_days || 0;
            if (sidebarStreak) sidebarStreak.innerText = streak;
            if (heroStreak) heroStreak.innerText = `${streak} Days`;
        } else {
            if (guestNav) guestNav.classList.remove('hidden');
            if (userNav) userNav.classList.add('hidden');

            if (sidebarName) sidebarName.innerText = 'Candidate (Guest)';
            if (sidebarAvatar) {
                sidebarAvatar.innerHTML = `<span class="material-symbols-outlined text-outline text-2xl">person</span>`;
            }
            if (sidebarStreak) sidebarStreak.innerText = '0';
            if (heroStreak) heroStreak.innerText = '0 Days';
        }
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Active Recall shortcuts
            if (this.currentView === 'recall') {
                if (e.code === 'Space') {
                    e.preventDefault();
                    this.flipRecallCard();
                } else if (['1', '2', '3', '4'].includes(e.key)) {
                    e.preventDefault();
                    this.rateRecall(parseInt(e.key));
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    this.nextRecallCard();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this.prevRecallCard();
                }
                return;
            }

            // Quiz Arena shortcuts
            if (this.currentView === 'quiz' && this.activeQuiz) {
                if (['1', '2', '3', '4'].includes(e.key)) {
                    const letters = ['A', 'B', 'C', 'D'];
                    const idx = parseInt(e.key) - 1;
                    this.selectOption(letters[idx]);
                } else if (['a', 'b', 'c', 'd'].includes(e.key.toLowerCase())) {
                    this.selectOption(e.key.toUpperCase());
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    this.nextQuestion();
                } else if (e.key === 'ArrowRight') {
                    this.nextQuestion();
                } else if (e.key === 'ArrowLeft') {
                    this.prevQuestion();
                }
            }
        });
    }

    // --- Navigation ---
    navigate(viewName) {
        this.currentView = viewName;

        // Visibility of top navbar, main layout (which contains sidebar), and footer
        const topNav = document.getElementById('app-top-nav');
        const mainLayout = document.getElementById('app-main-layout');
        const appFooter = document.getElementById('app-footer');

        if (viewName === 'quiz') {
            if (topNav) topNav.classList.add('hidden');
            if (mainLayout) mainLayout.classList.add('hidden');
            if (appFooter) appFooter.classList.add('hidden');
            document.body.style.overflow = 'hidden';
        } else {
            if (topNav) topNav.classList.remove('hidden');
            if (mainLayout) mainLayout.classList.remove('hidden');
            if (appFooter) appFooter.classList.remove('hidden');
            document.body.style.overflow = '';
        }

        // Update nav links
        const navIds = ['home', 'leaderboard', 'analytics', 'recall'];
        navIds.forEach(id => {
            const navEl = document.getElementById(`nav-${id}`);
            const sideEl = document.getElementById(`side-${id}`);
            if (id === viewName) {
                if (navEl) {
                    navEl.className = 'nav-link font-headline-md text-headline-md text-primary border-b-[3px] border-primary pb-1 cursor-pointer font-bold';
                }
                if (sideEl) {
                    sideEl.className = 'sidebar-link flex items-center gap-sm p-sm bg-secondary-container text-on-secondary-container rounded-lg border-2 border-on-background font-body-lg text-body-lg no-underline cursor-pointer font-bold';
                }
            } else {
                if (navEl) {
                    navEl.className = 'nav-link font-headline-md text-headline-md text-on-surface-variant hover:scale-105 transition-transform duration-200 cursor-pointer';
                }
                if (sideEl) {
                    sideEl.className = 'sidebar-link flex items-center gap-sm p-sm text-on-surface-variant hover:bg-surface-container-high transition-colors rounded-lg active:scale-95 font-body-lg text-body-lg no-underline cursor-pointer';
                }
            }
        });

        // Toggle app views
        document.querySelectorAll('.app-view').forEach(v => {
            v.classList.add('hidden');
        });
        const targetView = document.getElementById(`view-${viewName}`);
        if (targetView) {
            targetView.classList.remove('hidden');
            targetView.classList.add('animate-enter');
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Trigger view-specific loaders
        if (viewName === 'analytics') {
            this.loadAnalytics();
        } else if (viewName === 'leaderboard') {
            this.loadLeaderboard();
        } else if (viewName === 'recall') {
            this.initActiveRecall();
        } else if (viewName === 'review') {
            this.renderReview();
        }
    }

    // --- Data Fetching ---
    async fetchCategories() {
        try {
            const res = await fetch('/api/questions/categories');
            const data = await res.json();
            if (data && data.categories) {
                this.categories = data.categories;
                this.renderCategories(data.english_categories || [], data.gk_categories || []);
            }
        } catch (e) {
            console.error('Failed to fetch categories:', e);
        }
    }

    renderCategories(englishCats, gkCats) {
        const engGrid = document.getElementById('english-bento-grid');
        if (engGrid && englishCats.length > 0) {
            engGrid.innerHTML = englishCats.map((cat, index) => {
                const isWide = (index === 0 || index === 5);
                const colSpan = isWide ? 'col-span-1 md:col-span-2 lg:col-span-2 p-lg' : 'col-span-1 p-md';
                const acc = cat.accuracy || 0;
                const accBar = cat.attempts > 0 ? `
                    <div class="mt-sm flex items-center gap-sm">
                        <div class="h-3 w-full bg-surface-container-lowest border-2 border-on-background rounded-full overflow-hidden">
                            <div class="h-full bg-primary border-r-2 border-on-background" style="width: ${acc}%"></div>
                        </div>
                        <span class="font-label-sm text-label-sm font-bold">${acc}%</span>
                    </div>
                ` : `<p class="font-body-md text-body-md text-on-surface-variant mt-xs">Tap to start practice</p>`;

                return `
                <div onclick="app.startQuiz('${cat.slug}', 20)" class="${colSpan} glass-panel border-[3px] border-on-background rounded-xl neo-shadow hover:-translate-y-2 hover:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] transition-all inner-shimmer group flex flex-col justify-between min-h-[220px] cursor-pointer" style="background-color: ${cat.color}99;">
                    <div class="flex justify-between items-start">
                        <div class="w-14 h-14 bg-surface rounded-2xl border-2 border-on-background flex items-center justify-center neo-shadow group-hover:scale-110 transition-transform">
                            <span class="material-symbols-outlined text-3xl ${cat.text_color}" style="font-variation-settings: 'FILL' 1;">${cat.icon}</span>
                        </div>
                        <span class="bg-surface px-3 py-1 rounded-full border-2 border-on-background font-label-sm text-label-sm font-bold">${cat.total_questions} Qs</span>
                    </div>
                    <div>
                        <h3 class="font-headline-md text-headline-md text-on-background mt-md font-bold">${cat.name}</h3>
                        ${accBar}
                    </div>
                </div>
                `;
            }).join('');
        }

        const gkGrid = document.getElementById('gk-bento-grid');
        if (gkGrid && gkCats.length > 0) {
            gkGrid.innerHTML = gkCats.map((cat, index) => {
                const isWide = (index === 0 || index === 7);
                const colSpan = isWide ? 'col-span-1 md:col-span-2 p-lg' : 'col-span-1 p-md';
                const acc = cat.accuracy || 0;
                const accBar = cat.attempts > 0 ? `
                    <div class="mt-sm flex items-center gap-sm">
                        <div class="h-3 w-full bg-surface-container-lowest border-2 border-on-background rounded-full overflow-hidden">
                            <div class="h-full bg-primary border-r-2 border-on-background" style="width: ${acc}%"></div>
                        </div>
                        <span class="font-label-sm text-label-sm font-bold">${acc}%</span>
                    </div>
                ` : `<p class="font-body-md text-body-md text-on-surface-variant mt-xs">Tap to start practice</p>`;

                return `
                <div onclick="app.startQuiz('${cat.slug}', 20)" class="${colSpan} glass-panel border-[3px] border-on-background rounded-xl neo-shadow hover:-translate-y-2 hover:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] transition-all inner-shimmer group flex flex-col justify-between min-h-[200px] cursor-pointer" style="background-color: ${cat.color}99;">
                    <div class="flex justify-between items-start">
                        <div class="w-12 h-12 bg-surface rounded-2xl border-2 border-on-background flex items-center justify-center neo-shadow group-hover:scale-110 transition-transform">
                            <span class="material-symbols-outlined text-2xl ${cat.text_color}" style="font-variation-settings: 'FILL' 1;">${cat.icon}</span>
                        </div>
                        <span class="bg-surface px-3 py-1 rounded-full border-2 border-on-background font-label-sm text-label-sm font-bold">${cat.total_questions} Qs</span>
                    </div>
                    <div>
                        <h3 class="font-headline-md text-headline-md text-on-background mt-md font-bold">${cat.name}</h3>
                        ${accBar}
                    </div>
                </div>
                `;
            }).join('');
        }
    }

    // --- Quiz Engine ---
    async startQuiz(categorySlug, count = 20) {
        const loadingModal = document.getElementById('modal-gemini-loading');
        const loadingCatName = document.getElementById('loading-category-name');
        if (loadingCatName) {
            loadingCatName.innerText = (categorySlug === 'mock') ? 'Full Mock Exam' : (categorySlug.replace(/_/g, ' ').toUpperCase());
        }
        if (loadingModal) {
            loadingModal.classList.remove('hidden');
        }

        try {
            const res = await fetch(`/api/questions/list?category=${encodeURIComponent(categorySlug)}&count=${count}`);
            const data = await res.json();
            if (loadingModal) {
                loadingModal.classList.add('hidden');
            }

            if (!data.success || !data.questions || data.questions.length === 0) {
                alert(data.error || 'Gemini AI was unable to generate questions for this topic. Please ensure the Gemini daemon is running.');
                return;
            }

            const totalTime = Math.max(60, Math.ceil(data.questions.length * 45));

            this.activeQuiz = {
                category: categorySlug,
                category_name: data.category_name || categorySlug.toUpperCase(),
                questions: data.questions,
                currentIndex: 0,
                answers: {},
                bookmarks: new Set(),
                timeLimitSeconds: totalTime,
                remainingSeconds: totalTime,
                startTime: Date.now(),
                timerInterval: null
            };

            this.navigate('quiz');
            this.startTimer();
            this.renderCurrentQuestion();
        } catch (e) {
            if (loadingModal) {
                loadingModal.classList.add('hidden');
            }
            console.error('Quiz start error:', e);
            alert('Failed to connect to Gemini AI question generator. Please check server logs.');
        }
    }

    startTimer() {
        if (this.activeQuiz.timerInterval) clearInterval(this.activeQuiz.timerInterval);
        this.updateTimerDisplay();

        this.activeQuiz.timerInterval = setInterval(() => {
            if (!this.activeQuiz) return;
            this.activeQuiz.remainingSeconds--;
            this.updateTimerDisplay();

            if (this.activeQuiz.remainingSeconds <= 0) {
                clearInterval(this.activeQuiz.timerInterval);
                this.showNotification('Time is up! Submitting exam automatically.');
                this.submitQuiz(true);
            }
        }, 1000);
    }

    updateTimerDisplay() {
        const timerEl = document.getElementById('quiz-countdown');
        if (!timerEl || !this.activeQuiz) return;
        const mins = Math.floor(this.activeQuiz.remainingSeconds / 60);
        const secs = this.activeQuiz.remainingSeconds % 60;
        timerEl.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    renderCurrentQuestion() {
        if (!this.activeQuiz) return;
        const q = this.activeQuiz.questions[this.activeQuiz.currentIndex];
        const total = this.activeQuiz.questions.length;
        const currentIdx = this.activeQuiz.currentIndex;

        // Progress bar
        const progressPct = ((currentIdx + 1) / total) * 100;
        const pBar = document.getElementById('quiz-progress-bar');
        if (pBar) pBar.style.width = `${progressPct}%`;

        // Numbers & Badges
        const qNum = document.getElementById('quiz-q-num');
        if (qNum) qNum.innerText = currentIdx + 1;
        const totalQ = document.getElementById('quiz-total-q');
        if (totalQ) totalQ.innerText = `/ ${total}`;
        const catBadge = document.getElementById('quiz-category-badge');
        if (catBadge) catBadge.innerText = this.activeQuiz.category_name;

        // Question text
        const qText = document.getElementById('quiz-question-text');
        if (qText) {
            qText.innerText = q.question;
            if (window.renderMath) renderMath(qText);
        }

        // Bookmark button state
        const iconBookmark = document.getElementById('icon-bookmark');
        if (iconBookmark) {
            if (this.activeQuiz.bookmarks.has(q.id)) {
                iconBookmark.innerText = 'bookmark';
                iconBookmark.classList.add('text-secondary', 'font-bold');
            } else {
                iconBookmark.innerText = 'bookmark_border';
                iconBookmark.classList.remove('text-secondary', 'font-bold');
            }
        }

        // Next button label
        const btnNext = document.getElementById('btn-quiz-next');
        if (btnNext) {
            if (currentIdx === total - 1) {
                btnNext.innerHTML = `<span>Submit Quiz</span><span class="material-symbols-outlined">check_circle</span>`;
                btnNext.className = 'h-12 px-6 md:px-8 rounded-full border-[3px] border-on-background bg-[#1b6a3b] text-white font-label-lg text-label-lg uppercase flex items-center justify-center gap-2 hover:bg-[#14532d] transition-colors active:translate-y-1 active:translate-x-1 active:shadow-none shadow-[4px_4px_0px_0px_rgba(26,27,33,1)] font-bold cursor-pointer';
            } else {
                btnNext.innerHTML = `<span>Next</span><span class="material-symbols-outlined">arrow_forward</span>`;
                btnNext.className = 'h-12 px-6 md:px-8 rounded-full border-[3px] border-on-background bg-primary text-on-primary font-label-lg text-label-lg uppercase flex items-center justify-center gap-2 hover:bg-primary-container transition-colors active:translate-y-1 active:translate-x-1 active:shadow-none shadow-[4px_4px_0px_0px_rgba(26,27,33,1)] font-bold cursor-pointer';
            }
        }

        // Options
        const container = document.getElementById('quiz-options-container');
        if (container) {
            const letters = ['A', 'B', 'C', 'D'];
            const selectedLetter = this.activeQuiz.answers[q.id];

            container.innerHTML = q.options.map((optText, optIdx) => {
                const letter = letters[optIdx];
                const isSelected = (selectedLetter === letter);

                if (isSelected) {
                    return `
                    <button onclick="app.selectOption('${letter}')"
                        class="w-full text-left bg-primary border-[3px] border-on-background rounded-xl p-4 md:p-5
                               shadow-[6px_6px_0px_0px_rgba(26,27,33,1)] translate-x-[-2px] translate-y-[-2px]
                               focus:outline-none relative overflow-hidden transition-all duration-150 cursor-pointer">
                        <div class="flex items-center gap-3 relative z-10">
                            <div class="flex-shrink-0 w-8 h-8 rounded-full bg-white border-2 border-white
                                        flex items-center justify-center font-bold text-primary">${letter}</div>
                            <p class="text-[16px] md:text-[18px] font-bold text-white leading-snug flex-1 opt-text">${optText}</p>
                            <span class="material-symbols-outlined text-white text-[22px] flex-shrink-0"
                                  style="font-variation-settings:'FILL' 1">check_circle</span>
                        </div>
                    </button>
                    `;
                } else {
                    return `
                    <button onclick="app.selectOption('${letter}')"
                        class="w-full text-left bg-surface border-[3px] border-on-background rounded-xl p-4 md:p-5
                               shadow-[4px_4px_0px_0px_rgba(26,27,33,1)]
                               hover:-translate-y-0.5 hover:-translate-x-0.5
                               hover:shadow-[6px_6px_0px_0px_rgba(26,27,33,1)] hover:border-primary
                               group focus:outline-none transition-all duration-150 relative overflow-hidden cursor-pointer">
                        <div class="flex items-center gap-3 relative z-10">
                            <div class="flex-shrink-0 w-8 h-8 rounded-full border-2 border-on-background
                                        flex items-center justify-center font-bold
                                        group-hover:bg-primary group-hover:text-white group-hover:border-primary
                                        transition-all duration-150 text-on-background">${letter}</div>
                            <p class="text-[16px] md:text-[18px] font-medium text-on-surface leading-snug flex-1 group-hover:text-on-background opt-text">${optText}</p>
                        </div>
                    </button>
                    `;
                }
            }).join('');

            if (window.renderMath) renderMath(container);
        }
    }

    selectOption(letter) {
        if (!this.activeQuiz) return;
        const q = this.activeQuiz.questions[this.activeQuiz.currentIndex];
        this.activeQuiz.answers[q.id] = letter;
        this.renderCurrentQuestion();
    }

    toggleBookmark() {
        if (!this.activeQuiz) return;
        const q = this.activeQuiz.questions[this.activeQuiz.currentIndex];
        if (this.activeQuiz.bookmarks.has(q.id)) {
            this.activeQuiz.bookmarks.delete(q.id);
        } else {
            this.activeQuiz.bookmarks.add(q.id);
        }
        this.renderCurrentQuestion();
    }

    nextQuestion() {
        if (!this.activeQuiz) return;
        if (this.activeQuiz.currentIndex === this.activeQuiz.questions.length - 1) {
            this.submitQuiz();
            return;
        }
        this.activeQuiz.currentIndex++;
        this.renderCurrentQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    prevQuestion() {
        if (!this.activeQuiz || this.activeQuiz.currentIndex <= 0) return;
        this.activeQuiz.currentIndex--;
        this.renderCurrentQuestion();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    skipQuestion() {
        this.nextQuestion();
    }

    quitQuiz() {
        if (confirm('Are you sure you want to quit? Your progress in this session will be lost.')) {
            if (this.activeQuiz && this.activeQuiz.timerInterval) {
                clearInterval(this.activeQuiz.timerInterval);
            }
            this.activeQuiz = null;
            this.navigate('home');
        }
    }

    async submitQuiz(auto = false) {
        if (!this.activeQuiz) return;

        const unanswered = this.activeQuiz.questions.length - Object.keys(this.activeQuiz.answers).length;
        if (!auto && unanswered > 0) {
            if (!confirm(`You have ${unanswered} unanswered question(s). Are you sure you want to submit?`)) {
                return;
            }
        }

        if (this.activeQuiz.timerInterval) {
            clearInterval(this.activeQuiz.timerInterval);
        }

        const timeTaken = Math.max(5, Math.floor((Date.now() - this.activeQuiz.startTime) / 1000));

        try {
            const payload = {
                category: this.activeQuiz.category,
                category_name: this.activeQuiz.category_name,
                answers: this.activeQuiz.answers,
                questions: this.activeQuiz.questions,
                time_taken_seconds: timeTaken
            };

            const res = await fetch('/api/exam/submit', {
                method: 'POST',
                headers: this.getAuthHeaders(true),
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (data.success) {
                this.lastResults = data;
                try {
                    sessionStorage.setItem('mpsc_last_results', JSON.stringify(data));
                } catch (e) {}
                if (this.user) {
                    this.user.streak_days = data.streak_days || this.user.streak_days || 1;
                    this.saveUser();
                }
                this.updateUserUI();
                this.navigate('results');
                this.renderResults(data);
            } else {
                alert('Submission error: ' + (data.error || 'Unknown error'));
            }
        } catch (e) {
            console.error('Submission failed:', e);
            alert('Failed to submit exam attempt.');
        }
    }

    // --- Results View ---
    renderResults(data) {
        const catTitle = document.getElementById('results-category-title');
        if (catTitle) catTitle.innerText = data.category_name || 'Practice Drill';

        const percentileEl = document.getElementById('results-percentile');
        if (percentileEl) percentileEl.innerText = Math.max(1, 100 - (data.percentile || 95));

        const timeEl = document.getElementById('results-time-taken');
        if (timeEl) timeEl.innerText = `Completed in ${data.time_formatted || '01:45'}`;

        const accLabel = document.getElementById('results-accuracy-label');
        if (accLabel) accLabel.innerText = `${data.accuracy || 0}% Accuracy`;

        const accSub = document.getElementById('results-accuracy-sub');
        if (accSub) {
            accSub.innerText = data.accuracy >= 80 ? 'Highly precise' : (data.accuracy >= 60 ? 'Good effort' : 'Needs reinforcement');
        }

        // Numbers in breakdown
        const cStat = document.getElementById('results-correct-stat');
        if (cStat) cStat.innerText = `${data.correct_answers}/${data.total_questions}`;
        const wStat = document.getElementById('results-wrong-stat');
        if (wStat) wStat.innerText = `${data.wrong_answers}/${data.total_questions}`;
        const sStat = document.getElementById('results-skipped-stat');
        if (sStat) sStat.innerText = `${data.skipped}/${data.total_questions}`;

        // Hero Score Counter Animation
        const scoreCounter = document.getElementById('results-score-counter');
        const targetScore = data.score_percent || 0;
        let current = 0;
        scoreCounter.innerText = '0';

        const startTime = performance.now();
        const duration = 1500;

        function animate(now) {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const ease = 1 - Math.pow(1 - progress, 3);
            current = Math.floor(ease * targetScore);
            scoreCounter.innerText = current;

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                scoreCounter.innerText = targetScore;
            }
        }
        requestAnimationFrame(animate);

        // Progress bar animations
        setTimeout(() => {
            const total = data.total_questions || 1;
            const bCorrect = document.getElementById('results-bar-correct');
            if (bCorrect) bCorrect.style.width = `${(data.correct_answers / total) * 100}%`;
            const bWrong = document.getElementById('results-bar-wrong');
            if (bWrong) bWrong.style.width = `${(data.wrong_answers / total) * 100}%`;
            const bSkipped = document.getElementById('results-bar-skipped');
            if (bSkipped) bSkipped.style.width = `${(data.skipped / total) * 100}%`;
        }, 200);
    }

    // --- Review View ---
    renderReview(filter = 'all') {
        if (!this.lastResults) {
            try {
                const stored = sessionStorage.getItem('mpsc_last_results');
                if (stored) this.lastResults = JSON.parse(stored);
            } catch (e) {}
        }

        const list = document.getElementById('review-cards-list');
        if (!list || !this.lastResults || !this.lastResults.reviewed_questions || this.lastResults.reviewed_questions.length === 0) {
            if (list) {
                list.innerHTML = `
                    <div class="glass-panel neo-border rounded-2xl p-xl neo-shadow text-center bg-surface">
                        <div class="w-16 h-16 rounded-full border-2 border-on-background bg-tertiary-container flex items-center justify-center mx-auto mb-md">
                            <span class="material-symbols-outlined text-3xl text-on-tertiary-container">history_edu</span>
                        </div>
                        <h3 class="font-headline-lg font-bold text-on-background mb-2">No Exam Questions To Review</h3>
                        <p class="font-body-md text-on-surface-variant max-w-md mx-auto mb-lg">Complete a practice drill or mock test first to review questions, answer keys, and detailed solutions.</p>
                        <button onclick="app.navigate('home')" class="px-6 py-3 rounded-full border-[3px] border-on-background bg-primary text-on-primary font-label-lg uppercase font-bold neo-shadow neo-button hover:-translate-y-1 transition-all cursor-pointer">
                            Start Practice Drill
                        </button>
                    </div>
                `;
            }
            return;
        }

        const questions = this.lastResults.reviewed_questions;
        const totalCount = questions.length;
        const correctCount = questions.filter(q => q.is_correct).length;
        const skippedCount = questions.filter(q => q.is_skipped).length;
        const incorrectCount = totalCount - correctCount - skippedCount;

        // Update counts in filter pills if present
        const cAll = document.getElementById('rev-count-all');
        if (cAll) cAll.innerText = totalCount;
        const cInc = document.getElementById('rev-count-incorrect');
        if (cInc) cInc.innerText = incorrectCount;
        const cCor = document.getElementById('rev-count-correct');
        if (cCor) cCor.innerText = correctCount;
        const cSkip = document.getElementById('rev-count-skipped');
        if (cSkip) cSkip.innerText = skippedCount;

        // Update active filter pill style
        ['all', 'incorrect', 'correct', 'skipped'].forEach(f => {
            const btn = document.getElementById(`filter-rev-${f}`);
            if (btn) {
                if (f === filter) {
                    btn.className = 'px-4 py-1.5 rounded-full border-2 border-on-background font-label-sm font-bold bg-primary text-on-primary neo-shadow-sm cursor-pointer';
                } else {
                    btn.className = 'px-4 py-1.5 rounded-full border-2 border-on-background font-label-sm font-bold bg-surface text-on-surface hover:bg-surface-variant cursor-pointer';
                }
            }
        });

        // Filter list
        const filtered = questions.filter(q => {
            if (filter === 'correct') return q.is_correct;
            if (filter === 'incorrect') return !q.is_correct && !q.is_skipped;
            if (filter === 'skipped') return q.is_skipped;
            return true;
        });

        if (filtered.length === 0) {
            list.innerHTML = `<div class="p-lg bg-surface neo-border rounded-xl text-center"><p class="font-body-md text-on-surface-variant font-bold">No questions in this filter category.</p></div>`;
            return;
        }

        const letters = ['A', 'B', 'C', 'D'];
        list.innerHTML = filtered.map((q, idx) => {
            const isCorrect = q.is_correct;
            const isSkipped = q.is_skipped;
            const statusBadge = isCorrect ?
                `<span class="px-3 py-1 bg-[#d0f4de] text-[#1b6a3b] border-2 border-on-background rounded-full font-label-sm font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">check</span> Correct</span>` :
                (isSkipped ?
                    `<span class="px-3 py-1 bg-surface-container-highest text-outline border-2 border-on-background rounded-full font-label-sm font-bold flex items-center gap-1">Skipped</span>` :
                    `<span class="px-3 py-1 bg-error-container text-error border-2 border-on-background rounded-full font-label-sm font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">close</span> Incorrect</span>`);

            const optionsMarkup = (q.options || []).map((optText, optIdx) => {
                const letter = letters[optIdx];
                const isThisCorrect = (letter === q.correct_letter || optIdx === q.correct);
                const isThisUserAns = (letter === q.user_answer);

                let optClass = 'bg-surface border-on-background text-on-surface';
                let icon = '';

                if (isThisCorrect) {
                    optClass = 'bg-[#d0f4de] border-[#1b6a3b] text-[#1b6a3b] font-bold';
                    icon = `<span class="material-symbols-outlined text-[#1b6a3b]" style="font-variation-settings:'FILL' 1">check_circle</span>`;
                } else if (isThisUserAns && !isCorrect) {
                    optClass = 'bg-[#ffdad6] border-[#ba1a1a] text-[#ba1a1a] font-bold';
                    icon = `<span class="material-symbols-outlined text-[#ba1a1a]">cancel</span>`;
                }

                return `
                    <div class="p-3 border-2 rounded-xl flex items-center justify-between ${optClass}">
                        <div class="flex items-center gap-3">
                            <span class="w-7 h-7 rounded-full border border-on-background flex items-center justify-center text-label-sm font-bold bg-white/50">${letter}</span>
                            <span class="font-body-md">${optText}</span>
                        </div>
                        ${icon}
                    </div>
                `;
            }).join('');

            return `
            <div class="glass-panel neo-border rounded-xl p-md neo-shadow-sm flex flex-col gap-sm bg-surface">
                <div class="flex justify-between items-center">
                    <span class="font-label-sm text-outline font-bold uppercase tracking-wider">Question ${idx + 1}</span>
                    ${statusBadge}
                </div>
                <h3 class="font-headline-md font-bold text-on-background">${q.question}</h3>
                <div class="space-y-2 mt-2">
                    ${optionsMarkup}
                </div>
                ${q.explanation ? `
                <div class="mt-2 p-3 bg-secondary-container/40 rounded-xl border-2 border-on-background text-label-sm text-on-surface">
                    <span class="font-bold text-primary block mb-1">Detailed Explanation & Learning Note:</span>
                    ${q.explanation}
                </div>` : ''}
            </div>
            `;
        }).join('');

        if (window.renderMath) renderMath(list);
    }

    filterReview(filter) {
        this.renderReview(filter);
    }

    // --- Analytics View ---
    async loadAnalytics() {
        try {
            const res = await fetch('/api/analytics', {
                headers: this.getAuthHeaders(false)
            });
            const data = await res.json();
            if (!data.success) return;

            const tSolved = document.getElementById('stat-total-solved');
            if (tSolved) tSolved.innerText = (data.total_questions || 0).toLocaleString();

            const oAcc = document.getElementById('stat-overall-accuracy');
            if (oAcc) oAcc.innerText = `${data.accuracy || 0}%`;

            const sTime = document.getElementById('stat-study-time');
            if (sTime) sTime.innerText = `${data.total_hours || 0} hrs`;

            const wTrend = document.getElementById('stat-weekly-trend');
            if (wTrend) {
                const change = data.weekly_change || 0;
                wTrend.innerText = `${change >= 0 ? '+' : ''}${change}%`;
            }

            // Chart rendering - 7 day drill intensity & score
            const chartContainer = document.getElementById('analytics-chart-container');
            if (chartContainer && data.daily_activity) {
                chartContainer.innerHTML = data.daily_activity.map(d => {
                    const heightPct = d.score > 0 ? Math.max(15, Math.min(100, d.score)) : 10;
                    const bgClass = d.active ? 'bg-primary group-hover:bg-primary-container' : 'bg-surface-container-high border-dashed';
                    return `
                    <div class="flex flex-col items-center gap-2 h-full justify-end group cursor-pointer flex-1">
                        <div class="relative w-full flex justify-center">
                            <span class="absolute -top-7 px-2 py-0.5 bg-on-background text-white font-label-sm text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity font-bold whitespace-nowrap z-20">
                                ${d.day}: ${d.score}% (${d.quizzes} test${d.quizzes === 1 ? '' : 's'})
                            </span>
                            <div class="w-8 md:w-12 ${bgClass} rounded-t-lg border-2 border-on-background transition-all" style="height: ${heightPct}%"></div>
                        </div>
                        <span class="font-label-sm text-label-sm font-bold ${d.active ? 'text-primary' : 'text-on-surface-variant'}">${d.letter}</span>
                    </div>
                    `;
                }).join('');
            }

            // Category bars from real category_mastery in SQL
            const catBars = document.getElementById('analytics-category-bars');
            if (catBars) {
                const categories = (data.category_mastery && data.category_mastery.length > 0)
                    ? data.category_mastery 
                    : (this.categories || []).slice(0, 6).map(c => ({ name: c.name, accuracy: 0, attempts: 0, total: 0 }));

                if (categories.length === 0) {
                    catBars.innerHTML = `<p class="font-body-md text-on-surface-variant p-4 text-center">No category attempts recorded yet. Complete mock drills to see breakdown.</p>`;
                } else {
                    catBars.innerHTML = categories.map(c => {
                        const acc = c.accuracy || 0;
                        return `
                        <div>
                            <div class="flex justify-between font-label-sm font-bold mb-1">
                                <span>${c.name} ${c.attempts ? `<span class="text-outline font-normal text-xs">(${c.attempts} attempt${c.attempts > 1 ? 's' : ''})</span>` : ''}</span>
                                <span class="${acc >= 75 ? 'text-[#1b6a3b]' : (acc >= 50 ? 'text-primary' : 'text-error')}">${acc}%</span>
                            </div>
                            <div class="h-3 w-full bg-surface-container border-2 border-on-background rounded-full overflow-hidden">
                                <div class="h-full ${acc >= 75 ? 'bg-[#1b6a3b]' : (acc >= 50 ? 'bg-primary' : 'bg-error')}" style="width: ${acc}%"></div>
                            </div>
                        </div>
                        `;
                    }).join('');
                }
            }
        } catch (e) {
            console.error('Analytics load failed:', e);
        }
    }

    // --- Leaderboard View ---
    async loadLeaderboard() {
        try {
            const res = await fetch('/api/leaderboard', {
                headers: this.getAuthHeaders(false)
            });
            const data = await res.json();
            if (!data.success) return;

            const podiumEl = document.getElementById('leaderboard-podium');
            if (podiumEl) {
                if (!data.top_three || data.top_three.length === 0) {
                    podiumEl.innerHTML = `
                    <div class="col-span-1 md:col-span-3 text-center p-8 bg-surface neo-border rounded-xl font-body-lg font-bold text-on-surface-variant neo-shadow">
                        No candidate exam scores recorded yet in SQLite. Complete a practice drill to claim the 1st place crown! 👑
                    </div>
                    `;
                } else {
                    const [r1, r2, r3] = data.top_three;

                    podiumEl.innerHTML = `
                    <!-- Rank 2 (Silver) -->
                    ${r2 ? `
                    <div class="glass-panel neo-border rounded-xl p-md neo-shadow hover-float text-center flex flex-col items-center order-2 md:order-1 bg-[#cae6ff]/40 animate-enter delay-100">
                        <div class="relative mb-sm">
                            <div class="w-16 h-16 rounded-full border-2 border-on-background overflow-hidden bg-primary-container">
                                ${this.renderAvatarSVG(r2.avatar_url, r2.username)}
                            </div>
                            <span class="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 bg-secondary-container text-on-secondary-container border-2 border-on-background rounded-full font-label-sm text-label-sm font-bold">2nd</span>
                        </div>
                        <h3 class="font-headline-md text-headline-md text-on-background mt-2 font-bold">${r2.username}</h3>
                        <p class="font-body-md text-body-md text-on-surface-variant">${r2.streak_days} Day Streak 🔥</p>
                        <div class="mt-sm bg-surface rounded-lg border-2 border-on-background px-3 py-1 font-label-sm text-label-sm font-bold">
                            ${r2.points} Points
                        </div>
                    </div>` : '<div class="order-2 md:order-1"></div>'}

                    <!-- Rank 1 (Gold) -->
                    ${r1 ? `
                    <div class="glass-panel neo-border rounded-xl p-lg neo-shadow hover-float text-center flex flex-col items-center order-1 md:order-2 bg-[#ffe08b]/50 animate-enter z-10">
                        <div class="relative mb-sm">
                            <div class="w-20 h-20 rounded-full border-[3px] border-on-background overflow-hidden bg-tertiary-fixed shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                ${this.renderAvatarSVG(r1.avatar_url, r1.username)}
                            </div>
                            <span class="absolute -bottom-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-tertiary text-on-tertiary border-2 border-on-background rounded-full font-label-sm text-label-sm font-black tracking-wider">1st 👑</span>
                        </div>
                        <h3 class="font-headline-lg text-headline-lg text-on-background mt-2 font-black">${r1.username}</h3>
                        <p class="font-body-md text-body-md text-on-surface-variant font-bold">${r1.streak_days} Day Streak 🔥</p>
                        <div class="mt-sm bg-surface rounded-lg border-2 border-on-background px-4 py-1.5 font-headline-md text-headline-md text-primary font-bold">
                            ${r1.points} Points
                        </div>
                    </div>` : ''}

                    <!-- Rank 3 (Bronze) -->
                    ${r3 ? `
                    <div class="glass-panel neo-border rounded-xl p-md neo-shadow hover-float text-center flex flex-col items-center order-3 md:order-3 bg-[#ffdad6]/40 animate-enter delay-200">
                        <div class="relative mb-sm">
                            <div class="w-16 h-16 rounded-full border-2 border-on-background overflow-hidden bg-error-container">
                                ${this.renderAvatarSVG(r3.avatar_url, r3.username)}
                            </div>
                            <span class="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 bg-error text-on-error border-2 border-on-background rounded-full font-label-sm text-label-sm font-bold">3rd</span>
                        </div>
                        <h3 class="font-headline-md text-headline-md text-on-background mt-2 font-bold">${r3.username}</h3>
                        <p class="font-body-md text-body-md text-on-surface-variant">${r3.streak_days} Day Streak 🔥</p>
                        <div class="mt-sm bg-surface rounded-lg border-2 border-on-background px-3 py-1 font-label-sm text-label-sm font-bold">
                            ${r3.points} Points
                        </div>
                    </div>` : '<div class="order-3"></div>'}
                    `;
                }
            }

            // Rankings Table
            const tableBody = document.getElementById('leaderboard-table-body');
            if (tableBody) {
                if (!data.rankings || data.rankings.length === 0) {
                    tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" class="py-8 text-center text-on-surface-variant font-bold">
                            No registered candidate records found. Complete a quiz to rank on the leaderboard!
                        </td>
                    </tr>
                    `;
                } else {
                    tableBody.innerHTML = data.rankings.map(r => {
                        const isYou = r.is_current || (this.user && r.username === this.user.username);
                        const rowClass = isYou ? 'bg-primary-fixed/50 font-bold' : 'hover:bg-surface-container';

                        return `
                        <tr class="border-b border-on-background/10 ${rowClass}">
                            <td class="py-3 px-4">
                                <span class="w-7 h-7 rounded-full border-2 border-on-background flex items-center justify-center font-bold text-label-sm ${r.rank <= 3 ? 'bg-tertiary-fixed' : 'bg-surface'}">${r.rank}</span>
                            </td>
                            <td class="py-3 px-4">
                                <div class="flex items-center gap-3">
                                    <div class="w-9 h-9 rounded-full border border-on-background overflow-hidden shrink-0">
                                        ${this.renderAvatarSVG(r.avatar_url, r.username)}
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <span class="font-body-md ${isYou ? 'text-primary font-bold' : 'text-on-background'}">${r.username}</span>
                                        ${isYou ? '<span class="text-[10px] px-2 py-0.5 rounded-full bg-primary text-on-primary font-black uppercase">You</span>' : ''}
                                    </div>
                                </div>
                            </td>
                            <td class="py-3 px-4 font-body-md">${r.streak_days} Days 🔥</td>
                            <td class="py-3 px-4 font-body-md">${r.accuracy}%</td>
                            <td class="py-3 px-4 text-right font-headline-md text-[18px] text-primary font-bold">${r.points}</td>
                        </tr>
                        `;
                    }).join('');
                }
            }
        } catch (e) {
            console.error('Leaderboard load failed:', e);
        }
    }

    // --- Active Recall Engine ---
    async initActiveRecall() {
        const pills = document.getElementById('recall-category-pills');
        if (pills && this.categories.length > 0) {
            pills.innerHTML = this.categories.map(c => {
                const isSelected = (c.slug === this.recallState.category);
                const pillClass = isSelected ?
                    'bg-primary text-on-primary border-on-background shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-bold' :
                    'bg-surface text-on-surface border-on-background hover:bg-surface-variant font-medium';

                return `
                <button onclick="app.switchRecallCategory('${c.slug}')" class="px-4 py-2 border-2 rounded-full font-label-sm whitespace-nowrap neo-shadow-sm cursor-pointer transition-all ${pillClass}">
                    ${c.name}
                </button>
                `;
            }).join('');
        }

        await this.loadRecallQuestions(this.recallState.category);
    }

    async switchRecallCategory(slug) {
        if (this.recallState.category === slug && this.recallState.questions && this.recallState.questions.length > 0) return;
        this.recallState.category = slug;
        this.initActiveRecall();
    }

    async loadRecallQuestions(slug) {
        const skeleton = document.getElementById('recall-loading-skeleton');
        const cardScene = document.getElementById('recall-card-scene');
        const completeBox = document.getElementById('recall-complete-box');
        const controls = document.getElementById('recall-controls-container');

        if (skeleton) skeleton.classList.remove('hidden');
        if (cardScene) cardScene.classList.add('hidden');
        if (completeBox) completeBox.classList.add('hidden');
        if (controls) controls.classList.add('hidden');

        try {
            const res = await fetch(`/api/recall/cards?category=${encodeURIComponent(slug)}&count=20`, {
                headers: this.getAuthHeaders(false)
            });
            const data = await res.json();
            if (data.success && data.cards && data.cards.length > 0) {
                this.recallState.questions = data.cards;
                this.recallState.currentIndex = 0;
                this.recallState.isFlipped = false;

                const titleEl = document.getElementById('recall-deck-title');
                if (titleEl) titleEl.innerText = data.category_name || slug.replace(/_/g, ' ').toUpperCase();

                if (skeleton) skeleton.classList.add('hidden');
                if (cardScene) cardScene.classList.remove('hidden');
                if (controls) controls.classList.remove('hidden');
                this.renderRecallCard();
            } else {
                if (skeleton) skeleton.classList.add('hidden');
                if (cardScene) cardScene.classList.remove('hidden');
                if (controls) controls.classList.remove('hidden');
                this.showNotification('No flashcards available for this category yet.');
            }
        } catch (e) {
            console.error('Recall cards load failed:', e);
            if (skeleton) skeleton.classList.add('hidden');
            if (cardScene) cardScene.classList.remove('hidden');
            if (controls) controls.classList.remove('hidden');
        }
    }

    renderRecallCard() {
        const cardFlip = document.getElementById('recall-card-flip');
        if (cardFlip) {
            cardFlip.classList.remove('is-flipped');
            this.recallState.isFlipped = false;
        }

        const total = (this.recallState.questions || []).length;
        if (total === 0) return;

        const q = this.recallState.questions[this.recallState.currentIndex];
        if (!q) return;

        const numEl = document.getElementById('recall-card-num');
        if (numEl) numEl.innerText = `Card ${this.recallState.currentIndex + 1} / ${total}`;

        const progressFill = document.getElementById('recall-progress-fill');
        if (progressFill) {
            const pct = Math.round(((this.recallState.currentIndex + 1) / total) * 100);
            progressFill.style.width = `${pct}%`;
        }

        const topicEl = document.getElementById('recall-card-topic');
        if (topicEl) topicEl.innerText = q.subtopic || 'Concept Question';

        const qEl = document.getElementById('recall-card-question');
        if (qEl) {
            qEl.innerText = q.question;
            if (window.renderMath) renderMath(qEl);
        }

        const aEl = document.getElementById('recall-card-answer');
        if (aEl) {
            const letters = ['A', 'B', 'C', 'D'];
            const correctOpt = q.correct_answer || (q.options ? q.options[q.correct] : '');
            const correctLetter = q.correct_letter || letters[q.correct] || 'A';
            aEl.innerText = `(${correctLetter}): ${correctOpt}`;
            if (window.renderMath) renderMath(aEl);
        }

        const expEl = document.getElementById('recall-card-explanation');
        if (expEl) {
            expEl.innerText = q.explanation || 'Key concept note.';
            if (window.renderMath) renderMath(expEl);
        }
    }

    flipRecallCard() {
        const cardFlip = document.getElementById('recall-card-flip');
        if (cardFlip) {
            cardFlip.classList.toggle('is-flipped');
            this.recallState.isFlipped = cardFlip.classList.contains('is-flipped');
        }
    }

    async rateRecall(score) {
        const labels = ['Needs Review (<1m)', 'Hard (10m)', 'Good (1d)', 'Mastered (4d)'];
        const q = this.recallState.questions[this.recallState.currentIndex];

        // Send review telemetry to SQLite backend in background
        if (q) {
            fetch('/api/recall/review', {
                method: 'POST',
                headers: this.getAuthHeaders(true),
                body: JSON.stringify({
                    category: this.recallState.category,
                    rating: score,
                    card_id: q.id
                })
            }).then(r => r.json()).then(d => {
                if (d.success && d.xp_gained) {
                    this.showNotification(`+${d.xp_gained} XP — ${labels[score - 1]}`);
                }
            }).catch(() => {});
        }

        // Advance to next card or complete deck
        if (this.recallState.currentIndex < this.recallState.questions.length - 1) {
            this.recallState.currentIndex++;
            this.renderRecallCard();
        } else {
            const cardScene = document.getElementById('recall-card-scene');
            const completeBox = document.getElementById('recall-complete-box');
            const controls = document.getElementById('recall-controls-container');
            if (cardScene) cardScene.classList.add('hidden');
            if (controls) controls.classList.add('hidden');
            if (completeBox) completeBox.classList.remove('hidden');
            this.showNotification('🎉 Deck Completed! Great revision work.');
        }
    }

    nextRecallCard() {
        if (!this.recallState.questions || this.recallState.questions.length === 0) return;
        if (this.recallState.currentIndex < this.recallState.questions.length - 1) {
            this.recallState.currentIndex++;
            this.renderRecallCard();
        } else {
            this.showNotification('You are on the last card of this deck.');
        }
    }

    prevRecallCard() {
        if (!this.recallState.questions || this.recallState.questions.length === 0) return;
        if (this.recallState.currentIndex > 0) {
            this.recallState.currentIndex--;
            this.renderRecallCard();
        } else {
            this.showNotification('You are on the first card.');
        }
    }

    shuffleRecallDeck() {
        if (!this.recallState.questions || this.recallState.questions.length <= 1) return;
        // Fisher-Yates shuffle
        for (let i = this.recallState.questions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.recallState.questions[i], this.recallState.questions[j]] = [this.recallState.questions[j], this.recallState.questions[i]];
        }
        this.recallState.currentIndex = 0;
        this.restartRecallDeck();
        this.showNotification('🔀 Deck shuffled!');
    }

    restartRecallDeck() {
        this.recallState.currentIndex = 0;
        const cardScene = document.getElementById('recall-card-scene');
        const completeBox = document.getElementById('recall-complete-box');
        const controls = document.getElementById('recall-controls-container');
        if (completeBox) completeBox.classList.add('hidden');
        if (cardScene) cardScene.classList.remove('hidden');
        if (controls) controls.classList.remove('hidden');
        this.renderRecallCard();
    }

    nextRecallCategory() {
        if (!this.categories || this.categories.length === 0) return;
        const currentIdx = this.categories.findIndex(c => c.slug === this.recallState.category);
        const nextIdx = (currentIdx + 1) % this.categories.length;
        this.switchRecallCategory(this.categories[nextIdx].slug);
    }

    // --- Real SQLite User Account Authentication & Modal ---
    async checkAuthSession() {
        if (!this.authToken) {
            this.user = null;
            return;
        }
        try {
            const res = await fetch('/api/auth/me', {
                headers: this.getAuthHeaders(false)
            });
            const data = await res.json();
            if (data.success && data.authenticated && data.user) {
                this.user = data.user;
                this.saveUser();
            } else {
                this.authToken = null;
                this.user = null;
                localStorage.removeItem('mpsc_token');
                localStorage.removeItem('mpsc_user');
            }
        } catch (e) {
            console.warn('Auth session check failed:', e);
        }
    }

    openAuthModal(mode = 'login') {
        const modal = document.getElementById('modal-auth');
        if (!modal) return;
        modal.classList.remove('hidden');

        const unauthedView = document.getElementById('auth-unauthed-view');
        const authedView = document.getElementById('auth-authed-view');
        const alertBox = document.getElementById('auth-alert-msg');
        if (alertBox) alertBox.classList.add('hidden');

        if (this.user && mode !== 'login' && mode !== 'register') {
            if (unauthedView) unauthedView.classList.add('hidden');
            if (authedView) authedView.classList.remove('hidden');

            const nameEl = document.getElementById('auth-authed-username');
            if (nameEl) nameEl.innerText = this.user.username;
            const streakEl = document.getElementById('auth-streak-stat');
            if (streakEl) streakEl.innerText = `${this.user.streak_days || 0} Days`;
            const avatarPreview = document.getElementById('auth-avatar-preview');
            if (avatarPreview) avatarPreview.innerText = (this.user.username || 'U')[0].toUpperCase();

            // Quick fetch real analytics for tests count
            fetch('/api/analytics', { headers: this.getAuthHeaders(false) })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        const testStat = document.getElementById('auth-total-tests-stat');
                        if (testStat) testStat.innerText = d.total_tests || 0;
                        if (streakEl && d.user) streakEl.innerText = `${d.user.streak_days || 0} Days`;
                    }
                }).catch(() => {});
        } else {
            if (unauthedView) unauthedView.classList.remove('hidden');
            if (authedView) authedView.classList.add('hidden');
            this.switchAuthTab(mode === 'register' ? 'register' : 'login');
            const pw = document.getElementById('auth-input-password');
            if (pw) pw.value = '';
        }
    }

    closeAuthModal() {
        const modal = document.getElementById('modal-auth');
        if (modal) modal.classList.add('hidden');
    }

    switchAuthTab(tab) {
        this.authTab = tab;
        const tabLogin = document.getElementById('tab-auth-login');
        const tabReg = document.getElementById('tab-auth-register');
        const subtitle = document.getElementById('auth-subtitle');
        const submitBtn = document.getElementById('auth-submit-btn');
        const alertBox = document.getElementById('auth-alert-msg');
        if (alertBox) alertBox.classList.add('hidden');

        if (tab === 'login') {
            if (tabLogin) {
                tabLogin.className = 'pb-2 font-headline-md font-bold text-primary border-b-[3px] border-primary cursor-pointer';
            }
            if (tabReg) {
                tabReg.className = 'pb-2 font-headline-md font-bold text-on-surface-variant hover:text-on-background cursor-pointer';
            }
            if (subtitle) {
                subtitle.innerText = 'Sign in with your username and password to access your SQLite-stored exam telemetry and analytics.';
            }
            if (submitBtn) {
                submitBtn.innerText = 'Sign In to MPSC LDA';
            }
        } else {
            if (tabReg) {
                tabReg.className = 'pb-2 font-headline-md font-bold text-primary border-b-[3px] border-primary cursor-pointer';
            }
            if (tabLogin) {
                tabLogin.className = 'pb-2 font-headline-md font-bold text-on-surface-variant hover:text-on-background cursor-pointer';
            }
            if (subtitle) {
                subtitle.innerText = 'Create a real SQLite user account with only a username and password. No email required.';
            }
            if (submitBtn) {
                submitBtn.innerText = 'Create Account';
            }
        }
    }

    async handleAuthSubmit(event) {
        if (event) event.preventDefault();
        const usernameInput = document.getElementById('auth-input-username');
        const passwordInput = document.getElementById('auth-input-password');
        const submitBtn = document.getElementById('auth-submit-btn');

        const username = usernameInput ? usernameInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';

        if (!username || username.length < 3) {
            this.showAuthAlert('Username must be at least 3 characters.', 'error');
            return;
        }
        if (!password || password.length < 4) {
            this.showAuthAlert('Password must be at least 4 characters.', 'error');
            return;
        }

        const originalBtnText = submitBtn ? submitBtn.innerText : 'Submit';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = this.authTab === 'register' ? 'Creating Account...' : 'Signing In...';
        }

        const endpoint = this.authTab === 'register' ? '/api/auth/register' : '/api/auth/login';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (data.success) {
                this.authToken = data.token;
                localStorage.setItem('mpsc_token', data.token);
                this.user = data.user;
                this.saveUser();
                this.updateUserUI();
                this.closeAuthModal();

                const welcomeMsg = this.authTab === 'register' 
                    ? `Account created! Welcome, ${data.user.username}.`
                    : `Welcome back, ${data.user.username}!`;
                this.showNotification(welcomeMsg);

                if (this.currentView === 'analytics') {
                    this.loadAnalytics();
                }
            } else {
                this.showAuthAlert(data.error || 'Authentication failed. Please check your credentials.', 'error');
            }
        } catch (err) {
            console.error('Auth request failed:', err);
            this.showAuthAlert('Connection error. Could not reach authentication service.', 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = originalBtnText;
            }
        }
    }

    showAuthAlert(message, type = 'error') {
        const alertBox = document.getElementById('auth-alert-msg');
        if (!alertBox) return;
        alertBox.classList.remove('hidden', 'bg-error-container', 'text-error', 'border-error', 'bg-[#d0f4de]', 'text-[#1b6a3b]', 'border-[#1b6a3b]');
        if (type === 'error') {
            alertBox.classList.add('bg-error-container', 'text-error', 'border-error');
        } else {
            alertBox.classList.add('bg-[#d0f4de]', 'text-[#1b6a3b]', 'border-[#1b6a3b]');
        }
        alertBox.innerText = message;
    }

    async logout() {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: this.getAuthHeaders(true)
            });
        } catch (e) {}

        this.authToken = null;
        this.user = null;
        localStorage.removeItem('mpsc_token');
        localStorage.removeItem('mpsc_user');
        this.updateUserUI();
        this.closeAuthModal();
        this.showNotification('You have successfully signed out.');

        if (this.currentView === 'analytics') {
            this.loadAnalytics();
        }
    }

    showNotification(msg) {
        const existing = document.getElementById('app-notification');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'app-notification';
        toast.className = 'fixed bottom-6 right-6 z-[200] px-5 py-3 bg-surface border-[3px] border-on-background rounded-xl font-body-md font-bold neo-shadow animate-fade-up flex items-center gap-3';
        toast.innerHTML = `
            <span class="material-symbols-outlined text-primary text-[22px]">info</span>
            <span>${msg}</span>
            <button onclick="this.parentElement.remove()" class="ml-2 font-bold text-outline hover:text-on-background">✕</button>
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            if (toast && toast.parentElement) toast.remove();
        }, 4000);
    }
}

// Instantiate global app
window.app = new MPSCApp();
