// ===== UTILS =====
const $ = (id) => document.getElementById(id);
const qsa = (sel, scope = document) => [...scope.querySelectorAll(sel)];
const isActivationKey = (e) => e.key === 'Enter' || e.key === ' ';

// App secret para autenticação nas rotas POST da API.
// Em ambientes serverless (Vercel etc.), env vars no frontend são públicas por natureza.
// Para esconder de verdade, use um proxy/API route que injete o secret no server-side.
// Mesmo assim, a checagem no backend é mantida como barreira básica.
const APP_SECRET = '';

function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function calcAverageRating(nicoRaw, nickRaw) {
    const n = nicoRaw === 0 ? null : nicoRaw;
    const k = nickRaw === 0 ? null : nickRaw;
    let avg;
    if (n === null && k === null) avg = null;
    else if (n === null) avg = k;
    else if (k === null) avg = n;
    else avg = (n + k) / 2;
    return {
        nico: nicoRaw,
        nick: nickRaw,
        avg: avg !== null ? (Number.isInteger(avg) ? avg : +avg.toFixed(1)) : null
    };
}

const setModalOpen = (modal, isOpen) => {
    modal.classList.toggle('open', isOpen);
    modal.setAttribute('aria-hidden', String(!isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
};

const ratingStars = (rating) => {
    if (rating === null || rating === undefined || rating === '') return 'Sem nota';
    const n = Number(rating);
    if (n === 0) return '😴😴😴😴😴';
    const full = Math.floor(n);
    const half = n % 1 >= 0.5 ? '½' : '';
    return '⭐'.repeat(full) + half;
};

const showRatingNum = (rating) => {
    if (rating === null || rating === undefined || rating === '' || rating === 0) return '—';
    return `${rating}/5`;
};

const formatDateBR = (dateStr) => {
    if (!dateStr) return 'Sem data';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
};

// ===== STORAGE (sincronizado via Upstash Redis / Electron IPC) =====
const storageKey = 'letterboxdReviews';
let reviewsCache = null;
const isElectron = typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';

const storage = {
    async get() {
        if (reviewsCache && Array.isArray(reviewsCache)) return [...reviewsCache];
        if (isElectron) {
            try {
                reviewsCache = await window.electronAPI.getReviews();
                if (!Array.isArray(reviewsCache)) reviewsCache = [];
                return [...reviewsCache];
            } catch { }
        }
        try {
            const resp = await fetch('/api/reviews');
            if (resp.ok) {
                reviewsCache = await resp.json();
                if (!Array.isArray(reviewsCache)) reviewsCache = [];
                return [...reviewsCache];
            }
        } catch { }
        const raw = localStorage.getItem(storageKey);
        try {
            reviewsCache = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(reviewsCache)) reviewsCache = [];
        } catch { reviewsCache = []; }
        return [...reviewsCache];
    },
    async saveReview(review) {
        if (!review || !review.id) return;
        if (isElectron) {
            try {
                const reviews = await window.electronAPI.saveReview(review);
                if (Array.isArray(reviews)) reviewsCache = reviews;
                return true;
            } catch { }
        }
        try {
            const resp = await fetch('/api/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(APP_SECRET ? { 'X-App-Secret': APP_SECRET } : {}) },
                body: JSON.stringify({ op: 'upsert', review })
            });
            if (resp.ok) {
                const data = await resp.json();
                if (Array.isArray(data.reviews)) {
                    reviewsCache = data.reviews;
                    try { localStorage.setItem(storageKey, JSON.stringify(reviewsCache)); } catch { }
                }
                return true;
            }
        } catch { }
        if (reviewsCache) {
            const idx = reviewsCache.findIndex(r => r.id === review.id);
            if (idx >= 0) reviewsCache[idx] = review; else reviewsCache.push(review);
            try { localStorage.setItem(storageKey, JSON.stringify(reviewsCache)); } catch { }
        }
        return false;
    },
    async deleteReview(id) {
        if (isElectron) {
            try {
                const reviews = await window.electronAPI.deleteReview(id);
                if (Array.isArray(reviews)) reviewsCache = reviews;
                return true;
            } catch { }
        }
        try {
            const resp = await fetch('/api/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(APP_SECRET ? { 'X-App-Secret': APP_SECRET } : {}) },
                body: JSON.stringify({ op: 'delete', id })
            });
            if (resp.ok) {
                const data = await resp.json();
                if (Array.isArray(data.reviews)) {
                    reviewsCache = data.reviews;
                    try { localStorage.setItem(storageKey, JSON.stringify(reviewsCache)); } catch { }
                }
                return true;
            }
        } catch { }
        if (reviewsCache) {
            reviewsCache = reviewsCache.filter(r => r.id !== id);
            try { localStorage.setItem(storageKey, JSON.stringify(reviewsCache)); } catch { }
        }
        return false;
    }
};

