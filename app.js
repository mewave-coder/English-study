/* ── 데이터 저장소 (localStorage) ── */
const DB = {
    KEY: 'study_entries',
    all() {
        return JSON.parse(localStorage.getItem(this.KEY) || '[]');
    },
    save(entries) {
        localStorage.setItem(this.KEY, JSON.stringify(entries));
    },
    add(entry) {
        const entries = this.all();
        entry.id = Date.now();
        entry.created_at = new Date().toISOString();
        entries.push(entry);
        this.save(entries);
        return entry;
    },
    update(id, data) {
        const entries = this.all().map(e => e.id === id ? { ...e, ...data } : e);
        this.save(entries);
    },
    delete(id) {
        this.save(this.all().filter(e => e.id !== id));
    },
    byDate(date) {
        return this.all()
            .filter(e => e.date === date)
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    dates() {
        const map = {};
        this.all().forEach(e => { map[e.date] = (map[e.date] || 0) + 1; });
        return Object.entries(map)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([date, count]) => ({ date, count }));
    }
};

/* ── 퀴즈 생성 ── */
const STOP_WORDS = new Set([
    'the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could',
    'should','may','might','shall','can','that','this','these',
    'those','it','its','in','on','at','to','for','of','with',
    'by','from','and','or','but','not','no','so','as','if',
    'he','she','they','we','you','his','her','their','our',
    'your','my','also','into','about','than','more','one','when',
    'what','which','who','how','why','even','just','now','then',
    'still','up','out','over','back','down','after','before',
    'between','through','against','during','without','toward',
    'because','while','since','both','each','other','some',
    'such','only','most','less','least','very','too','here',
    'there','where','says','said','like','well','make','made',
    'take','come','know','get','got','give','puts','put',
    'much','many','new','own','same','used','already','them',
]);

const DUMMY_WORDS = [
    'unprecedented','resilient','eloquent','pragmatic','meticulous',
    'tenacious','volatile','serendipity','ambiguous','profound',
    'comprehensive','substantial','innovative','catalyst','leverage',
    'scrutinize','dilemma','retaliate','escalate','negotiate',
];

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function isMostlyEnglish(text) {
    const alpha = [...text].filter(c => /[a-zA-Z\uAC00-\uD7AF\u4e00-\u9fa5]/.test(c));
    if (!alpha.length) return false;
    const eng = [...text].filter(c => /[a-zA-Z]/.test(c));
    return eng.length / alpha.length > 0.7;
}

function generateBlankQuiz(sentencesText) {
    if (!sentencesText) return [];
    const quiz = [];
    for (const line of sentencesText.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || !isMostlyEnglish(trimmed)) continue;
        let clean = trimmed
            .replace(/\*\*/g, '')
            .replace(/^\d+[\s\.\)]*/,'')
            .replace(/[^\x00-\x7F]/g, '')
            .trim();
        if (clean.split(/\s+/).length < 6) continue;

        const wordRe = /\b([a-zA-Z]{5,})\b/g;
        const candidates = [];
        let m;
        while ((m = wordRe.exec(clean)) !== null) {
            if (!STOP_WORDS.has(m[1].toLowerCase())) {
                candidates.push({ start: m.index, end: m.index + m[0].length, word: m[1] });
            }
        }
        if (!candidates.length) continue;

        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        const blanked = clean.slice(0, chosen.start) + '_'.repeat(Math.max(6, chosen.word.length)) + clean.slice(chosen.end);
        quiz.push({ original: clean, blanked, answer: chosen.word });
        if (quiz.length >= 8) break;
    }

    const allAnswers = quiz.map(q => q.answer);
    for (const item of quiz) {
        const pool = shuffle([
            ...allAnswers.filter(w => w !== item.answer),
            ...DUMMY_WORDS.filter(w => w !== item.answer)
        ]);
        const distractors = [...new Set(pool)].slice(0, 2);
        item.choices = shuffle([...distractors, item.answer]);
    }
    return quiz;
}

function parseVocabulary(wordsText) {
    if (!wordsText) return [];
    const vocab = [];
    for (const line of wordsText.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        for (const sep of [' - ', ': ', ' | ', ' – ', ' : ']) {
            if (t.includes(sep)) {
                const idx = t.indexOf(sep);
                const word = t.slice(0, idx).trim();
                const meaning = t.slice(idx + sep.length).trim();
                if (word && meaning && isMostlyEnglish(word)) vocab.push({ word, meaning });
                break;
            }
        }
    }
    return vocab;
}

