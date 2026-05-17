// ========== DATABASE SETUP (IndexedDB with Dexie) ==========
const db = new Dexie('HistoryStudyDB');
db.version(2).stores({
    flashcards: '++id, topic, question, answer, known, box, nextReviewDate',
    fillblanks: '++id, topic, title, text'
}).upgrade(async tx => {
    const flashcards = await tx.table('flashcards').toArray();
    for (const card of flashcards) {
        if (card.box === undefined) {
            await tx.table('flashcards').update(card.id, { 
                box: card.known ? 3 : 1,
                nextReviewDate: new Date().toISOString()
            });
        }
    }
});
// ========== USER ACCOUNTS (Simple Version) ==========
function switchUser(username) {
    if (!username || username.trim() === '') return;
    
    // Close current database
    if (db && db.close) db.close();
    
    // Create user-specific database name
    const cleanName = username.trim().replace(/[^a-zA-Z0-9]/g, '_');
    db = new Dexie(`HistoryStudyDB_${cleanName}`);
    
    // Setup database (same structure as original)
    db.version(2).stores({
        flashcards: '++id, topic, question, answer, known, box, nextReviewDate',
        fillblanks: '++id, topic, title, text'
    });
    
    // Open and load default data if needed
    db.open().then(async () => {
        const flashCount = await db.flashcards.count();
        if (flashCount === 0) {
            await loadDefaultData(); // Your existing loadDefaultData function
        }
        await refreshFlashcards();
        await loadBlankList();
        await updateManageStats();
    });
    
    // Save current user
    localStorage.setItem('currentUser', username);
}
// ========== LOAD DEFAULT DATA ==========
async function loadDefaultData() {
    const flashCount = await db.flashcards.count();
    if (flashCount === 0) {
        const defaultFlashcards = [
            { topic: 'germany', question: 'What was the Weimar Constitution?', answer: 'Democratic government of Germany established in 1919 with President, Reichstag, and proportional representation', known: false, box: 1, nextReviewDate: new Date().toISOString() },
            { topic: 'germany', question: 'What was Article 48?', answer: 'Clause allowing President to suspend civil liberties and rule by emergency decree', known: false, box: 1, nextReviewDate: new Date().toISOString() },
            { topic: 'germany', question: 'What was the Treaty of Versailles?', answer: '1919 peace treaty blaming Germany for WWI with £6.6bn reparations and army limited to 100,000', known: false, box: 1, nextReviewDate: new Date().toISOString() },
            { topic: 'germany', question: 'What was the Munich Putsch?', answer: 'Hitler\'s failed coup attempt in November 1923; led to Mein Kampf', known: false, box: 1, nextReviewDate: new Date().toISOString() },
            { topic: 'germany', question: 'What was Kristallnacht?', answer: 'Night of Broken Glass (1938) - Nazi attack on Jewish synagogues and shops', known: false, box: 1, nextReviewDate: new Date().toISOString() },
            { topic: 'usa', question: 'What was Prohibition?', answer: '18th Amendment (1920-33) banned alcohol; led to speakeasies and bootleggers', known: false, box: 1, nextReviewDate: new Date().toISOString() },
            { topic: 'usa', question: 'What was the Wall Street Crash?', answer: 'Stock market collapsed October 1929; Black Tuesday lost $10bn', known: false, box: 1, nextReviewDate: new Date().toISOString() },
            { topic: 'usa', question: 'What was the New Deal?', answer: 'FDR\'s 1930s programmes: CCC, WPA, Social Security, TVA', known: false, box: 1, nextReviewDate: new Date().toISOString() },
            { topic: 'usa', question: 'What was the Dust Bowl?', answer: '1930s drought on Great Plains forcing 2.5 million to move', known: false, box: 1, nextReviewDate: new Date().toISOString() },
            { topic: 'usa', question: 'What was the Social Security Act?', answer: '1935 law providing pensions and unemployment insurance', known: false, box: 1, nextReviewDate: new Date().toISOString() }
        ];
        await db.flashcards.bulkAdd(defaultFlashcards);
    }
    
    const blankCount = await db.fillblanks.count();
    if (blankCount === 0) {
        const defaultBlanks = [
            { topic: 'germany', title: 'Weimar Constitution', text: 'One feature of the Weimar Constitution was **proportional representation** which meant seats in the **Reichstag** were allocated by percentage of votes. A second feature was **Article 48** which allowed the President to rule by emergency decree.' },
            { topic: 'germany', title: 'Treaty of Versailles', text: 'The Treaty of Versailles forced Germany to accept the **war guilt clause (Article 231)** . Germany had to pay **£6.6 billion** in reparations and its army was limited to **100,000** soldiers.' },
            { topic: 'usa', title: 'Prohibition', text: 'Prohibition was introduced by the **18th Amendment** in **1920**. It banned alcohol, leading to illegal **speakeasies** and organised crime figures like **Al Capone** .' },
            { topic: 'usa', title: 'New Deal Programmes', text: 'The New Deal included the **CCC** which hired young men for environmental work, the **WPA** which built roads and schools, and the **Social Security Act** which provided pensions.' }
        ];
        await db.fillblanks.bulkAdd(defaultBlanks);
    }
}

// ========== GLOBAL STATE ==========
let currentFlashcards = [];
let currentFlashIndex = 0;
let isFlipped = false;
let currentTopic = 'germany';
let currentBlankId = null;
let currentQuizBlanks = [];
let studyMode = 'due';
let selectedBox = 1;
let currentFillTopic = 'germany';
let quickFindSearchTerm = '';
let currentEditingBlankId = null;
let currentEditingCardId = null;