// ===== STATE =====
let reviews = [];
let editingId = null;

function normalizeReview(r, i) {
    try {
        const id = r.id || generateId();
        const isOld = !('ratingNico' in r) && !('ratingNick' in r);
        const parseRating = (v) => {
            if (v === undefined || v === null || v === '') return null;
            const n = Number(v);
            return Number.isNaN(n) ? null : n;
        };
        const nicoParsed = isOld ? parseRating(r.rating) : parseRating(r.ratingNico);
        const nickParsed = isOld ? parseRating(r.rating) : parseRating(r.ratingNick);
        const { nico, nick, avg } = calcAverageRating(nicoParsed, nickParsed);
        return {
            id,
            movie: (r.movie || '').toString().trim() || `Filme ${i + 1}`,
            date: r.date || '',
            ratingNico: nico,
            ratingNick: nick,
            rating: avg,
            commentNico: typeof r.commentNico === 'string' && r.commentNico.trim() ? r.commentNico.trim() : (isOld ? (r.comment || '') : ''),
            commentNick: typeof r.commentNick === 'string' && r.commentNick.trim() ? r.commentNick.trim() : (isOld ? (r.comment || '') : '')
        };
    } catch { return null; }
}

function loadReviews() {
    return storage.get().then(items => {
        const normalized = items.map((r, i) => normalizeReview(r, i)).filter(Boolean);
        reviews = normalized.length ? normalized : [];
        renderReviews(reviews);
    }).catch(() => {
        reviews = [];
        renderReviews(reviews);
    });
}

// ===== RENDER LIST =====
function renderReviews(list) {
    const body = $('planilhaBody');
    if (!body) return;
    if (!list.length) {
        body.innerHTML = '<p class="empty-state">Nenhum filme ainda — adicione o primeiro!</p>';
        return;
    }
    const frag = document.createDocumentFragment();
    list.forEach((r, i) => {
        const item = document.createElement('div');
        item.className = 'movie-item';
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', `Ver detalhes de ${r.movie}`);

        item.innerHTML = `
            <span class="movie-rank">${i + 1}</span>
            <div class="movie-info">
                <div class="movie-title">${escapeHtml(r.movie)}</div>
                <div class="movie-date">${formatDateBR(r.date)}</div>
            </div>
            <div class="movie-score">
                ${r.rating !== null ? `<span class="movie-score-star">⭐</span><span class="movie-score-num">${r.rating}</span>` : `<span class="movie-score-num">—</span>`}
            </div>
            <span class="movie-chevron">›</span>
        `;

        item.addEventListener('click', () => openReviewSheet(r.id));
        item.addEventListener('keydown', e => { if (isActivationKey(e)) { e.preventDefault(); openReviewSheet(r.id); } });
        frag.appendChild(item);
    });
    body.replaceChildren(frag);
}

// ===== REVIEW SHEET =====
const reviewModal = $('reviewModal');
const sheetTitle = $('sheetTitle');
const sheetDate = $('sheetDate');
const sheetRatings = $('sheetRatings');
const sheetBubbles = $('sheetBubbles');
const sheetActions = $('sheetActions');