function generateVocabQuiz(wordsText) {
    const vocab = parseVocabulary(wordsText);
    if (vocab.length < 2) return [];
    const quizWords = shuffle(vocab).slice(0, 5);
    const allWords = vocab.map(v => v.word);
    return quizWords.map(item => {
        const pool = shuffle([
            ...allWords.filter(w => w !== item.word),
            ...DUMMY_WORDS.filter(w => w !== item.word)
        ]);
        const distractors = [...new Set(pool)].slice(0, 3);
        return { meaning: item.meaning, choices: shuffle([...distractors, item.word]), answer: item.word };
    });
}

/* ── 상태 ── */
let currentDate = null;
let editingId = null;
let quizEntryId = null;
let quizState = { blank: [], vocab: [], answers: {} };
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();

/* ── 초기화 ── */
document.addEventListener('DOMContentLoaded', () => {
    setupSidebar();
    setupModal();
    setupQuizModal();
    render();
});

/* ── YouTube 스크립트 가져오기 ── */
function extractYouTubeId(url) {
    const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

async function fetchYouTubeTranscript(videoId) {
    const proxyBase = 'https://corsproxy.io/?';
    // Try English first, then auto-generated
    const langs = ['en', 'en-US', 'a.en'];
    for (const lang of langs) {
        try {
            const url = `https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}`;
            const res = await fetch(proxyBase + encodeURIComponent(url));
            if (!res.ok) continue;
            const xml = await res.text();
            if (!xml.trim() || !xml.includes('<text')) continue;
            const doc = new DOMParser().parseFromString(xml, 'text/xml');
            const texts = [...doc.querySelectorAll('text')]
                .map(t => t.textContent
                    .replace(/&#39;/g, "'")
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .trim())
                .filter(Boolean);
            if (texts.length) return texts.join(' ');
        } catch {}
    }
    throw new Error('이 영상의 스크립트를 가져올 수 없습니다.');
}

function updateYtFetchBtn() {
    const url = document.getElementById('entry-link').value.trim();
    const btn = document.getElementById('yt-fetch-btn');
    btn.style.display = extractYouTubeId(url) ? 'inline-flex' : 'none';
}

async function handleYtFetch() {
    const url = document.getElementById('entry-link').value.trim();
    const videoId = extractYouTubeId(url);
    if (!videoId) return;

    const transcriptEl = document.getElementById('entry-transcript');
    const statusEl = document.getElementById('yt-fetch-status');
    const btn = document.getElementById('yt-fetch-btn');

    btn.disabled = true;
    btn.textContent = '가져오는 중...';
    statusEl.textContent = 'YouTube 스크립트 불러오는 중...';
    statusEl.className = '';

    try {
        const transcript = await fetchYouTubeTranscript(videoId);
        transcriptEl.value = transcript;
        statusEl.textContent = `✅ 스크립트 ${transcript.split(' ').length}단어 가져옴`;
        statusEl.className = 'success';
        showToast('YouTube 스크립트를 가져왔습니다!', 'success');
    } catch (err) {
        statusEl.textContent = '❌ ' + err.message;
        statusEl.className = 'error';
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '스크립트 가져오기';
    }
}

/* ── 사이드바 ── */
function setupSidebar() {
    document.getElementById('hamburger-btn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('sidebar-overlay').classList.toggle('show');
    });
    document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
}

/* ── 캘린더 ── */
function renderCalendar() {
    const container = document.getElementById('sidebar-calendar');
    const datesWithEntries = new Set(DB.dates().map(d => d.date));

    const year = calendarYear;
    const month = calendarMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = todayStr();

    const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    const dowLabels = ['일','월','화','수','목','금','토'];

    let html = `<div class="cal-header">
        <button class="cal-nav" id="cal-prev">‹</button>
        <span class="cal-month-label">${year}년 ${monthNames[month]}</span>
        <button class="cal-nav" id="cal-next">›</button>
    </div><div class="cal-grid">`;

    dowLabels.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
    for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell"></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        let cls = 'cal-cell clickable';
        if (datesWithEntries.has(ds)) cls += ' has-entry';
        if (ds === today) cls += ' today';
        if (ds === currentDate) cls += ' active';
        html += `<div class="${cls}" data-date="${ds}">${d}</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;

    container.querySelector('#cal-prev').addEventListener('click', e => {
        e.stopPropagation();
        calendarMonth--;
        if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
        renderCalendar();
    });
    container.querySelector('#cal-next').addEventListener('click', e => {
        e.stopPropagation();
        calendarMonth++;
        if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
        renderCalendar();
    });
    container.querySelectorAll('.cal-cell.clickable').forEach(cell => {
        cell.addEventListener('click', () => {
            const date = cell.dataset.date;
            if (!DB.dates().find(d => d.date === date)) {
                showToast('해당 날짜에 학습 내역이 없습니다.', '');
                return;
            }
            currentDate = date;
            closeSidebar();
            render();
        });
    });
}

/* ── 렌더링 ── */
function render() {
    renderSidebar();
    renderEntries();
}

function renderSidebar() {
    const dates = DB.dates();
    const all = DB.all();
    document.getElementById('total-days').textContent = dates.length;
    document.getElementById('total-entries').textContent = all.length;

    renderCalendar();

    const list = document.getElementById('date-list');
    list.innerHTML = '';

    const allEl = document.createElement('div');
    allEl.className = 'date-item-all' + (currentDate === null ? ' active' : '');
    allEl.textContent = '전체 보기';
    allEl.onclick = () => { currentDate = null; closeSidebar(); render(); };
    list.appendChild(allEl);

    dates.forEach(({ date, count }) => {
        const el = document.createElement('div');
        el.className = 'date-item' + (currentDate === date ? ' active' : '');
        el.innerHTML = `<span>${formatSidebarDate(date)}</span><span class="date-count">${count}</span>`;
        el.onclick = () => { currentDate = date; closeSidebar(); render(); };
        list.appendChild(el);
    });
}

function renderEntries() {
    const entries = currentDate
        ? DB.byDate(currentDate)
        : DB.all().sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

    document.getElementById('current-date-title').textContent =
        currentDate ? formatHeaderDate(currentDate) : '전체 학습 내역';
    document.getElementById('entry-count-label').textContent = `${entries.length}개 항목`;

    const container = document.getElementById('entries-container');
    if (entries.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">📖</div>
                <h3>아직 학습 내역이 없습니다</h3>
                <p>"+ 추가" 버튼으로 오늘의 공부를 기록해보세요!</p>
            </div>`;
        return;
    }
    container.innerHTML = '';
    entries.forEach(e => container.appendChild(buildCard(e)));
}