// ========== DAILY STREAK ==========
let currentStreak = localStorage.getItem('studyStreak') ? parseInt(localStorage.getItem('studyStreak')) : 0;
let lastStudyDate = localStorage.getItem('lastStudyDate');

function updateStreak() {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    if (lastStudyDate === today) {
        // Already studied today, do nothing
    } else if (lastStudyDate === yesterdayStr) {
        currentStreak++;
        localStorage.setItem('studyStreak', currentStreak);
    } else if (lastStudyDate !== today) {
        currentStreak = 1;
        localStorage.setItem('studyStreak', currentStreak);
    }
    
    localStorage.setItem('lastStudyDate', today);
    lastStudyDate = today;
    
    const streakBadge = document.getElementById('streak-badge');
    if (streakBadge) streakBadge.textContent = `🔥 Streak: ${currentStreak} days`;
}

function recordStudy() {
    updateStreak();
}

// ========== HELPER FUNCTIONS ==========
function updateFlashcardDisplay() {
    if (currentFlashcards.length === 0) {
        document.getElementById('question-text').textContent = 'No flashcards due today! Add more or change study mode.';
        document.getElementById('answer-text').textContent = 'Click "All Cards" mode to see everything.';
        document.getElementById('card-counter').textContent = 'Card 0 / 0';
        document.getElementById('studied-badge').textContent = '✓ Known: 0';
        return;
    }
    const card = currentFlashcards[currentFlashIndex];
    document.getElementById('question-text').textContent = card.question;
    document.getElementById('answer-text').textContent = card.answer;
    document.getElementById('card-counter').textContent = `Card ${currentFlashIndex + 1} / ${currentFlashcards.length}`;
    const knownCount = currentFlashcards.filter(c => c.known).length;
    document.getElementById('studied-badge').textContent = `✓ Known: ${knownCount}`;
}

// ========== SPACED REPETITION FUNCTIONS ==========
function getBoxInterval(box) {
    const intervals = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 15 };
    return intervals[box] || 1;
}

function calculateNextReviewDate(box) {
    const interval = getBoxInterval(box);
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + interval);
    return nextDate.toISOString();
}

async function getDueCards(topic) {
    const today = new Date().toISOString().split('T')[0];
    const allCards = await db.flashcards.where('topic').equals(topic).toArray();
    return allCards.filter(card => {
        const reviewDate = card.nextReviewDate ? card.nextReviewDate.split('T')[0] : new Date().toISOString().split('T')[0];
        return reviewDate <= today;
    });
}

async function getAllCardsByTopic(topic) {
    return await db.flashcards.where('topic').equals(topic).toArray();
}

async function getCardsByBox(topic, box) {
    const allCards = await db.flashcards.where('topic').equals(topic).toArray();
    return allCards.filter(card => card.box === box);
}

async function updateCardAfterAnswer(cardId, wasCorrect) {
    const card = await db.flashcards.get(cardId);
    if (!card) return;
    
    let newBox = card.box || 1;
    
    if (wasCorrect) {
        newBox = Math.min(card.box + 1, 5);
    } else {
        newBox = 1;
    }
    
    const nextReviewDate = calculateNextReviewDate(newBox);
    
    await db.flashcards.update(cardId, { 
        box: newBox, 
        nextReviewDate: nextReviewDate,
        known: newBox >= 4
    });
}

async function updateBoxCounts() {
    for (let box = 1; box <= 5; box++) {
        const allCards = await db.flashcards.where('topic').equals(currentTopic).toArray();
        const count = allCards.filter(c => c.box === box).length;
        const element = document.getElementById(`box${box}Count`);
        if (element) element.textContent = count;
    }
}

async function loadCards(keepIndex = true) {
    let cards = [];
    
    switch(studyMode) {
        case 'due':
            cards = await getDueCards(currentTopic);
            break;
        case 'all':
            cards = await getAllCardsByTopic(currentTopic);
            break;
        case 'box':
            cards = await getCardsByBox(currentTopic, selectedBox);
            break;
    }
    
    cards.sort((a, b) => (a.box || 1) - (b.box || 1));
    
    const oldCardId = currentFlashcards[currentFlashIndex]?.id;
    
    currentFlashcards = cards;
    
    if (keepIndex && oldCardId) {
        const newIndex = currentFlashcards.findIndex(c => c.id === oldCardId);
        if (newIndex !== -1) {
            currentFlashIndex = newIndex;
        } else if (currentFlashIndex >= currentFlashcards.length) {
            currentFlashIndex = Math.max(0, currentFlashcards.length - 1);
        }
    } else if (!keepIndex) {
        currentFlashIndex = 0;
    }
    
    if (currentFlashcards.length === 0) {
        currentFlashIndex = 0;
    }
    if (currentFlashIndex >= currentFlashcards.length && currentFlashcards.length > 0) {
        currentFlashIndex = currentFlashcards.length - 1;
    }
    if (currentFlashIndex < 0) currentFlashIndex = 0;
    
    isFlipped = false;
    const flashcardEl = document.getElementById('flashcard');
    if (flashcardEl) flashcardEl.classList.remove('flipped');
    updateFlashcardDisplay();
    updateBoxCounts();
}

async function refreshFlashcards() {
    await loadCards(false);
}

async function refreshFlashcardsKeepPosition() {
    await loadCards(true);
}

async function markAnswerAndReview(wasCorrect) {
    if (currentFlashcards.length === 0) return;
    const card = currentFlashcards[currentFlashIndex];
    const currentCardId = card.id;
    const currentPosition = currentFlashIndex;
    
    await updateCardAfterAnswer(currentCardId, wasCorrect);
    
    await loadCards(true);
    
    const newIndex = currentFlashcards.findIndex(c => c.id === currentCardId);
    if (newIndex !== -1) {
        currentFlashIndex = newIndex;
    } else if (currentPosition < currentFlashcards.length) {
        currentFlashIndex = currentPosition;
    } else {
        currentFlashIndex = Math.max(0, currentFlashcards.length - 1);
    }
    
    updateFlashcardDisplay();
    recordStudy();
}