function openReviewSheet(id) {
    const r = reviews.find(rev => rev.id === id);
    if (!r) return;

    sheetTitle.textContent = r.movie;
    sheetDate.textContent = `Assistido em ${formatDateBR(r.date)}`;

    sheetRatings.innerHTML = `
        <div class="rating-chip">
            <span class="rating-chip-label">Nico</span>
            <span class="rating-chip-stars">${ratingStars(r.ratingNico)}</span>
            <span class="rating-chip-num">${showRatingNum(r.ratingNico)}</span>
        </div>
        <div class="rating-chip">
            <span class="rating-chip-label">Nick</span>
            <span class="rating-chip-stars">${ratingStars(r.ratingNick)}</span>
            <span class="rating-chip-num">${showRatingNum(r.ratingNick)}</span>
        </div>
        <div class="rating-chip geral">
            <span class="rating-chip-label">Geral</span>
            <span class="rating-chip-num" style="font-size:1rem;margin-top:0;">${showRatingNum(r.rating)}</span>
        </div>
    `;

    sheetBubbles.innerHTML = `
        <div class="bubble nico">
            <div class="bubble-author">Nico</div>
            <div class="bubble-text">${r.commentNico ? escapeHtml(r.commentNico) : 'Sem resenha ainda.'}</div>
        </div>
        <div class="bubble nick">
            <div class="bubble-author">Nick</div>
            <div class="bubble-text">${r.commentNick ? escapeHtml(r.commentNick) : 'Sem resenha ainda.'}</div>
        </div>
    `;

    sheetActions.innerHTML = '';
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn edit';
    editBtn.textContent = 'Editar';
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => { closeReviewSheet(); openEditReview(id); });

    const delBtn = document.createElement('button');
    delBtn.className = 'action-btn delete';
    delBtn.textContent = 'Deletar';
    delBtn.type = 'button';
    delBtn.addEventListener('click', () => { closeReviewSheet(); deleteReview(id); });

    sheetActions.appendChild(editBtn);
    sheetActions.appendChild(delBtn);

    setModalOpen(reviewModal, true);
}

function closeReviewSheet() { setModalOpen(reviewModal, false); }

$('closeReviewModal').addEventListener('click', closeReviewSheet);
reviewModal.addEventListener('click', e => { if (e.target === reviewModal) closeReviewSheet(); });

// Swipe to dismiss on mobile
let touchStartY = 0;
const reviewSheet = $('reviewSheet');
reviewSheet.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
reviewSheet.addEventListener('touchend', e => {
    const delta = e.changedTouches[0].clientY - touchStartY;
    if (delta > 80) closeReviewSheet();
}, { passive: true });

// ===== EDIT / DELETE =====
function openEditReview(id) {
    const r = reviews.find(rev => rev.id === id);
    if (!r) return;
    editingId = id;
    $('movieName').value = r.movie;
    $('movieDate').value = r.date;
    $('ratingNico').value = r.ratingNico !== null ? String(r.ratingNico) : '';
    $('ratingNick').value = r.ratingNick !== null ? String(r.ratingNick) : '';
    $('commentNico').value = r.commentNico || '';
    $('commentNick').value = r.commentNick || '';
    updateRatingDisplay();
    $('formTitle').textContent = 'Editar filme';
    $('submitBtn').textContent = 'Salvar alterações';
    $('movieName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('movieName').focus();
}

async function deleteReview(id) {
    if (!confirm('Deletar esse filme da lista?')) return;
    reviews = reviews.filter(r => r.id !== id);
    await storage.deleteReview(id);
    renderReviews(reviews);
    editingId = null;
}

async function deleteMomento(id) {
    if (!confirm('Tem certeza que quer excluir esse momento?')) return;
    closeMomentoActions();
    momentos = momentos.filter(m => m.id !== id);
    await momentosStorage.deleteMomento(id);
    renderMomentos();
    editingMomentoId = null;
}

// ===== RATING DISPLAY =====
const updateRatingDisplay = () => {
    const nEl = $('ratingNico');
    const kEl = $('ratingNick');
    const display = $('ratingDisplay');
    if (!display) return;
    const nv = nEl.value, kv = kEl.value;
    if (!nv && !kv) { display.value = ''; return; }
    const nParsed = nv !== '' ? Number(nv) : null;
    const kParsed = kv !== '' ? Number(kv) : null;
    const { avg } = calcAverageRating(nParsed, kParsed);
    display.value = avg !== null ? `${avg}/5` : '';
};

$('ratingNico').addEventListener('change', updateRatingDisplay);
$('ratingNick').addEventListener('change', updateRatingDisplay);

// ===== FORM SUBMIT =====
$('reviewForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const movieName = $('movieName').value.trim();
    const movieDate = $('movieDate').value;
    const ratingNico = $('ratingNico').value;
    const ratingNick = $('ratingNick').value;
    const commentNico = $('commentNico').value.trim();
    const commentNick = $('commentNick').value.trim();

    if (!movieName || !movieDate) {
        alert('Preencha pelo menos o nome do filme e a data.');
        return;
    }

    if (!ratingNico && !ratingNick && !commentNico && !commentNick) {
        alert('Preencha a nota ou a resenha de pelo menos um de vocês.');
        return;
    }

    const nRaw = ratingNico !== '' ? Number(ratingNico) : null;
    const kRaw = ratingNick !== '' ? Number(ratingNick) : null;
    const { nico: calcNico, nick: calcNick, avg } = calcAverageRating(nRaw, kRaw);

    let payload;
    if (editingId) {
        payload = {
            id: editingId,
            movie: movieName,
            date: movieDate,
            ratingNico: calcNico,
            ratingNick: calcNick,
            rating: avg,
            commentNico,
            commentNick
        };
        const idx = reviews.findIndex(r => r.id === editingId);
        if (idx >= 0) reviews[idx] = payload;
        editingId = null;
    } else {
        payload = {
            id: generateId(),
            movie: movieName,
            date: movieDate,
            ratingNico: calcNico,
            ratingNick: calcNick,
            rating: avg,
            commentNico,
            commentNick
        };
        reviews.push(payload);
    }

    await storage.saveReview(payload);
    renderReviews(reviews);
    $('reviewForm').reset();
    updateRatingDisplay();
    $('formTitle').textContent = 'Adicionar filme';
    $('submitBtn').textContent = 'Adicionar filme';
    $('movieName').focus();
});