function buildCard(entry) {
    const isYt = /(?:youtube\.com|youtu\.be)/.test(entry.link || '');
    const card = document.createElement('div');
    card.className = 'entry-card';

    const linkHtml = entry.link
        ? `<a class="entry-link-text" href="${escHtml(entry.link)}" target="_blank" onclick="event.stopPropagation()">${escHtml(entry.link)}</a>`
        : '';

    const badges = [
        isYt ? '<span class="yt-badge">▶ YouTube</span>' : '',
        entry.transcript ? '<span class="has-transcript-badge">스크립트 있음</span>' : '',
    ].filter(Boolean).join('');

    card.innerHTML = `
        <div class="entry-card-header">
            <div class="entry-header-left">
                <span class="entry-date-badge">${entry.date}</span>
                <div class="entry-meta">
                    <div class="entry-title">${escHtml(entry.title || '(제목 없음)')}</div>
                    ${linkHtml}
                </div>
            </div>
            <div class="entry-header-right">
                ${badges}
                <button class="quiz-btn">🎯 퀴즈</button>
                <button class="edit-btn" title="수정">✏️</button>
                <button class="delete-btn" title="삭제">🗑</button>
                <span class="chevron">▼</span>
            </div>
        </div>
        <div class="entry-body">
            ${buildSection('📝 공부한 문장', entry.sentences, false)}
            ${buildSection('📚 단어 & 표현', entry.words, false)}
            ${buildSection('🎬 스크립트', entry.transcript, true)}
        </div>`;

    card.querySelector('.entry-card-header').addEventListener('click', e => {
        if (e.target.closest('.quiz-btn,.edit-btn,.delete-btn,.entry-link-text')) return;
        card.classList.toggle('open');
    });
    card.querySelector('.quiz-btn').addEventListener('click', e => { e.stopPropagation(); openQuizModal(entry); });
    card.querySelector('.edit-btn').addEventListener('click', e => { e.stopPropagation(); openEditModal(entry); });
    card.querySelector('.delete-btn').addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('이 항목을 삭제하시겠습니까?')) return;
        DB.delete(entry.id);
        render();
        showToast('삭제되었습니다.', 'success');
    });
    return card;
}