async function markAsCorrect() {
    await markAnswerAndReview(true);
}

async function markAsIncorrect() {
    await markAnswerAndReview(false);
}

// ========== FLASHCARD CRUD OPERATIONS ==========
async function addFlashcard(question, answer) {
    if (!question.trim() || !answer.trim()) {
        alert('Please enter both question and answer');
        return false;
    }
    await db.flashcards.add({
        topic: currentTopic,
        question: question.trim(),
        answer: answer.trim(),
        known: false,
        box: 1,
        nextReviewDate: new Date().toISOString()
    });
    await refreshFlashcards();
    return true;
}

async function bulkImportFlashcards(text) {
    const lines = text.split(/\r?\n/);
    let added = 0;
    for (const line of lines) {
        const separator = line.indexOf(' / ');
        if (separator === -1) continue;
        const question = line.substring(0, separator).trim();
        const answer = line.substring(separator + 3).trim();
        if (question && answer) {
            await db.flashcards.add({ 
                topic: currentTopic, 
                question, 
                answer, 
                known: false,
                box: 1,
                nextReviewDate: new Date().toISOString()
            });
            added++;
        }
    }
    alert(`Added ${added} flashcards`);
    await refreshFlashcards();
}

async function deleteCurrentFlashcard() {
    if (currentFlashcards.length === 0) return;
    const card = currentFlashcards[currentFlashIndex];
    if (confirm(`Delete "${card.question.substring(0, 50)}..."?`)) {
        await db.flashcards.delete(card.id);
        await refreshFlashcards();
    }
}

async function editCurrentFlashcard() {
    if (currentFlashcards.length === 0) return;
    const card = currentFlashcards[currentFlashIndex];
    
    currentEditingCardId = card.id;
    const modal = document.getElementById('editCardModal');
    if (modal) {
        document.getElementById('editCardQuestion').value = card.question;
        document.getElementById('editCardAnswer').value = card.answer;
        modal.style.display = 'flex';
    } else {
        alert('Edit modal not found. Please check HTML.');
    }
}

// ========== DARK MODE ==========
const darkModeToggle = document.getElementById('darkModeToggle');
if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark');
}
if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark');
        localStorage.setItem('darkMode', document.body.classList.contains('dark'));
    });
}

// ========== TAB SWITCHING ==========
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
tabs.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        tabs.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`${tabId}Tab`).classList.add('active');
        if (tabId === 'flashcards') refreshFlashcards();
        if (tabId === 'fillblank') loadBlankList();
        if (tabId === 'manage') updateManageStats();
    });
});

// ========== FLASHCARD EVENT LISTENERS ==========
document.getElementById('flip-btn')?.addEventListener('click', () => {
    document.getElementById('flashcard').classList.toggle('flipped');
    isFlipped = !isFlipped;
});

document.getElementById('prev-btn')?.addEventListener('click', async () => {
    if (currentFlashcards.length > 0) {
        currentFlashIndex = (currentFlashIndex - 1 + currentFlashcards.length) % currentFlashcards.length;
        isFlipped = false;
        document.getElementById('flashcard').classList.remove('flipped');
        updateFlashcardDisplay();
    }
});

document.getElementById('next-btn')?.addEventListener('click', async () => {
    if (currentFlashcards.length > 0) {
        currentFlashIndex = (currentFlashIndex + 1) % currentFlashcards.length;
        isFlipped = false;
        document.getElementById('flashcard').classList.remove('flipped');
        updateFlashcardDisplay();
    }
});

document.getElementById('mark-known-btn')?.addEventListener('click', markAsCorrect);
document.getElementById('mark-wrong-btn')?.addEventListener('click', markAsIncorrect);

document.getElementById('addFlashcardBtn')?.addEventListener('click', () => {
    const q = document.getElementById('newQuestion').value;
    const a = document.getElementById('newAnswer').value;
    addFlashcard(q, a);
    document.getElementById('newQuestion').value = '';
    document.getElementById('newAnswer').value = '';
});

document.getElementById('bulkImportBtn')?.addEventListener('click', () => {
    const text = document.getElementById('bulkImportText').value;
    if (text.trim()) bulkImportFlashcards(text);
});

document.getElementById('deleteCardBtn')?.addEventListener('click', deleteCurrentFlashcard);
document.getElementById('editCardBtn')?.addEventListener('click', editCurrentFlashcard);

document.querySelectorAll('.topic-flash').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.topic-flash').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTopic = btn.dataset.flashTopic;
        refreshFlashcards();
    });
});

// ========== STUDY MODE CONTROLS ==========
const radioButtons = document.querySelectorAll('input[name="studyMode"]');
const boxSelector = document.getElementById('boxSelector');

if (radioButtons.length) {
    radioButtons.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'due') {
                studyMode = 'due';
                if (boxSelector) boxSelector.style.display = 'none';
            } else if (e.target.value === 'all') {
                studyMode = 'all';
                if (boxSelector) boxSelector.style.display = 'none';
            } else if (e.target.value === 'box') {
                studyMode = 'box';
                if (boxSelector) boxSelector.style.display = 'inline-block';
            }
            refreshFlashcards();
        });
    });
}

if (boxSelector) {
    boxSelector.addEventListener('change', (e) => {
        selectedBox = parseInt(e.target.value);
        if (studyMode === 'box') {
            refreshFlashcards();
        }
    });
}