// ===== GALLERY (carousel) =====
const wrapper = $('galeriaWrapper');
const dotsContainer = $('galeriaDots');
const totalPhotos = qsa('.galeria-item').length;
let currentIndex = 0;

const galeriaItems = qsa('.galeria-item');
for (let i = 0; i < totalPhotos; i++) {
    const dot = document.createElement('div');
    dot.className = 'galeria-dot-item' + (i === 0 ? ' active' : '');
    dotsContainer.appendChild(dot);
}
if (galeriaItems[0]) galeriaItems[0].classList.add('active');

function updateCarousel() {
    if (wrapper) wrapper.style.transform = `translateX(${-currentIndex * 100}%)`;
    qsa('.galeria-dot-item').forEach((d, i) => d.classList.toggle('active', i === currentIndex));
    qsa('.galeria-item').forEach((item, i) => item.classList.toggle('active', i === currentIndex));
}

$('nextBtn').addEventListener('click', () => { currentIndex = (currentIndex + 1) % totalPhotos; updateCarousel(); });
$('prevBtn').addEventListener('click', () => { currentIndex = (currentIndex - 1 + totalPhotos) % totalPhotos; updateCarousel(); });

let galTouchX = 0;
const galContainer = document.querySelector('.galeria-container');
galContainer.addEventListener('touchstart', e => { galTouchX = e.touches[0].clientX; }, { passive: true });
galContainer.addEventListener('touchend', e => {
    const diff = galTouchX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
        currentIndex = diff > 0
            ? (currentIndex + 1) % totalPhotos
            : (currentIndex - 1 + totalPhotos) % totalPhotos;
        updateCarousel();
    }
}, { passive: true });

updateCarousel();

qsa('.galeria-item').forEach(item => {
    const img = item.querySelector('img');
    if (!img) return;
    item.addEventListener('click', () => {
        $('lightboxImg').src = img.src;
        $('lightboxImg').alt = img.alt;
        setModalOpen($('lightbox'), true);
    });
});

$('lightbox').addEventListener('click', e => {
    if (e.target === $('lightbox')) {
        setModalOpen($('lightbox'), false);
        $('lightboxImg').src = '';
    }
});

// ===== RATINHO =====
const ratinhoMessages = [
    'Amo teus olhos',
    'Amo tuas tatuagens',
    'Amo teu estilo',
    'Amo tua boca',
    'Amo teu sorriso',
    'Amo tua gargalhada',
    'Amo o quanto tu me faz rir',
    'Amo cada detalhe teu',
    'Amo teu cabelo',
    'Amo teu cheiro',
    'Amo teu beijo',
    'Amo teu gosto musical',
    'Odeio teu time, mas te amo'
];

const ratoStages = [
    'assets/images/rato_com_flor.webp',
    'assets/images/rato1.webp',
    'assets/images/rato2.webp',
    'assets/images/rato3.webp',
    'assets/images/rato4.webp',
    'assets/images/rato5.webp',
    'assets/images/rato6.webp'
];
let ratoClickCount = 0;
let ratoExploded = false;