function buildSection(label, content, isTranscript) {
    if (!content) return '';
    const inner = isTranscript
        ? `<div class="transcript-box">${escHtml(content)}</div>`
        : `<div class="section-content">${escHtml(content)}</div>`;
    return `<div class="entry-section"><div class="section-label">${label}</div>${inner}</div>`;
}

/* ── 추가/수정 모달 ── */
function setupModal() {
    document.getElementById('add-btn').onclick = openAddModal;
    document.getElementById('modal-close').onclick = closeModal;
    document.getElementById('cancel-btn').onclick = closeModal;
    document.getElementById('modal-overlay').onclick = e => { if (e.target.id === 'modal-overlay') closeModal(); };
    document.getElementById('entry-form').onsubmit = handleSubmit;

    // YouTube fetch
    const linkInput = document.getElementById('entry-link');
    linkInput.addEventListener('input', updateYtFetchBtn);
    linkInput.addEventListener('change', updateYtFetchBtn);
    document.getElementById('yt-fetch-btn').addEventListener('click', handleYtFetch);
}

function openAddModal() {
    editingId = null;
    document.getElementById('entry-form').reset();
    document.getElementById('entry-date').value = todayStr();
    document.getElementById('form-modal-title').textContent = '새 학습 추가';
    document.getElementById('save-btn').textContent = '저장하기';
    document.getElementById('yt-fetch-btn').style.display = 'none';
    document.getElementById('yt-fetch-status').textContent = '';
    document.getElementById('modal-overlay').classList.add('open');
}

function openEditModal(entry) {
    editingId = entry.id;
    document.getElementById('entry-date').value = entry.date;
    document.getElementById('entry-title').value = entry.title || '';
    document.getElementById('entry-link').value = entry.link || '';
    document.getElementById('entry-sentences').value = entry.sentences || '';
    document.getElementById('entry-words').value = entry.words || '';
    document.getElementById('entry-transcript').value = entry.transcript || '';
    document.getElementById('form-modal-title').textContent = '학습 수정';
    document.getElementById('save-btn').textContent = '수정 완료';
    document.getElementById('yt-fetch-status').textContent = '';
    updateYtFetchBtn();
    document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    editingId = null;
}

function handleSubmit(e) {
    e.preventDefault();
    const data = {
        date:       document.getElementById('entry-date').value,
        title:      document.getElementById('entry-title').value.trim(),
        link:       document.getElementById('entry-link').value.trim(),
        sentences:  document.getElementById('entry-sentences').value.trim(),
        words:      document.getElementById('entry-words').value.trim(),
        transcript: document.getElementById('entry-transcript').value.trim(),
    };
    if (!data.sentences && !data.words) {
        showToast('문장 또는 단어를 입력해주세요.', 'error'); return;
    }
    if (editingId) {
        DB.update(editingId, data);
        showToast('수정되었습니다.', 'success');
    } else {
        DB.add(data);
        showToast('저장되었습니다.', 'success');
    }
    closeModal();
    render();
}

/* ── 퀴즈 모달 ── */
function setupQuizModal() {
    document.getElementById('quiz-close').onclick = closeQuizModal;
    document.getElementById('quiz-overlay').onclick = e => { if (e.target.id === 'quiz-overlay') closeQuizModal(); };
    document.getElementById('quiz-retry-btn').onclick = () => {
        const entry = DB.all().find(e => e.id === quizEntryId);
        if (entry) openQuizModal(entry);
    };
}

function closeQuizModal() {
    document.getElementById('quiz-overlay').classList.remove('open');
    quizEntryId = null;
}

function openQuizModal(entry) {
    quizEntryId = entry.id;
    quizState = { blank: [], vocab: [], answers: {} };

    document.getElementById('quiz-modal-title').textContent = `퀴즈 — ${entry.title || '학습 항목'}`;
    document.getElementById('quiz-meta').textContent = '';
    document.getElementById('quiz-body').innerHTML =
        '<div class="quiz-loading"><span class="quiz-spinner"></span> 퀴즈 생성 중...</div>';
    document.getElementById('quiz-overlay').classList.add('open');

    setTimeout(() => {
        const blank = generateBlankQuiz(entry.sentences);
        const vocab = generateVocabQuiz(entry.words);

        if (!blank.length && !vocab.length) {
            document.getElementById('quiz-body').innerHTML =
                '<div class="empty-state"><div class="icon">😅</div><h3>퀴즈를 생성할 내용이 없습니다</h3><p>문장과 단어를 입력한 후 다시 시도해주세요.</p></div>';
            return;
        }
        quizState.blank = blank;
        quizState.vocab = vocab;
        renderQuiz();
    }, 300);
}