document.getElementById('resetStudyModeBtn')?.addEventListener('click', async () => {
    if (confirm('Reset all cards to Box 1 (Daily review)? This will clear all progress.')) {
        const allCards = await db.flashcards.toArray();
        for (const card of allCards) {
            await db.flashcards.update(card.id, {
                box: 1,
                nextReviewDate: new Date().toISOString(),
                known: false
            });
        }
        await refreshFlashcards();
        alert('All cards reset to Box 1');
    }
});

// ========== FILL-IN-BLANK FUNCTIONS ==========
function generateAcceptableAnswers(answer) {
    const variations = new Set();
    variations.add(answer);
    
    const noPunct = answer.replace(/[.,'"]/g, '');
    variations.add(noPunct);
    
    const synonyms = {
        'reichstag': ['reichstag', 'parliament', 'the reichstag', 'german parliament'],
        'proportional representation': ['proportional representation', 'pr', 'proportional voting'],
        'article 48': ['article 48', 'art 48', 'article forty eight'],
        'fuhrer': ['führer', 'fuhrer', 'leader', 'hitler'],
        'gestapo': ['gestapo', 'secret police'],
        'ccc': ['ccc', 'civilian conservation corps', 'the ccc'],
        'wpa': ['wpa', 'works progress administration', 'the wpa'],
        'tva': ['tva', 'tennessee valley authority', 'the tva'],
        'new deal': ['new deal', 'the new deal', 'fdrs new deal'],
        'prohibition': ['prohibition', '18th amendment', 'prohibition era'],
        'speakeasies': ['speakeasies', 'speakeasy', 'illegal bars'],
        'bootleggers': ['bootleggers', 'bootlegger', 'illegal alcohol sellers'],
        'dust bowl': ['dust bowl', 'the dust bowl', 'dustbowl']
    };
    
    for (const [key, values] of Object.entries(synonyms)) {
        if (answer.includes(key) || key.includes(answer)) {
            values.forEach(v => variations.add(v.toLowerCase()));
        }
    }
    
    return Array.from(variations);
}

function parseBlanks(text) {
    const regex = /\*\*(.*?)\*\*/g;
    const blanks = [];
    let lastIndex = 0;
    let match;
    let displayHtml = '';
    
    while ((match = regex.exec(text)) !== null) {
        const answerText = match[1];
        const answerLower = answerText.toLowerCase().trim();
        const acceptableAnswers = generateAcceptableAnswers(answerLower);
        const isShort = answerText.length < 8 || /^\d/.test(answerText) || /^(19|20)\d{2}/.test(answerText);
        const widthStyle = isShort ? 'style="width:85px; min-width:70px;"' : 'style="width:160px; min-width:130px;"';
        
        blanks.push({ original: answerText, answer: answerLower, acceptable: acceptableAnswers });
        displayHtml += text.substring(lastIndex, match.index) + `<input type="text" class="blank-input" data-answer="${answerLower}" data-acceptable='${JSON.stringify(acceptableAnswers)}' ${widthStyle} placeholder="______">`;
        lastIndex = match.index + match[0].length;
    }
    displayHtml += text.substring(lastIndex);
    
    return { blanks, displayHtml };
}

async function loadBlankList() {
    const container = document.getElementById('blankListContainer');
    if (!container) return;
    
    const blanks = await db.fillblanks.where('topic').equals(currentFillTopic).toArray();
    
    // Apply quick find filter
    let filteredBlanks = blanks;
    if (quickFindSearchTerm.trim() !== '') {
        const searchLower = quickFindSearchTerm.toLowerCase().trim();
        filteredBlanks = blanks.filter(blank => 
            blank.title.toLowerCase().includes(searchLower) ||
            blank.text.toLowerCase().includes(searchLower)
        );
    }
    
    // Update count displays
    const countSpan = document.getElementById('quickFindCount');
    if (countSpan) {
        if (quickFindSearchTerm.trim() !== '') {
            countSpan.textContent = `${filteredBlanks.length} / ${blanks.length} found`;
        } else {
            countSpan.textContent = `${blanks.length} total`;
        }
    }
    
    const randomCountSpan = document.getElementById('randomQuizCount');
    if (randomCountSpan) {
        randomCountSpan.textContent = blanks.length > 0 ? `(${blanks.length} available)` : '(0 available)';
    }
    
    if (filteredBlanks.length === 0) {
        if (quickFindSearchTerm.trim() !== '') {
            container.innerHTML = `<p>No fill-in-blanks match "${quickFindSearchTerm}"</p>`;
        } else {
            container.innerHTML = '<p>No fill-in-blanks yet. Create one above!</p>';
        }
        return;
    }
    
    // Build HTML
    container.innerHTML = filteredBlanks.map(blank => `
        <div class="blank-item" data-id="${blank.id}">
            <span><strong>${escapeHtml(blank.title)}</strong><br><small>${escapeHtml(blank.text.substring(0, 80))}...</small></span>
            <div>
                <button class="take-quiz-btn btn-small" data-id="${blank.id}">📖 Take Quiz</button>
                <button class="edit-blank-btn btn-small" data-id="${blank.id}">✏️ Edit</button>
                <button class="delete-blank-btn btn-small btn-danger" data-id="${blank.id}">🗑 Delete</button>
            </div>
        </div>
    `).join('');
    
    // Attach event listeners using onclick (faster)
    container.querySelectorAll('.take-quiz-btn').forEach(btn => {
        btn.onclick = () => takeQuiz(parseInt(btn.dataset.id));
    });
    container.querySelectorAll('.delete-blank-btn').forEach(btn => {
        btn.onclick = () => deleteBlank(parseInt(btn.dataset.id));
    });
    container.querySelectorAll('.edit-blank-btn').forEach(btn => {
        btn.onclick = () => editBlank(parseInt(btn.dataset.id));
    });
}

function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ========== QUICK FIND WITH DEBOUNCE ==========
let debounceTimer;
const quickFindInput = document.getElementById('quickFindInput');
const clearQuickFindBtn = document.getElementById('clearQuickFindBtn');

if (quickFindInput) {
    quickFindInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            quickFindSearchTerm = e.target.value;
            loadBlankList();
        }, 300);
    });
}