$('ratinhoBtn').addEventListener('click', () => {
    const msgEl = $('ratinhoMsg');
    if (ratoExploded) {
        ratoExploded = false;
        ratoClickCount = 0;
        $('ratinhoBtn').innerHTML = '<img src="assets/images/rato_com_flor.webp" alt="Ratinho com flores" loading="lazy" decoding="async">';
        msgEl.textContent = 'Clique no ratinho para ver o que eu amo em você';
        msgEl.classList.remove('visible');
        return;
    }

    const img = $('ratinhoBtn').querySelector('img');

    if (ratoClickCount < ratoStages.length - 1) {
        ratoClickCount++;
        img.src = ratoStages[ratoClickCount];
        img.classList.add('rato-grow');
        setTimeout(() => img.classList.remove('rato-grow'), 300);
        const msg = ratinhoMessages[Math.floor(Math.random() * ratinhoMessages.length)];
        msgEl.textContent = msg;
        msgEl.classList.add('visible');
    } else {
        ratoExploded = true;
        img.classList.add('rato-explode');

        if (navigator.vibrate) navigator.vibrate([30, 40, 30, 40, 80]);

        const rect = img.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const flash = document.createElement('div');
        flash.className = 'rato-flash';
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 650);

        const particleEmojis = ['🌻', '✨', '💛', '🌻', '✨'];
        const particleCount = 28;
        for (let i = 0; i < particleCount; i++) {
            const p = document.createElement('span');
            p.className = 'rato-particle';
            p.textContent = particleEmojis[Math.floor(Math.random() * particleEmojis.length)];

            const angle = (Math.PI * 2 * i) / particleCount + (Math.random() * 0.5 - 0.25);
            const distance = 90 + Math.random() * 160;
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance - 40;
            const rot = (Math.random() * 360 - 180) + 'deg';
            const size = (1 + Math.random() * 1.2).toFixed(2) + 'rem';
            const dur = (0.8 + Math.random() * 0.6).toFixed(2) + 's';
            const delay = (Math.random() * 0.12).toFixed(2) + 's';

            p.style.setProperty('--px', centerX + 'px');
            p.style.setProperty('--py', centerY + 'px');
            p.style.setProperty('--tx', tx + 'px');
            p.style.setProperty('--ty', ty + 'px');
            p.style.setProperty('--rot', rot);
            p.style.setProperty('--psize', size);
            p.style.setProperty('--pdur', dur);
            p.style.setProperty('--pdelay', delay);

            document.body.appendChild(p);
            setTimeout(() => p.remove(), 1800);
        }

        setTimeout(() => {
            $('ratinhoBtn').innerHTML = '<span class="girassol-final">🌻</span>';

            const reveal = document.createElement('div');
            reveal.className = 'rato-reveal';
            document.body.appendChild(reveal);

            for (let i = 0; i < 14; i++) {
                const petal = document.createElement('span');
                petal.className = 'rato-petal';
                petal.textContent = '🌼';
                petal.style.setProperty('--petx', Math.random() * 100 + 'vw');
                petal.style.setProperty('--petsize', (0.9 + Math.random() * 0.8).toFixed(2) + 'rem');
                petal.style.setProperty('--petdur', (2.8 + Math.random() * 1.4).toFixed(2) + 's');
                petal.style.setProperty('--petdelay', (Math.random() * 0.8).toFixed(2) + 's');
                document.body.appendChild(petal);
                setTimeout(() => petal.remove(), 5000);
            }

            setTimeout(() => reveal.remove(), 2600);
        }, 500);

        msgEl.textContent = 'Eu te amo 🌻';
        msgEl.classList.add('visible');
    }
});

// ===== CALENDAR =====
const calendarModal = $('calendarModal');
const calendarGrid = $('calendarGrid');
const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
let calDate = new Date();

function buildCalendar(date) {
    if (!calendarGrid) return;
    const year = date.getFullYear(), month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    $('currentMonth').textContent = `${monthNames[month]} ${year}`;

    const frag = document.createDocumentFragment();
    weekdays.forEach(d => {
        const el = document.createElement('div');
        el.className = 'cal-weekday';
        el.textContent = d;
        frag.appendChild(el);
    });

    const today = new Date();
    for (let i = 0; i < 42; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const el = document.createElement('div');
        el.className = 'cal-day';
        el.textContent = d.getDate();

        if (d.getMonth() !== month) el.classList.add('other-month');

        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const matching = reviews.filter(r => r.date === dateStr);

        if (matching.length) {
            el.classList.add('has-movie');
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            el.setAttribute('aria-label', `${matching.length} filme(s) em ${formatDateBR(dateStr)}`);
            el.addEventListener('click', (ev) => {
                ev.stopPropagation();
                setModalOpen(calendarModal, false);
                setTimeout(() => openReviewSheet(matching[0].id), 180);
            });
        }

        if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()) {
            el.classList.add('today');
        }

        frag.appendChild(el);
    }

    calendarGrid.replaceChildren(frag);
}