function renderQuiz() {
    const { blank, vocab } = quizState;
    const total = blank.length + vocab.length;
    document.getElementById('quiz-meta').textContent =
        `빈칸 ${blank.length}문제 · 단어 ${vocab.length}문제 · 총 ${total}문제`;

    let html = '';

    if (blank.length) {
        html += `<div class="quiz-section">
            <div class="quiz-section-title">✏️ 빈칸 채우기 <span>${blank.length}문제</span></div>`;
        blank.forEach((item, i) => {
            const marker = `<span class="blank-marker">${'_'.repeat(Math.max(4, item.answer.length))}</span>`;
            const sentence = escHtml(item.blanked).replace(/_{4,}/g, marker);
            const btns = item.choices.map(c =>
                `<button class="choice-btn" data-bqi="${i}" data-choice="${escHtml(c)}">${escHtml(c)}</button>`
            ).join('');
            html += `<div class="quiz-q" id="bq-${i}">
                <div class="blank-sentence">${sentence}</div>
                <div class="choices-grid three">${btns}</div>
            </div>`;
        });
        html += '</div>';
    }

    if (vocab.length) {
        html += `<div class="quiz-section">
            <div class="quiz-section-title">📚 단어 퀴즈 <span>${vocab.length}문제</span></div>`;
        vocab.forEach((item, i) => {
            const btns = item.choices.map(c =>
                `<button class="choice-btn" data-vqi="${i}" data-choice="${escHtml(c)}">${escHtml(c)}</button>`
            ).join('');
            html += `<div class="quiz-q" id="vq-${i}">
                <div class="vocab-label">다음 뜻에 맞는 단어를 고르세요</div>
                <div class="vocab-meaning">${escHtml(item.meaning)}</div>
                <div class="choices-grid">${btns}</div>
            </div>`;
        });
        html += '</div>';
    }

    html += `<div class="quiz-footer">
        <div class="score-badge" id="score-badge"></div>
        <div></div>
    </div>`;

    const body = document.getElementById('quiz-body');
    body.innerHTML = html;

    body.addEventListener('click', e => {
        const btn = e.target.closest('.choice-btn');
        if (!btn || btn.disabled) return;
        if (btn.dataset.bqi !== undefined) answerQuestion('b' + btn.dataset.bqi, btn.dataset.choice, btn.dataset.bqi, 'blank');
        else if (btn.dataset.vqi !== undefined) answerQuestion('v' + btn.dataset.vqi, btn.dataset.choice, btn.dataset.vqi, 'vocab');
    });
}

function answerQuestion(key, choice, idx, type) {
    if (quizState.answers[key] !== undefined) return;
    quizState.answers[key] = choice;

    const item = type === 'blank' ? quizState.blank[idx] : quizState.vocab[idx];
    const cardId = type === 'blank' ? `bq-${idx}` : `vq-${idx}`;
    const card = document.getElementById(cardId);

    card.querySelectorAll('.choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.choice === item.answer) btn.classList.add('correct-choice');
        else if (btn.dataset.choice === choice && choice !== item.answer) btn.classList.add('wrong-choice');
    });
    card.classList.add(choice === item.answer ? 'correct' : 'wrong');

    const total = quizState.blank.length + quizState.vocab.length;
    if (Object.keys(quizState.answers).length === total) {
        const correct = [
            ...quizState.blank.map((item, i) => quizState.answers['b' + i] === item.answer),
            ...quizState.vocab.map((item, i) => quizState.answers['v' + i] === item.answer),
        ].filter(Boolean).length;
        const pct = Math.round(correct / total * 100);
        const emoji = pct === 100 ? '🎉' : pct >= 70 ? '🎯' : '📖';
        const badge = document.getElementById('score-badge');
        badge.textContent = `${emoji} 최종 점수: ${correct} / ${total} (${pct}%)`;
        badge.classList.add('show');
    }
}

/* ── 유틸리티 ── */
function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function formatSidebarDate(dateStr) {
    const today = todayStr();
    const yesterday = new Date(Date.now() - 86400000);
    const yStr = yesterday.getFullYear() + '-' + String(yesterday.getMonth()+1).padStart(2,'0') + '-' + String(yesterday.getDate()).padStart(2,'0');
    if (dateStr === today) return '오늘';
    if (dateStr === yStr) return '어제';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}

function formatHeaderDate(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type}`;
    clearTimeout(toastTimer);
    requestAnimationFrame(() => {
        el.classList.add('show');
        toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
    });
}