if (clearQuickFindBtn) {
    clearQuickFindBtn.addEventListener('click', () => {
        if (quickFindInput) {
            quickFindInput.value = '';
            quickFindSearchTerm = '';
            loadBlankList();
        }
    });
}

// Topic switching for fill-in-blanks
document.querySelectorAll('.topic-fill').forEach(btn => {
    btn.addEventListener('click', async () => {
        document.querySelectorAll('.topic-fill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFillTopic = btn.dataset.fillTopic;
        
        if (quickFindInput) quickFindInput.value = '';
        quickFindSearchTerm = '';
        
        await loadBlankList();
    });
});

document.getElementById('createBlankBtn')?.addEventListener('click', async () => {
    const title = document.getElementById('blankTitle')?.value || '';
    const text = document.getElementById('blankText')?.value || '';
    if (!title.trim() || !text.trim()) {
        alert('Please enter both title and text');
        return;
    }
    if (!text.includes('**')) {
        alert('Use **double asterisks** around words to create blanks');
        return;
    }
    await db.fillblanks.add({
        topic: currentFillTopic,
        title: title.trim(),
        text: text.trim()
    });
    loadBlankList();
    if (document.getElementById('blankTitle')) document.getElementById('blankTitle').value = '';
    if (document.getElementById('blankText')) document.getElementById('blankText').value = '';
});

async function takeQuiz(id) {
    const blank = await db.fillblanks.get(id);
    if (!blank) return;
    currentBlankId = id;
    const parsed = parseBlanks(blank.text);
    currentQuizBlanks = parsed.blanks;
    
    const quizTitle = document.getElementById('quizTitle');
    const quizQuestion = document.getElementById('quizQuestion');
    const quizArea = document.getElementById('quizArea');
    if (quizTitle) quizTitle.textContent = blank.title;
    if (quizQuestion) quizQuestion.innerHTML = parsed.displayHtml;
    if (quizArea) quizArea.style.display = 'block';
    const quizFeedback = document.getElementById('quizFeedback');
    if (quizFeedback) quizFeedback.innerHTML = '';
    
    // Scroll to quiz
    if (quizArea) quizArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function checkAnswers() {
    const inputs = document.querySelectorAll('#quizQuestion .blank-input');
    let correct = 0;
    inputs.forEach((input, idx) => {
        const userAnswer = input.value.trim().toLowerCase();
        let acceptable = currentQuizBlanks[idx]?.acceptable || [currentQuizBlanks[idx]?.answer || ''];
        
        const isCorrect = acceptable.some(acc => 
            userAnswer === acc || (userAnswer.includes(acc) && acc.length > 3) || (acc.includes(userAnswer) && userAnswer.length > 3)
        );
        
        if (isCorrect) {
            input.classList.add('correct');
            input.classList.remove('incorrect');
            correct++;
        } else {
            input.classList.add('incorrect');
            input.classList.remove('correct');
        }
    });
    const feedback = document.getElementById('quizFeedback');
    if (feedback) feedback.innerHTML = `<p>✅ ${correct} / ${inputs.length} correct</p>`;
}

function showAnswers() {
    const inputs = document.querySelectorAll('#quizQuestion .blank-input');
    inputs.forEach((input, idx) => {
        input.value = currentQuizBlanks[idx]?.original || '';
        input.classList.add('correct');
        input.classList.remove('incorrect');
    });
}

document.getElementById('checkAnswersBtn')?.addEventListener('click', checkAnswers);
document.getElementById('showAnswersBtn')?.addEventListener('click', showAnswers);
document.getElementById('closeQuizBtn')?.addEventListener('click', () => {
    const quizArea = document.getElementById('quizArea');
    if (quizArea) quizArea.style.display = 'none';
    currentBlankId = null;
});

async function deleteBlank(id) {
    if (confirm('Delete this fill-in-blank?')) {
        await db.fillblanks.delete(id);
        loadBlankList();
        if (currentBlankId === id) {
            const quizArea = document.getElementById('quizArea');
            if (quizArea) quizArea.style.display = 'none';
        }
    }
}

async function editBlank(id) {
    const blank = await db.fillblanks.get(id);
    if (!blank) return;
    
    currentEditingBlankId = id;
    const modal = document.getElementById('editBlankModal');
    if (modal) {
        document.getElementById('editBlankTitle').value = blank.title;
        document.getElementById('editBlankText').value = blank.text;
        modal.style.display = 'flex';
    } else {
        alert('Edit modal not found. Please check HTML.');
    }
}

// Modal event listeners (only if modal exists)
const saveBlankBtn = document.getElementById('saveBlankEditBtn');
if (saveBlankBtn) {
    saveBlankBtn.addEventListener('click', async () => {
        if (currentEditingBlankId === null) return;
        
        const newTitle = document.getElementById('editBlankTitle').value.trim();
        const newText = document.getElementById('editBlankText').value.trim();
        
        if (!newTitle) {
            alert('Title cannot be empty');
            return;
        }
        if (!newText) {
            alert('Text cannot be empty');
            return;
        }
        if (!newText.includes('**')) {
            alert('Use **double asterisks** around words to create blanks');
            return;
        }
        
        await db.fillblanks.update(currentEditingBlankId, {
            title: newTitle,
            text: newText
        });
        
        document.getElementById('editBlankModal').style.display = 'none';
        currentEditingBlankId = null;
        await loadBlankList();
    });
}

const cancelBlankBtn = document.getElementById('cancelBlankEditBtn');
if (cancelBlankBtn) {
    cancelBlankBtn.addEventListener('click', () => {
        document.getElementById('editBlankModal').style.display = 'none';
        currentEditingBlankId = null;
    });
}

const saveCardBtn = document.getElementById('saveCardEditBtn');
if (saveCardBtn) {
    saveCardBtn.addEventListener('click', async () => {
        if (currentEditingCardId === null) return;
        
        const newQuestion = document.getElementById('editCardQuestion').value.trim();
        const newAnswer = document.getElementById('editCardAnswer').value.trim();
        
        if (!newQuestion) {
            alert('Question cannot be empty');
            return;
        }
        if (!newAnswer) {
            alert('Answer cannot be empty');
            return;
        }
        
        await db.flashcards.update(currentEditingCardId, {
            question: newQuestion,
            answer: newAnswer
        });
        
        document.getElementById('editCardModal').style.display = 'none';
        currentEditingCardId = null;
        await refreshFlashcardsKeepPosition();
    });
}

const cancelCardBtn = document.getElementById('cancelCardEditBtn');
if (cancelCardBtn) {
    cancelCardBtn.addEventListener('click', () => {
        document.getElementById('editCardModal').style.display = 'none';
        currentEditingCardId = null;
    });
}

// Close modals on X click
document.querySelectorAll('.modal-close').forEach(closeBtn => {
    closeBtn.addEventListener('click', () => {
        document.getElementById('editBlankModal').style.display = 'none';
        document.getElementById('editCardModal').style.display = 'none';
        currentEditingBlankId = null;
        currentEditingCardId = null;
    });
});

// Close modal on outside click
window.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
        currentEditingBlankId = null;
        currentEditingCardId = null;
    }
});