$('calendarBtn').addEventListener('click', e => {
    e.preventDefault();
    setModalOpen(calendarModal, true);
    buildCalendar(calDate);
});

$('closeCalendarModal').addEventListener('click', () => setModalOpen(calendarModal, false));
calendarModal.addEventListener('click', e => { if (e.target === calendarModal) setModalOpen(calendarModal, false); });

$('prevMonth').addEventListener('click', () => { calDate.setMonth(calDate.getMonth() - 1); buildCalendar(calDate); });
$('nextMonth').addEventListener('click', () => { calDate.setMonth(calDate.getMonth() + 1); buildCalendar(calDate); });

// ===== ESC KEY =====
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('lightbox').classList.contains('open')) {
        setModalOpen($('lightbox'), false);
        $('lightboxImg').src = '';
    } else if (reviewModal.classList.contains('open')) {
        closeReviewSheet();
    } else if (calendarModal.classList.contains('open')) {
        setModalOpen(calendarModal, false);
    } else if (timelineModal && timelineModal.classList.contains('open')) {
        closeTimeline();
    } else if ($('meetupModal').classList.contains('open')) {
        closeMeetupModal();
    }
});

$('refreshBtn').addEventListener('click', () => {
    window.location.reload();
});

// ===== MOMENTOS =====
const momentosStorageKey = 'nossaHistoria';
let momentosCache = null;

const momentosStorage = {
    async get() {
        if (momentosCache && Array.isArray(momentosCache)) return [...momentosCache];
        try {
            const resp = await fetch('/api/momentos');
            if (resp.ok) {
                momentosCache = await resp.json();
                if (!Array.isArray(momentosCache)) momentosCache = [];
                return [...momentosCache];
            }
        } catch { }
        const raw = localStorage.getItem(momentosStorageKey);
        try {
            momentosCache = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(momentosCache)) momentosCache = [];
        } catch { momentosCache = []; }
        return [...momentosCache];
    },
    async saveMomento(momento) {
        if (!momento || !momento.id) return;
        try {
            const resp = await fetch('/api/momentos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(APP_SECRET ? { 'X-App-Secret': APP_SECRET } : {}) },
                body: JSON.stringify({ op: 'upsert', momento })
            });
            if (resp.ok) {
                const data = await resp.json();
                if (Array.isArray(data.momentos)) {
                    momentosCache = data.momentos;
                    try { localStorage.setItem(momentosStorageKey, JSON.stringify(momentosCache)); } catch { }
                }
                return true;
            }
        } catch { }
        if (momentosCache) {
            const idx = momentosCache.findIndex(m => m.id === momento.id);
            if (idx >= 0) momentosCache[idx] = momento; else momentosCache.push(momento);
            try { localStorage.setItem(momentosStorageKey, JSON.stringify(momentosCache)); } catch { }
        }
        return false;
    },
    async deleteMomento(id) {
        if (isElectron) {
            try {
                const result = await window.electronAPI.deleteMomento(id);
                if (Array.isArray(result)) momentosCache = result;
                return true;
            } catch { }
        }
        try {
            const resp = await fetch('/api/momentos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(APP_SECRET ? { 'X-App-Secret': APP_SECRET } : {}) },
                body: JSON.stringify({ op: 'delete', id })
            });
            if (resp.ok) {
                const data = await resp.json();
                if (Array.isArray(data.momentos)) {
                    momentosCache = data.momentos;
                    try { localStorage.setItem(momentosStorageKey, JSON.stringify(momentosCache)); } catch { }
                }
                return true;
            }
        } catch { }
        if (momentosCache) {
            momentosCache = momentosCache.filter(m => m.id !== id);
            try { localStorage.setItem(momentosStorageKey, JSON.stringify(momentosCache)); } catch { }
        }
        return false;
    }
};

let momentos = [];
let editingMomentoId = null;

const SEED_MOMENTO = { id: 'seed-2024-06-29', data: '2024-06-29', mensagem: 'Primeiro filme juntos: Harry Potter, no shopping de Gravataí.' };

function formatMomentoDate(dateStr) {
    if (!dateStr) return '';
    const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const [y, m, d] = dateStr.split('-');
    return `${Number(d)} de ${meses[Number(m) - 1]}`;
}

function loadMomentos() {
    return momentosStorage.get().then(items => {
        if (!items.length) {
            momentos = [SEED_MOMENTO];
            momentosCache = [...momentos];
        } else {
            momentos = items;
        }
        momentos.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
        renderMomentos();
    }).catch(() => {
        momentos = [];
        renderMomentos();
    });
}

