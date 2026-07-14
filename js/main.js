// ===== UTILS =====
const $ = (id) => document.getElementById(id);
const qsa = (sel, scope = document) => [...scope.querySelectorAll(sel)];
const isActivationKey = (e) => e.key === 'Enter' || e.key === ' ';

function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

// ===== STORAGE (sincronizado via Upstash Redis) =====
const storageKey = 'letterboxdReviews';
let reviewsCache = null;

const storage = {
    async get() {
        if (reviewsCache && Array.isArray(reviewsCache)) return [...reviewsCache];
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
        try {
            const resp = await fetch('/api/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
        try {
            const resp = await fetch('/api/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
        const nico = isOld ? Number(r.rating) : (r.ratingNico !== undefined && r.ratingNico !== null && r.ratingNico !== '') ? Number(r.ratingNico) : null;
        const nick = isOld ? Number(r.rating) : (r.ratingNick !== undefined && r.ratingNick !== null && r.ratingNick !== '') ? Number(r.ratingNick) : null;
        const nicoEff = nico === 0 ? null : nico;
        const nickEff = nick === 0 ? null : nick;
        let avg;
        if (nicoEff === null && nickEff === null) avg = null;
        else if (nicoEff === null) avg = nickEff;
        else if (nickEff === null) avg = nicoEff;
        else avg = (nicoEff + nickEff) / 2;
        return {
            id,
            movie: (r.movie || '').toString().trim() || `Filme ${i + 1}`,
            date: r.date || '',
            ratingNico: nico,
            ratingNick: nick,
            rating: avg !== null ? (Number.isInteger(avg) ? avg : +avg.toFixed(1)) : null,
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

// ===== RATING DISPLAY =====
const updateRatingDisplay = () => {
    const nEl = $('ratingNico');
    const kEl = $('ratingNick');
    const display = $('ratingDisplay');
    if (!display) return;
    const nv = nEl.value, kv = kEl.value;
    if (!nv && !kv) { display.value = ''; return; }
    const n = nv && Number(nv) !== 0 ? Number(nv) : null;
    const k = kv && Number(kv) !== 0 ? Number(kv) : null;
    let avg;
    if (n === null && k === null) avg = null;
    else if (n === null) avg = k;
    else if (k === null) avg = n;
    else avg = (n + k) / 2;
    display.value = avg !== null ? `${Number.isInteger(avg) ? avg : avg.toFixed(1)}/5` : '';
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
    const n = nRaw === 0 ? null : nRaw;
    const k = kRaw === 0 ? null : kRaw;
    let avg;
    if (n === null && k === null) avg = null;
    else if (n === null) avg = k;
    else if (k === null) avg = n;
    else avg = (n + k) / 2;

    let payload;
    if (editingId) {
        payload = {
            id: editingId,
            movie: movieName,
            date: movieDate,
            ratingNico: nRaw,
            ratingNick: kRaw,
            rating: avg !== null ? (Number.isInteger(avg) ? avg : +avg.toFixed(1)) : null,
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
            ratingNico: nRaw,
            ratingNick: kRaw,
            rating: avg !== null ? (Number.isInteger(avg) ? avg : +avg.toFixed(1)) : null,
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
    }
});

$('refreshBtn').addEventListener('click', () => {
    window.location.reload();
});

// ===== COUNTDOWN =====
function getNextSaturday() {
    const now = new Date();
    const result = new Date(now);
    const day = now.getDay();
    const daysUntilSaturday = (6 - day + 7) % 7;
    result.setDate(now.getDate() + daysUntilSaturday);
    result.setHours(0, 0, 0, 0);
    return result;
}

function updateCountdown() {
    const now = new Date();
    const day = now.getDay();
    const digits = $('countdownDigits');
    const eyebrow = document.querySelector('.countdown-eyebrow');
    if (day === 0 || day === 6) {
        digits.style.display = 'none';
        eyebrow.textContent = 'Fim de semana';
        return;
    }
    digits.style.display = '';
    eyebrow.textContent = 'Contando os segundos(literalmente) pra te ver';
    const diff = getNextSaturday() - now;
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    $('cdDays').textContent = String(days).padStart(2, '0');
    $('cdHours').textContent = String(hours).padStart(2, '0');
    $('cdMinutes').textContent = String(minutes).padStart(2, '0');
    $('cdSeconds').textContent = String(seconds).padStart(2, '0');
}

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

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
}