// ========== MANAGE DATA FUNCTIONS ==========
async function updateManageStats() {
    const flashCount = await db.flashcards.count();
    const knownCount = await db.flashcards.where('known').equals(true).count();
    const blankCount = await db.fillblanks.count();
    const flashcardCountEl = document.getElementById('flashcardCount');
    const knownCountEl = document.getElementById('knownCount');
    const blankCountEl = document.getElementById('blankCount');
    if (flashcardCountEl) flashcardCountEl.textContent = `${flashCount} total`;
    if (knownCountEl) knownCountEl.textContent = `${knownCount} known`;
    if (blankCountEl) blankCountEl.textContent = `${blankCount} total`;
}

async function exportAllData() {
    const flashcards = await db.flashcards.toArray();
    const fillblanks = await db.fillblanks.toArray();
    const exportData = { flashcards, fillblanks, exportedAt: new Date().toISOString() };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `history_data_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

async function importData(file) {
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.flashcards) await db.flashcards.bulkAdd(data.flashcards);
            if (data.fillblanks) await db.fillblanks.bulkAdd(data.fillblanks);
            alert('Import successful!');
            refreshFlashcards();
            loadBlankList();
            updateManageStats();
        } catch (err) {
            alert('Invalid file');
        }
    };
    reader.readAsText(file);
}

async function resetAllData() {
    if (confirm('⚠️ DELETE ALL your flashcards and fill-in-blanks? This cannot be undone.')) {
        await db.flashcards.clear();
        await db.fillblanks.clear();
        await loadDefaultData();
        refreshFlashcards();
        loadBlankList();
        updateManageStats();
        alert('All data reset to default examples');
    }
}

document.getElementById('exportAllBtn')?.addEventListener('click', exportAllData);
document.getElementById('resetAllBtn')?.addEventListener('click', resetAllData);
document.getElementById('importFile')?.addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
});
document.querySelector('.btn-import')?.addEventListener('click', () => {
    const importFile = document.getElementById('importFile');
    if (importFile) importFile.click();
});

// ========== MASS MANAGEMENT FUNCTIONS ==========
async function deleteFlashcardsByTopic() {
    const topic = document.getElementById('massDeleteTopic').value;
    const topicName = topic === 'germany' ? 'Germany' : 'USA';
    const count = await db.flashcards.where('topic').equals(topic).count();
    
    if (count === 0) {
        alert(`No flashcards found for ${topicName}`);
        return;
    }
    
    if (confirm(`Delete ALL ${count} flashcards for ${topicName}? This cannot be undone.`)) {
        await db.flashcards.where('topic').equals(topic).delete();
        alert(`Deleted ${count} flashcards`);
        await refreshFlashcards();
        await updateManageStats();
        await updateBoxCounts();
    }
}

async function deleteFlashcardsByBox() {
    const box = parseInt(document.getElementById('massDeleteBox').value);
    const boxNames = {1: 'Daily', 2: 'Every 2 days', 3: 'Every 4 days', 4: 'Every 8 days', 5: 'Every 15 days'};
    const allCards = await db.flashcards.toArray();
    const cardsToDelete = allCards.filter(c => c.box === box);
    const count = cardsToDelete.length;
    
    if (count === 0) {
        alert(`No flashcards found in Box ${box} (${boxNames[box]})`);
        return;
    }
    
    if (confirm(`Delete ALL ${count} flashcards in Box ${box} (${boxNames[box]})? This cannot be undone.`)) {
        for (const card of cardsToDelete) {
            await db.flashcards.delete(card.id);
        }
        alert(`Deleted ${count} flashcards`);
        await refreshFlashcards();
        await updateManageStats();
        await updateBoxCounts();
    }
}

async function deleteKnownFlashcards() {
    const knownCards = await db.flashcards.where('known').equals(true).toArray();
    const count = knownCards.length;
    
    if (count === 0) {
        alert('No known flashcards found');
        return;
    }
    
    if (confirm(`Delete ALL ${count} known flashcards (Box 4 and 5)? This cannot be undone.`)) {
        for (const card of knownCards) {
            await db.flashcards.delete(card.id);
        }
        alert(`Deleted ${count} flashcards`);
        await refreshFlashcards();
        await updateManageStats();
        await updateBoxCounts();
    }
}

async function deleteUnknownFlashcards() {
    const unknownCards = await db.flashcards.where('known').equals(false).toArray();
    const count = unknownCards.length;
    
    if (count === 0) {
        alert('No unknown flashcards found');
        return;
    }
    
    if (confirm(`Delete ALL ${count} unknown flashcards (Box 1, 2, 3)? This cannot be undone.`)) {
        for (const card of unknownCards) {
            await db.flashcards.delete(card.id);
        }
        alert(`Deleted ${count} flashcards`);
        await refreshFlashcards();
        await updateManageStats();
        await updateBoxCounts();
    }
}

async function deleteBlanksByTopic() {
    const topic = document.getElementById('massDeleteBlankTopic').value;
    const topicName = topic === 'germany' ? 'Germany' : 'USA';
    const count = await db.fillblanks.where('topic').equals(topic).count();
    
    if (count === 0) {
        alert(`No fill-in-blanks found for ${topicName}`);
        return;
    }
    
    if (confirm(`Delete ALL ${count} fill-in-blanks for ${topicName}? This cannot be undone.`)) {
        await db.fillblanks.where('topic').equals(topic).delete();
        alert(`Deleted ${count} fill-in-blanks`);
        await loadBlankList();
        await updateManageStats();
    }
}

async function deleteAllBlanks() {
    const count = await db.fillblanks.count();
    
    if (count === 0) {
        alert('No fill-in-blanks found');
        return;
    }
    
    if (confirm(`Delete ALL ${count} fill-in-blanks? This cannot be undone.`)) {
        await db.fillblanks.clear();
        alert(`Deleted ${count} fill-in-blanks`);
        await loadBlankList();
        await updateManageStats();
    }
}

document.getElementById('deleteByTopicBtn')?.addEventListener('click', deleteFlashcardsByTopic);
document.getElementById('deleteByBoxBtn')?.addEventListener('click', deleteFlashcardsByBox);
document.getElementById('deleteKnownBtn')?.addEventListener('click', deleteKnownFlashcards);
document.getElementById('deleteUnknownBtn')?.addEventListener('click', deleteUnknownFlashcards);
document.getElementById('deleteBlanksByTopicBtn')?.addEventListener('click', deleteBlanksByTopic);
document.getElementById('deleteAllBlanksBtn')?.addEventListener('click', deleteAllBlanks);

// ========== SHUFFLE ==========
async function shuffleFlashcards() {
    if (currentFlashcards.length === 0) return;
    
    for (let i = currentFlashcards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [currentFlashcards[i], currentFlashcards[j]] = [currentFlashcards[j], currentFlashcards[i]];
    }
    
    currentFlashIndex = 0;
    isFlipped = false;
    document.getElementById('flashcard').classList.remove('flipped');
    updateFlashcardDisplay();
    
    const msg = document.createElement('div');
    msg.textContent = '🎲 Cards shuffled!';
    msg.style.cssText = 'position:fixed; bottom:20px; right:20px; background:var(--accent); color:white; padding:6px 12px; border-radius:6px; font-size:0.8rem; z-index:1000;';
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 1200);
}

document.getElementById('shuffle-btn')?.addEventListener('click', shuffleFlashcards);

// ========== MASS EDIT FLASHCARDS ==========
async function bulkExportCurrentCards() {
    const cards = await db.flashcards.where('topic').equals(currentTopic).toArray();
    if (cards.length === 0) {
        alert('No flashcards to export');
        return;
    }
    
    let text = '';
    for (const card of cards) {
        text += `${card.question} / ${card.answer}\n`;
    }
    
    const textarea = document.getElementById('bulkImportText');
    if (textarea) {
        textarea.value = text;
        alert(`Copied ${cards.length} flashcards to textbox.`);
    }
}

async function bulkReplaceFlashcards() {
    const textarea = document.getElementById('bulkImportText');
    const text = textarea.value;
    
    if (!text.trim()) {
        alert('Textbox is empty. Nothing to replace.');
        return;
    }
    
    const lines = text.split(/\r?\n/);
    const newCards = [];
    const errors = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "") continue;
        
        const separator = line.indexOf(' / ');
        if (separator === -1) {
            errors.push(`Line ${i+1}: No ' / ' separator found`);
            continue;
        }
        
        const question = line.substring(0, separator).trim();
        const answer = line.substring(separator + 3).trim();
        
        if (question && answer) {
            newCards.push({
                topic: currentTopic,
                question: question,
                answer: answer,
                known: false,
                box: 1,
                nextReviewDate: new Date().toISOString()
            });
        } else {
            errors.push(`Line ${i+1}: Question or answer empty`);
        }
    }
    
    if (newCards.length === 0) {
        alert(`No valid cards found.\n\nErrors:\n${errors.join('\n')}`);
        return;
    }
    
    const confirmMsg = `Replace ALL ${currentTopic === 'germany' ? 'Germany' : 'USA'} flashcards with ${newCards.length} new cards?\n\nThis will DELETE your current cards. Cannot undo.`;
    
    if (confirm(confirmMsg)) {
        await db.flashcards.where('topic').equals(currentTopic).delete();
        await db.flashcards.bulkAdd(newCards);
        await refreshFlashcards();
        await updateBoxCounts();
        await updateManageStats();
        alert(`Replaced with ${newCards.length} flashcards.`);
    }
}

document.getElementById('bulkExportBtn')?.addEventListener('click', bulkExportCurrentCards);
document.getElementById('bulkReplaceBtn')?.addEventListener('click', bulkReplaceFlashcards);

// ========== MASS IMPORT FILL-IN-BLANKS ==========
function parseBulkBlanks(text, topic) {
    const blocks = text.split(/\n\s*\n\s*\n/);
    const results = [];
    const errors = [];
    
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i].trim();
        if (block === "") continue;
        
        const lines = block.split('\n');
        if (lines.length < 2) {
            errors.push(`Block ${i+1}: Need title and content`);
            continue;
        }
        
        const title = lines[0].trim();
        const content = lines.slice(1).join(' ').trim();
        
        if (!title) {
            errors.push(`Block ${i+1}: Missing title`);
            continue;
        }
        if (!content) {
            errors.push(`Block ${i+1}: Missing content`);
            continue;
        }
        if (!content.includes('**')) {
            errors.push(`Block ${i+1}: No **blanks** found`);
            continue;
        }
        
        results.push({ topic: topic, title: title, text: content });
    }
    
    return { results, errors };
}

async function bulkAddBlanks() {
    const textarea = document.getElementById('bulkBlanksText');
    const text = textarea.value;
    
    if (!text.trim()) {
        alert('Paste your fill-in-blanks first!');
        return;
    }
    
    const { results, errors } = parseBulkBlanks(text, currentFillTopic);
    
    if (results.length === 0) {
        alert(`No valid fill-in-blanks found.\n\n${errors.join('\n')}`);
        return;
    }
    
    await db.fillblanks.bulkAdd(results);
    alert(`✅ Added ${results.length} fill-in-blanks`);
    await loadBlankList();
    textarea.value = '';
}

async function bulkReplaceBlanks() {
    const textarea = document.getElementById('bulkBlanksText');
    const text = textarea.value;
    
    if (!text.trim()) {
        alert('Textbox is empty');
        return;
    }
    
    const { results, errors } = parseBulkBlanks(text, currentFillTopic);
    
    if (results.length === 0) {
        alert(`No valid fill-in-blanks found.\n\n${errors.join('\n')}`);
        return;
    }
    
    if (confirm(`Replace ALL ${currentFillTopic === 'germany' ? 'Germany' : 'USA'} fill-in-blanks with ${results.length} new ones?`)) {
        await db.fillblanks.where('topic').equals(currentFillTopic).delete();
        await db.fillblanks.bulkAdd(results);
        alert(`✅ Replaced with ${results.length} fill-in-blanks`);
        await loadBlankList();
        textarea.value = '';
    }
}

async function bulkExportBlanks() {
    const blanks = await db.fillblanks.where('topic').equals(currentFillTopic).toArray();
    
    if (blanks.length === 0) {
        alert('No fill-in-blanks to export');
        return;
    }
    
    let output = '';
    for (const blank of blanks) {
        output += `${blank.title}\n${blank.text}\n\n`;
    }
    
    const textarea = document.getElementById('bulkBlanksText');
    if (textarea) {
        textarea.value = output.trim();
        alert(`Copied ${blanks.length} fill-in-blanks to textbox.`);
    }
}

document.getElementById('bulkBlanksImportBtn')?.addEventListener('click', bulkAddBlanks);
document.getElementById('bulkBlanksReplaceBtn')?.addEventListener('click', bulkReplaceBlanks);
document.getElementById('bulkBlanksExportBtn')?.addEventListener('click', bulkExportBlanks);

// ========== RANDOM FILL-IN-BLANK ==========
async function randomFillBlank() {
    const blanks = await db.fillblanks.where('topic').equals(currentFillTopic).toArray();
    
    if (blanks.length === 0) {
        alert('No fill-in-blanks available.');
        return;
    }
    
    const randomIndex = Math.floor(Math.random() * blanks.length);
    const randomBlank = blanks[randomIndex];
    
    const randomCountSpan = document.getElementById('randomQuizCount');
    if (randomCountSpan) {
        randomCountSpan.textContent = `(${blanks.length} available)`;
        setTimeout(() => {
            if (randomCountSpan) randomCountSpan.textContent = `(${blanks.length} available)`;
        }, 2000);
    }
    
    currentBlankId = randomBlank.id;
    const parsed = parseBlanks(randomBlank.text);
    currentQuizBlanks = parsed.blanks;
    
    const quizTitle = document.getElementById('quizTitle');
    const quizQuestion = document.getElementById('quizQuestion');
    const quizArea = document.getElementById('quizArea');
    
    if (quizTitle) quizTitle.textContent = `🎲 RANDOM: ${randomBlank.title}`;
    if (quizQuestion) quizQuestion.innerHTML = parsed.displayHtml;
    if (quizArea) {
        quizArea.style.display = 'block';
        quizArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    const quizFeedback = document.getElementById('quizFeedback');
    if (quizFeedback) quizFeedback.innerHTML = '';
}

document.getElementById('randomQuizBtn')?.addEventListener('click', randomFillBlank);

// ========== INITIALISE ==========
async function init() {
    recordStudy();
    await loadDefaultData();
    await refreshFlashcards();
    await loadBlankList();
    await updateManageStats();
}

// Auto-load last user
const lastUser = localStorage.getItem('currentUser');
if (lastUser) switchUser(lastUser);
init();