function renderMomentos() {
    const container = $('timelineList');
    if (!container) return;
    if (!momentos.length) {
        container.innerHTML = '<p class="empty-state">Nenhum momento ainda — adicione o primeiro!</p>';
        return;
    }
    const sorted = [...momentos].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
    const frag = document.createDocumentFragment();
    sorted.forEach(m => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.innerHTML = `
            <div class="timeline-dot" data-id="${escapeHtml(m.id)}"></div>
            <div class="timeline-content">
                <span class="timeline-date">${formatMomentoDate(m.data)}</span>
                <p class="timeline-msg">${escapeHtml(m.mensagem)}</p>
            </div>
        `;
        frag.appendChild(item);
    });
    container.replaceChildren(frag);
}

const timelineModal = $('timelineModal');

function openTimeline() {
    renderMomentos();
    setModalOpen(timelineModal, true);
}

function closeTimeline() {
    closeMomentoActions();
    setModalOpen(timelineModal, false);
    const form = $('momentoForm');
    const addBtn = $('addMomentoBtn');
    if (form) form.style.display = 'none';
    if (addBtn) addBtn.style.display = '';
    editingMomentoId = null;
    $('momentoSaveBtn').textContent = 'Salvar';
}

function setupMomentoForm() {
    const addBtn = $('addMomentoBtn');
    const form = $('momentoForm');
    const cancelBtn = $('momentoCancelBtn');
    if (!addBtn || !form || !cancelBtn) return;

    addBtn.addEventListener('click', () => {
        editingMomentoId = null;
        $('momentoSaveBtn').textContent = 'Salvar';
        form.style.display = 'block';
        addBtn.style.display = 'none';
        $('momentoData').value = new Date().toISOString().slice(0, 10);
        $('momentoMensagem').value = '';
        $('momentoMensagem').focus();
    });

    cancelBtn.addEventListener('click', () => {
        form.style.display = 'none';
        addBtn.style.display = '';
        editingMomentoId = null;
        $('momentoSaveBtn').textContent = 'Salvar';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const data = $('momentoData').value;
        const mensagem = $('momentoMensagem').value.trim();
        if (!data || !mensagem) {
            alert('Preencha a data e a mensagem.');
            return;
        }
        const id = editingMomentoId || generateId();
        const payload = { id, data, mensagem };
        const idx = momentos.findIndex(m => m.id === id);
        if (idx >= 0) {
            momentos[idx] = payload;
        } else {
            momentos.push(payload);
        }
        momentos.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
        await momentosStorage.saveMomento(payload);
        renderMomentos();
        form.style.display = 'none';
        addBtn.style.display = '';
        editingMomentoId = null;
        $('momentoSaveBtn').textContent = 'Salvar';
    });
}

if ($('timelineBtn')) {
    $('timelineBtn').addEventListener('click', openTimeline);
}
if ($('closeTimelineModal')) {
    $('closeTimelineModal').addEventListener('click', closeTimeline);
}
if (timelineModal) {
    timelineModal.addEventListener('click', e => { if (e.target === timelineModal) closeTimeline(); });
}
setupMomentoForm();

let dotState = { id: null, count: 0, timer: null };
const timelineList = $('timelineList');

function closeMomentoActions() {
    const existing = document.querySelector('.momento-actions');
    if (existing) existing.remove();
}

function showMomentoActions(item, momento) {
    closeMomentoActions();
    const actions = document.createElement('div');
    actions.className = 'momento-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'momento-action-btn momento-action-edit';
    editBtn.textContent = 'Editar';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'momento-action-btn momento-action-delete';
    deleteBtn.textContent = 'Excluir';
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    const content = item.querySelector('.timeline-content');
    content.after(actions);

    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMomentoActions();
        editingMomentoId = momento.id;
        $('momentoData').value = momento.data;
        $('momentoMensagem').value = momento.mensagem;
        $('momentoSaveBtn').textContent = 'Salvar alterações';
        const form = $('momentoForm');
        const addBtn = $('addMomentoBtn');
        form.style.display = 'block';
        addBtn.style.display = 'none';
        $('momentoMensagem').focus();
    });

    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMomento(momento.id);
    });
}

if (timelineList) {
    timelineList.addEventListener('click', (e) => {
        if (!e.target.closest('.momento-actions')) {
            closeMomentoActions();
        }

        const dot = e.target.closest('.timeline-dot');
        if (!dot) return;
        const momentoId = dot.dataset.id;
        if (!momentoId) return;

        if (dotState.id !== momentoId) {
            dotState.id = momentoId;
            dotState.count = 1;
            clearTimeout(dotState.timer);
            dotState.timer = setTimeout(() => { dotState = { id: null, count: 0, timer: null }; }, 2000);
        } else {
            dotState.count++;
        }

        if (dotState.count >= 3) {
            clearTimeout(dotState.timer);
            dotState = { id: null, count: 0, timer: null };

            const momento = momentos.find(m => m.id === momentoId);
            if (!momento) return;

            const item = dot.closest('.timeline-item');
            if (item) showMomentoActions(item, momento);
        }
    });
}

const MEETUP_STORAGE_KEY = 'meetupDate';

function getNextSaturdayDefault() {
    const now = new Date();
    const result = new Date(now);
    const day = now.getDay();
    const daysUntilSaturday = (6 - day + 7) % 7;
    result.setDate(now.getDate() + daysUntilSaturday);
    result.setHours(0, 0, 0, 0);
    return result;
}

function getMeetupDate() {
    const saved = localStorage.getItem(MEETUP_STORAGE_KEY);
    if (saved) {
        const d = new Date(saved);
        if (!isNaN(d.getTime())) return d;
    }
    const fallback = getNextSaturdayDefault();
    localStorage.setItem(MEETUP_STORAGE_KEY, fallback.toISOString());
    return fallback;
}

function updateCountdown() {
    const target = getMeetupDate();
    const now = new Date();
    const diff = target - now;
    const digits = $('countdownDigits');
    const eyebrow = document.querySelector('.countdown-eyebrow');

    if (diff <= 0) {
        $('cdDays').textContent = '00';
        $('cdHours').textContent = '00';
        $('cdMinutes').textContent = '00';
        $('cdSeconds').textContent = '00';
        eyebrow.textContent = 'Fim de semana';
        return;
    }

    eyebrow.textContent = 'Contando os segundos(literalmente) pra te ver';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    $('cdDays').textContent = String(days).padStart(2, '0');
    $('cdHours').textContent = String(hours).padStart(2, '0');
    $('cdMinutes').textContent = String(minutes).padStart(2, '0');
    $('cdSeconds').textContent = String(seconds).padStart(2, '0');
}

function openMeetupModal() {
    const current = getMeetupDate();
    const dateStr = current.getFullYear() + '-' +
        String(current.getMonth() + 1).padStart(2, '0') + '-' +
        String(current.getDate()).padStart(2, '0');
    const timeStr = String(current.getHours()).padStart(2, '0') + ':' +
        String(current.getMinutes()).padStart(2, '0');
    $('meetupDateInput').value = dateStr;
    $('meetupTimeInput').value = timeStr;
    setModalOpen($('meetupModal'), true);
}

function closeMeetupModal() {
    setModalOpen($('meetupModal'), false);
}

$('meetupSaveBtn').addEventListener('click', () => {
    const dateVal = $('meetupDateInput').value;
    const timeVal = $('meetupTimeInput').value;
    if (!dateVal || !timeVal) {
        alert('Preencha a data e a hora.');
        return;
    }
    const combined = new Date(dateVal + 'T' + timeVal + ':00');
    if (isNaN(combined.getTime())) {
        alert('Data ou hora inválida.');
        return;
    }
    localStorage.setItem(MEETUP_STORAGE_KEY, combined.toISOString());
    closeMeetupModal();
    updateCountdown();
});

$('meetupCancelBtn').addEventListener('click', closeMeetupModal);
$('closeMeetupModal').addEventListener('click', closeMeetupModal);
$('meetupModal').addEventListener('click', e => { if (e.target === $('meetupModal')) closeMeetupModal(); });

let meetupClickCount = 0;
let meetupClickTimer = null;

$('countdownDigits').addEventListener('click', () => {
    meetupClickCount++;
    if (meetupClickCount === 1) {
        meetupClickTimer = setTimeout(() => { meetupClickCount = 0; }, 2000);
    }
    if (meetupClickCount >= 4) {
        clearTimeout(meetupClickTimer);
        meetupClickCount = 0;
        openMeetupModal();
    }
});

updateCountdown();
setInterval(updateCountdown, 1000);

// ===== SCROLL REVEAL =====
if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15 });

    qsa('.scroll-reveal').forEach(el => revealObserver.observe(el));
}

// ===== INIT =====
loadReviews();
loadMomentos();

if ('serviceWorker' in navigator && !isElectron) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
}
