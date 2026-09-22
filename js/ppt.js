// js/ppt.js - AI-Powered PowerPoint Export with OpenAI (GPT-4)
// FIXED: color-format corruption bugs + full visual redesign

// =====================================================================
// THEME DEFINITIONS (kept with '#' — the UI/CSS layer needs it)
// =====================================================================
if (typeof THEMES === 'undefined') {
    var THEMES = [{
        id: 'tranquil',
        name: 'Tranquil',
        desc: 'Teal, coral & gold – calm yet vibrant',
        colors: {
            primary: '#009688',
            primaryDark: '#00796b',
            primaryLight: '#4db6ac',
            secondary: '#ff6b6b',
            accent: '#feca57',
            background: '#ffffff',
            text: '#1f2933',
            slideBg: '#ffffff',
            titleColor: '#009688',
            headingColor: '#00796b',
            bulletColor: '#ff6b6b',
            accentBar: '#009688',
            gradientStart: '#009688',
            gradientEnd: '#4db6ac',
            chartColors: ['#009688', '#ff6b6b', '#feca57', '#4db6ac', '#80cbc4']
        },
        previewColors: ['#009688', '#ff6b6b', '#feca57']
    }, {
        id: 'cigar',
        name: 'Cigar',
        desc: 'Warm browns, gold & cream – sophisticated',
        colors: {
            primary: '#8d6e63',
            primaryDark: '#6d4c41',
            primaryLight: '#d7ccc8',
            secondary: '#d4a373',
            accent: '#cc8e6e',
            background: '#ffffff',
            text: '#3e2723',
            slideBg: '#ffffff',
            titleColor: '#6d4c41',
            headingColor: '#5d4037',
            bulletColor: '#8d6e63',
            accentBar: '#8d6e63',
            gradientStart: '#8d6e63',
            gradientEnd: '#d7ccc8',
            chartColors: ['#8d6e63', '#d4a373', '#cc8e6e', '#bcaaa4', '#efebe9']
        },
        previewColors: ['#8d6e63', '#d4a373', '#cc8e6e']
    }, {
        id: 'ocean',
        name: 'Ocean',
        desc: 'Deep blue, teal & coral – professional with pop',
        colors: {
            primary: '#0d47a1',
            primaryDark: '#0a3d8a',
            primaryLight: '#64b5f6',
            secondary: '#26c6da',
            accent: '#ff6b6b',
            background: '#ffffff',
            text: '#0d1b2a',
            slideBg: '#ffffff',
            titleColor: '#0d47a1',
            headingColor: '#0d47a1',
            bulletColor: '#26c6da',
            accentBar: '#0d47a1',
            gradientStart: '#0d47a1',
            gradientEnd: '#64b5f6',
            chartColors: ['#0d47a1', '#26c6da', '#ff6b6b', '#4fc3f7', '#81d4fa']
        },
        previewColors: ['#0d47a1', '#26c6da', '#ff6b6b']
    }, {
        id: 'forest',
        name: 'Forest',
        desc: 'Green, yellow & brown – natural and fresh',
        colors: {
            primary: '#2e7d32',
            primaryDark: '#1b5e20',
            primaryLight: '#81c784',
            secondary: '#fdd835',
            accent: '#8d6e63',
            background: '#ffffff',
            text: '#1b3a1b',
            slideBg: '#ffffff',
            titleColor: '#2e7d32',
            headingColor: '#1b5e20',
            bulletColor: '#fdd835',
            accentBar: '#2e7d32',
            gradientStart: '#2e7d32',
            gradientEnd: '#81c784',
            chartColors: ['#2e7d32', '#fdd835', '#8d6e63', '#66bb6a', '#a5d6a7']
        },
        previewColors: ['#2e7d32', '#fdd835', '#8d6e63']
    }, {
        id: 'sunset',
        name: 'Sunset',
        desc: 'Orange, pink & yellow – energetic and warm',
        colors: {
            primary: '#e65100',
            primaryDark: '#bf360c',
            primaryLight: '#ffab91',
            secondary: '#ff6b6b',
            accent: '#feca57',
            background: '#ffffff',
            text: '#4e2a1a',
            slideBg: '#ffffff',
            titleColor: '#d84315',
            headingColor: '#bf360c',
            bulletColor: '#ff6b6b',
            accentBar: '#e65100',
            gradientStart: '#e65100',
            gradientEnd: '#ffab91',
            chartColors: ['#e65100', '#ff6b6b', '#feca57', '#ffab91', '#ffccbc']
        },
        previewColors: ['#e65100', '#ff6b6b', '#feca57']
    }, {
        id: 'monochrome',
        name: 'Monochrome',
        desc: 'Black, gray & white – timeless elegance',
        colors: {
            primary: '#424242',
            primaryDark: '#212121',
            primaryLight: '#bdbdbd',
            secondary: '#9e9e9e',
            accent: '#616161',
            background: '#ffffff',
            text: '#212121',
            slideBg: '#ffffff',
            titleColor: '#424242',
            headingColor: '#424242',
            bulletColor: '#616161',
            accentBar: '#424242',
            gradientStart: '#424242',
            gradientEnd: '#bdbdbd',
            chartColors: ['#424242', '#9e9e9e', '#bdbdbd', '#757575', '#616161']
        },
        previewColors: ['#424242', '#9e9e9e', '#bdbdbd']
    }, {
        id: 'royal',
        name: 'Royal',
        desc: 'Purple, gold & pink – regal and elegant',
        colors: {
            primary: '#6a1b9a',
            primaryDark: '#4a148c',
            primaryLight: '#ce93d8',
            secondary: '#fbbf24',
            accent: '#f472b6',
            background: '#ffffff',
            text: '#311b92',
            slideBg: '#ffffff',
            titleColor: '#6a1b9a',
            headingColor: '#4a148c',
            bulletColor: '#fbbf24',
            accentBar: '#6a1b9a',
            gradientStart: '#6a1b9a',
            gradientEnd: '#ce93d8',
            chartColors: ['#6a1b9a', '#fbbf24', '#f472b6', '#ab47bc', '#ce93d8']
        },
        previewColors: ['#6a1b9a', '#fbbf24', '#f472b6']
    }, {
        id: 'clinical',
        name: 'Clinical',
        desc: 'Clean blue, teal & gray – medical clarity',
        colors: {
            primary: '#0d47a1',
            primaryDark: '#0a3d8a',
            primaryLight: '#64b5f6',
            secondary: '#26c6da',
            accent: '#78909c',
            background: '#ffffff',
            text: '#0d1b2a',
            slideBg: '#ffffff',
            titleColor: '#0d47a1',
            headingColor: '#0d47a1',
            bulletColor: '#26c6da',
            accentBar: '#0d47a1',
            gradientStart: '#0d47a1',
            gradientEnd: '#64b5f6',
            chartColors: ['#0d47a1', '#26c6da', '#78909c', '#64b5f6', '#90a4ae']
        },
        previewColors: ['#0d47a1', '#26c6da', '#78909c']
    }];
}

// =====================================================================
// GRID + TYPE SCALE — a shared layout/typography system so slides are
// hand-placed against a consistent frame instead of ad hoc per-function
// coordinates. Bespoke layouts (comparison cards, timeline, big-number)
// keep their own internally-tuned positions, but the outer frame — page
// margins, heading position, body start, footer row — and font sizes are
// drawn from here everywhere.
// =====================================================================
const GRID = {
    pageW: 13.33, pageH: 7.5,
    marginX: 0.7,           // left/right content margin
    contentW: 11.93,        // pageW - 2*marginX
    headingY: 0.55, headingH: 0.85,
    accentY: 1.42,          // thin theme-colored rule just under the heading
    bodyTop: 1.9,           // where slide body content starts
    footerY: 7.15
};
const TYPE_SCALE = {
    titleXL: 40,   // title-slide headline
    titleL: 30,    // title-slide subtitle (patient/topic)
    h1: 28,        // per-slide heading
    h2: 18,        // sub-headings (two-column/agenda/quote card headings)
    body: 16,      // standard bullet/paragraph text
    bodySmall: 13.5,
    small: 13,     // meta/attribution text
    micro: 9       // footer
};

// =====================================================================
// STATE
// =====================================================================
let selectedTheme = THEMES[0];
let selectedArtStyle = 'professional';
let contentData = null;
let aiConfig = { token: null, endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1' };
let structuredSlides = null;
let currentUser = null;
let isInitialized = false;

// =====================================================================
// DOM REFS
// =====================================================================
let themeCarousel = null;
let generateBtn = null;
let slideCountSpan = null;
let toastContainer = null;
let pptInstructions = null;
let themePrev = null;
let themeNext = null;
let generationStatus = null;
let statusText = null;

function getDOMElements() {
    themeCarousel = document.getElementById('themeCarousel');
    generateBtn = document.getElementById('generatePptBtn');
    slideCountSpan = document.getElementById('slideCount');
    toastContainer = document.getElementById('toast-container');
    pptInstructions = document.getElementById('pptInstructions');
    themePrev = document.getElementById('themePrev');
    themeNext = document.getElementById('themeNext');
    generationStatus = document.getElementById('generationStatus');
    statusText = document.getElementById('statusText');
}

function waitForDOM() {
    return new Promise((resolve) => {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', resolve);
        } else {
            resolve();
        }
    });
}

function waitForFirebase() {
    return new Promise((resolve) => {
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
            resolve();
            return;
        }
        let attempts = 0;
        const checkInterval = setInterval(() => {
            attempts++;
            if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
                clearInterval(checkInterval);
                resolve();
            } else if (attempts > 50) {
                clearInterval(checkInterval);
                console.warn('Firebase not loaded after 5 seconds, continuing...');
                resolve();
            }
        }, 100);
    });
}

function showToast(msg, type = 'success', duration = 4000) {
    if (!toastContainer) {
        console.warn('Toast container not found');
        return;
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = type === 'error' ? 'exclamation-circle' :
        type === 'warning' ? 'exclamation-triangle' : 'check-circle';
    el.innerHTML = `<i class="fas fa-${icon}"></i> ${msg}`;
    toastContainer.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.3s';
        setTimeout(() => el.remove(), 300);
    }, duration);
}

async function fetchTokens() {
    try {
        await waitForFirebase();
        if (typeof firebase === 'undefined' || !firebase.apps || firebase.apps.length === 0) {
            console.warn('Firebase not available, using fallback token');
            if (window.aiConfig && window.aiConfig.token) {
                aiConfig.token = window.aiConfig.token;
                return true;
            }
            return false;
        }
        const database = firebase.database();
        const snapshot = await database.ref('tokens/open_ai').once('value');
        const data = snapshot.val();
        if (data?.api_key) {
            aiConfig.token = data.api_key;
            aiConfig.endpoint = 'https://api.openai.com/v1';
            aiConfig.model = 'gpt-4.1';
            return true;
        }
        console.warn('OpenAI API key missing. Using fallback local structuring.');
        return false;
    } catch (error) {
        console.error('Token fetch error:', error);
        return false;
    }
}

// =====================================================================
// RENDER THEMES (UI carousel — uses '#' hex, this is CSS not PptxGenJS)
// =====================================================================
function renderThemes() {
    getDOMElements();

    if (!themeCarousel) {
        const wrapper = document.querySelector('.theme-carousel-wrapper');
        if (wrapper) {
            const carousel = document.createElement('div');
            carousel.id = 'themeCarousel';
            carousel.className = 'theme-carousel';
            wrapper.prepend(carousel);
            themeCarousel = carousel;
        } else {
            console.error('Cannot find or create theme carousel');
            return;
        }
    }

    themeCarousel.innerHTML = '';
    THEMES.forEach(theme => {
        const div = document.createElement('div');
        div.className = 'theme-option' + (theme.id === selectedTheme.id ? ' selected' : '');
        div.dataset.themeId = theme.id;
        const previewHtml = theme.previewColors.map(c =>
            `<span class="dot" style="background:${c}"></span>`
        ).join('');
        div.innerHTML = `
            <div class="theme-preview" style="background: ${theme.colors.primary};">
                <span style="color: #fff;">${theme.name}</span>
                ${previewHtml}
            </div>
            <div class="theme-name">${theme.name}</div>
            <div class="theme-desc">${theme.desc}</div>
            <div class="check-mark"><i class="fas fa-check"></i></div>
        `;
        div.addEventListener('click', () => {
            document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('selected'));
            div.classList.add('selected');
            selectedTheme = THEMES.find(t => t.id === theme.id);
            updateSlideCount();
            updateStepIndicator(1);
        });
        themeCarousel.appendChild(div);
    });
}

function updateStepIndicator(step) {
    const stepItems = document.querySelectorAll('.step-item');
    if (!stepItems.length) return;
    stepItems.forEach((item, index) => {
        const stepNum = index + 1;
        item.classList.remove('active');
        if (stepNum === step) {
            item.classList.add('active');
        } else if (stepNum < step) {
            item.classList.add('completed');
        } else {
            item.classList.remove('completed');
        }
    });
}

function scrollCarousel(direction) {
    getDOMElements();
    if (!themeCarousel) return;
    const scrollAmount = 220;
    themeCarousel.scrollBy({ left: direction === 'next' ? scrollAmount : -scrollAmount, behavior: 'smooth' });
}

function setupCarouselNav() {
    getDOMElements();
    if (themePrev) themePrev.addEventListener('click', () => scrollCarousel('prev'));
    if (themeNext) themeNext.addEventListener('click', () => scrollCarousel('next'));
}

function updateSlideCount() {
    getDOMElements();
    if (structuredSlides) {
        if (slideCountSpan) slideCountSpan.textContent = structuredSlides.length + 2;
        return;
    }
    if (!contentData) {
        if (slideCountSpan) slideCountSpan.textContent = '0';
        return;
    }
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = contentData.content;
    const headings = tempDiv.querySelectorAll('h1, h2, h3');
    let count = Math.max(1, headings.length) || 5;
    if (slideCountSpan) slideCountSpan.textContent = count + 2;
}

function loadContent() {
    getDOMElements();
    const raw = localStorage.getItem('pptExportData');
    if (!raw) {
        showToast('No document content found. Please generate a document first.', 'error');
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> No content loaded';
        }
        return false;
    }
    try {
        contentData = JSON.parse(raw);
        updateSlideCount();
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="fas fa-magic"></i> Generate & Download';
        }
        return true;
    } catch (e) {
        showToast('Error loading content.', 'error');
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error loading content';
        }
        return false;
    }
}

// =====================================================================
// VALIDATE AND CLEAN SLIDE DATA
// =====================================================================
const SLIDE_TYPES = ['content', 'chart', 'comparison', 'timeline', 'big-number', 'section', 'agenda', 'two-column', 'quote', 'process'];

function validateAndCleanSlides(slides) {
    if (!Array.isArray(slides) || slides.length === 0) return null;

    const cleaned = slides.map((slide, index) => {
        const clean = {
            title: String(slide.title || `Slide ${index + 1}`).trim() || `Slide ${index + 1}`,
            type: SLIDE_TYPES.includes(slide.type) ? slide.type : 'content',
            bullets: Array.isArray(slide.bullets) ? slide.bullets.slice(0, 6) : [],
            layout: slide.layout || 'single'
        };
        clean.bullets = clean.bullets
            .filter(b => b && String(b).trim().length > 0)
            .map(b => String(b).trim())
            .slice(0, 6);
        if (clean.bullets.length === 0 && clean.type !== 'quote' && clean.type !== 'section') {
            clean.bullets = ['No content available for this section'];
        }

        if (slide.chartData && typeof slide.chartData === 'object') {
            const allowedTypes = ['bar', 'line', 'pie', 'doughnut', 'area', 'radar'];
            clean.chartData = {
                type: allowedTypes.includes(slide.chartData.type) ? slide.chartData.type : null,
                labels: Array.isArray(slide.chartData.labels) ? slide.chartData.labels : [],
                datasets: Array.isArray(slide.chartData.datasets) ? slide.chartData.datasets : []
            };
        }
        if (slide.comparisonData && typeof slide.comparisonData === 'object') {
            clean.comparisonData = {
                left: Array.isArray(slide.comparisonData.left) ? slide.comparisonData.left : [],
                right: Array.isArray(slide.comparisonData.right) ? slide.comparisonData.right : []
            };
        }
        if (slide.timelineData && Array.isArray(slide.timelineData)) {
            clean.timelineData = slide.timelineData.slice(0, 8);
        }
        if (slide.bigNumber && typeof slide.bigNumber === 'object') {
            clean.bigNumber = {
                number: String(slide.bigNumber.number || 'N/A'),
                label: String(slide.bigNumber.label || 'Statistic')
            };
        }
        // Two-column layout: either explicit left/right columns, or (if
        // absent) the slide's own bullets get split in half at render time.
        if (slide.columns && typeof slide.columns === 'object') {
            const cleanCol = (c) => c && typeof c === 'object' ? {
                heading: c.heading ? String(c.heading).trim() : '',
                bullets: Array.isArray(c.bullets) ? c.bullets.filter(Boolean).map(String).slice(0, 6) : []
            } : null;
            clean.columns = { left: cleanCol(slide.columns.left), right: cleanCol(slide.columns.right) };
        }
        if (slide.imageUrl && typeof slide.imageUrl === 'string') clean.imageUrl = slide.imageUrl;
        if (slide.imageData && typeof slide.imageData === 'string') clean.imageData = slide.imageData;

        // Quote/callout.
        if (slide.quote) clean.quote = String(slide.quote).trim();
        if (slide.attribution) clean.attribution = String(slide.attribution).trim();

        // Process/flow-step.
        if (Array.isArray(slide.processSteps)) {
            clean.processSteps = slide.processSteps.slice(0, 6).map((s, i) => ({
                label: String((s && s.label) || s || `Step ${i + 1}`).trim(),
                description: s && s.description ? String(s.description).trim() : ''
            }));
        }

        // Speaker notes — only ever carried through if the source already
        // supplied one; ppt.js never invents this field itself.
        if (slide.notes) clean.notes = String(slide.notes).trim();

        return clean;
    });

    return cleaned.filter(s => s !== null);
}

// =====================================================================
// AI STRUCTURING WITH OPENAI (GPT-4) - With robust fallback
// =====================================================================
async function structureContentWithAI(rawContent, modeLabel, patientName, diagnosis) {
    if (!aiConfig.token) {
        const ok = await fetchTokens();
        if (!ok) {
            console.warn('No OpenAI token, using fallback structure');
            return createFallbackStructure(rawContent, modeLabel, patientName);
        }
    }

    const prompt = `You are an expert presentation designer. Transform the following clinical content into a structured presentation.

**RULES:**
1. NEVER change or paraphrase the original text. Preserve exact wording.
2. Each slide should have 4-6 bullet points with EXACT original text.
3. Split content into logical slides - each covers one clear topic.
4. Vary slide "type" across the deck where the data genuinely supports it — don't make every slide type "content". Available types: content, chart, comparison, timeline, big-number, section, agenda, two-column, quote, process.
   - "section": a section-divider slide introducing a new major part of the deck (use sparingly, at real topic boundaries).
   - "agenda": an overview/table-of-contents slide — use near the start, with "bullets" listing the sections to come.
   - "two-column": for content that's naturally two side-by-side groups (e.g. subjective vs objective, findings vs recommendations) — use "columns": { "left": {"heading","bullets"}, "right": {"heading","bullets"} } instead of "bullets".
   - "quote": a single standout statement or key finding worth calling out on its own — use "quote" (the statement, EXACT original wording) and optionally "attribution" (who/where it's from).
   - "process": a sequence of ordered steps (e.g. a treatment protocol or workflow) — use "processSteps": [{"label","description"}] instead of "bullets".
   - "chart": pick the chartData "type" that actually fits the data — "pie"/"doughnut" for one series showing proportions of a whole, "line" for a trend over an ordered sequence (time/stages), "radar" for comparing several dimensions across 2+ series, "bar" for straightforward category comparison. Only include a "type" you're confident fits; omit it to let rendering choose.

**OUTPUT FORMAT**: Return ONLY a JSON array of slide objects.

Each slide object has:
{
  "title": string,
  "type": "content" | "chart" | "comparison" | "timeline" | "big-number" | "section" | "agenda" | "two-column" | "quote" | "process",
  "bullets": array of strings (EXACT original text, 4-6 per slide) — omit for "two-column"/"quote"/"process" in favor of their own fields below,
  "chartData": { "type": "bar" | "line" | "pie" | "doughnut" | "radar", "labels": [string], "datasets": [{ "label": string, "data": [number] }] },
  "comparisonData": { "left": [string], "right": [string] },
  "timelineData": [{ "time": string, "event": string }],
  "bigNumber": { "number": string, "label": string },
  "columns": { "left": { "heading": string, "bullets": [string] }, "right": { "heading": string, "bullets": [string] } },
  "quote": string, "attribution": string,
  "processSteps": [{ "label": string, "description": string }]
}

**Raw Content:**
${rawContent}

Return ONLY the JSON array.`;

    const messages = [
        { role: 'system', content: 'You are a presentation designer. Return ONLY valid JSON. NEVER change original text. Max 6 bullets per slide.' },
        { role: 'user', content: prompt }
    ];

    try {
        const url = `${aiConfig.endpoint}/chat/completions`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aiConfig.token}`
            },
            body: JSON.stringify({
                model: aiConfig.model,
                messages,
                max_tokens: 6000,
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.warn('AI error:', errData);
            if (window.reportApiError) {
                window.reportApiError({
                    status: response.status,
                    bodyText: JSON.stringify(errData),
                    tool: 'ppt',
                    context: 'structure slides'
                });
            }
            return createFallbackStructure(rawContent, modeLabel, patientName);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.warn('No JSON found, using fallback');
            return createFallbackStructure(rawContent, modeLabel, patientName);
        }

        let slides = JSON.parse(jsonMatch[0]);
        const cleaned = validateAndCleanSlides(slides);
        if (!cleaned || cleaned.length === 0) {
            console.warn('Invalid slide structure, using fallback');
            return createFallbackStructure(rawContent, modeLabel, patientName);
        }
        return cleaned;
    } catch (error) {
        console.error('AI structuring error:', error);
        if (window.reportApiError) {
            window.reportApiError({
                bodyText: String(error && error.message || error),
                tool: 'ppt',
                context: 'structure slides (network/exception)'
            });
        }
        return createFallbackStructure(rawContent, modeLabel, patientName);
    }
}

function createFallbackStructure(rawContent, modeLabel, patientName) {
    const slides = [];
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = rawContent;

    let currentTitle = 'Introduction';
    let currentBullets = [];
    const children = tempDiv.children;

    for (let child of children) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
            if (currentBullets.length > 0) {
                slides.push({ title: currentTitle, type: 'content', bullets: currentBullets.slice(0, 6) });
                currentBullets = [];
            }
            currentTitle = child.textContent.trim() || 'Section';
        } else if (tag === 'ul' || tag === 'ol') {
            child.querySelectorAll('li').forEach(li => {
                const text = li.textContent.trim();
                if (text) currentBullets.push(text);
            });
        } else if (tag === 'p') {
            const text = child.textContent.trim();
            if (text && text.length > 10) currentBullets.push(text);
        }
    }

    if (currentBullets.length > 0) {
        slides.push({ title: currentTitle, type: 'content', bullets: currentBullets.slice(0, 6) });
    }

    if (slides.length === 0) {
        const paragraphs = rawContent.split(/\n\n+/).filter(p => p.trim().length > 20);
        paragraphs.forEach((p, index) => {
            const lines = p.split(/[.\n]+/).filter(s => s.trim().length > 10);
            if (lines.length > 0) {
                slides.push({ title: `Section ${index + 1}`, type: 'content', bullets: lines.slice(0, 6).map(s => s.trim()) });
            }
        });
    }

    if (slides.length === 0) {
        slides.push({ title: 'Clinical Presentation', type: 'content', bullets: ['Content could not be structured. Please check your document.'] });
    }

    // With 3+ sections, lead with an agenda slide listing them — gives the
    // fallback path (no AI structuring available) a real overview slide
    // too, instead of only ever producing "content" slides.
    if (slides.length >= 3) {
        slides.unshift({ title: 'Agenda', type: 'agenda', bullets: slides.map(s => s.title) });
    }

    return slides;
}

// =====================================================================
// COLOR HANDLING — THE CORE FIX
// PptxGenJS requires 6-digit hex with NO '#' and NO alpha baked in.
// The THEMES object above keeps '#' because it's also used as CSS for
// the on-page theme carousel. This function produces a PptxGenJS-safe
// copy right before we start building the deck.
// =====================================================================
function toPptColors(themeColors) {
    const out = {};
    for (const key in themeColors) {
        const val = themeColors[key];
        if (Array.isArray(val)) {
            out[key] = val.map(c => String(c).replace('#', '').toUpperCase());
        } else if (typeof val === 'string') {
            out[key] = val.replace('#', '').toUpperCase();
        } else {
            out[key] = val;
        }
    }
    // Muted light tints for text sitting on a dark/primary background —
    // replaces the old (invalid) rgba(255,255,255,x) approach.
    out.onDarkMuted = 'E8E8E8';
    out.onDarkFaint = 'C4C4C4';
    out.onDarkSubtle = '9E9E9E';
    return out;
}

// =====================================================================
// NATIVE TABLE (replaces the old hand-drawn grid of text boxes)
// =====================================================================
// Weights each column by its longest cell's character length so a short
// "Score" column doesn't get the same width as a long "Findings" column —
// PptxGenJS's default is an even split across all columns.
function autoColumnWidths(data, totalW, numCols) {
    if (!numCols) return undefined;
    const maxLens = new Array(numCols).fill(1);
    data.forEach(row => row.forEach((cell, i) => {
        if (i < numCols) maxLens[i] = Math.max(maxLens[i], String(cell || '').length);
    }));
    const total = maxLens.reduce((a, b) => a + b, 0) || numCols;
    const minColW = totalW * 0.08;
    let widths = maxLens.map(len => Math.max(minColW, (len / total) * totalW));
    const sum = widths.reduce((a, b) => a + b, 0);
    return widths.map(w => +(w * (totalW / sum)).toFixed(2)); // normalize to exactly totalW
}

function addNativeTable(slide, data, colors, x, y, w, colWidths) {
    if (!data || !Array.isArray(data) || data.length === 0) return;
    const numCols = data[0] ? data[0].length : 0;
    const widths = (Array.isArray(colWidths) && colWidths.length === numCols) ? colWidths : autoColumnWidths(data, w, numCols);
    const rows = data.map((row, rIdx) => {
        const isHeader = rIdx === 0;
        // Zebra-stripe every other DATA row (header is never striped).
        const striped = !isHeader && rIdx % 2 === 0;
        return row.map(cell => ({
            text: String(cell || ''),
            options: {
                bold: isHeader,
                fontSize: isHeader ? 13 : 12,
                color: isHeader ? 'FFFFFF' : colors.text,
                fill: { color: isHeader ? colors.primary : (striped ? 'F5F6F7' : 'FFFFFF') },
                align: 'left',
                valign: 'middle',
                fontFace: 'Arial'
            }
        }));
    });
    slide.addTable(rows, {
        x, y, w, colW: widths,
        border: { type: 'solid', color: 'E0E0E0', pt: 0.5 },
        autoPage: false,
        margin: 6
    });
}

// =====================================================================
// CHART
// =====================================================================
// Picks a chart type from the data's shape when the source didn't specify
// one (or specified one that doesn't fit): a single series over a handful
// of categories reads as "proportions of a whole" (doughnut); 3+ series
// over 3+ categories reads as a multi-dimension comparison (radar); labels
// that look sequential/temporal read as a trend (line); everything else
// falls back to a plain category comparison (bar).
function pickChartType(chartData) {
    const numSeries = (chartData.datasets || []).length;
    const numCats = (chartData.labels || []).length;
    if (numSeries === 1 && numCats >= 2 && numCats <= 6) return 'doughnut';
    if (numSeries >= 3 && numCats >= 3) return 'radar';
    const firstLabel = String((chartData.labels || [])[0] || '');
    if (/^(20\d{2}|q[1-4]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|week|day \d|month|year)/i.test(firstLabel)) return 'line';
    return 'bar';
}

function addChartToSlide(slide, slideData, colors) {
    const cd = slideData.chartData;
    if (!cd || !Array.isArray(cd.labels) || !Array.isArray(cd.datasets) || cd.labels.length === 0 || cd.datasets.length === 0) return;

    const type = cd.type || pickChartType(cd);
    // Pie/doughnut can only meaningfully plot ONE series (slices must sum
    // to a whole) — PptxGenJS renders each entry below as its own series,
    // so multiple would overlay several unrelated pies. Keep the first.
    const isRing = type === 'pie' || type === 'doughnut';
    const datasets = isRing ? cd.datasets.slice(0, 1) : cd.datasets;

    // PptxGenJS's real chart-data shape is an array of series objects —
    // NOT a spreadsheet-style [header, ...rows] 2D array (confirmed
    // against the actual library; the old [header, ...rows] shape throws
    // internally and silently produced no chart at all).
    const chartData = datasets.map((dataset) => ({
        name: dataset.label || 'Series',
        labels: cd.labels.map(String),
        values: (Array.isArray(dataset.data) ? dataset.data : []).map(v => (typeof v === 'number' ? v : parseFloat(v) || 0))
    }));

    const chartColors = colors.chartColors || [colors.primary, colors.secondary, colors.accent, colors.primaryLight, colors.primaryDark];

    const opts = {
        x: 0.7, y: 1.9, w: 7.5, h: 4.3,
        chartColors,
        showTitle: false,
        showLegend: isRing ? true : datasets.length > 1,
        legendPos: isRing ? 'r' : 'b',
        showValue: true,
        dataLabelColor: isRing ? 'FFFFFF' : colors.text,
        dataLabelFontSize: 11,
        catAxisLabelColor: colors.text,
        valAxisLabelColor: colors.text,
        catAxisLabelFontSize: 12,
        valAxisLabelFontSize: 11,
        catAxisLineColor: 'E0E0E0',
        valAxisLineColor: 'E0E0E0',
        valGridLine: { color: 'EDEDED', style: 'solid', size: 0.75 },
        catGridLine: { style: 'none' }
    };
    if (!isRing) opts.dataLabelPosition = 'outEnd';
    if (isRing) opts.dataLabelPosition = 'bestFit';
    if (type === 'radar') { opts.showLegend = true; delete opts.valGridLine; delete opts.catGridLine; }

    try {
        slide.addChart(type, chartData, opts);
    } catch (e) {
        console.warn('Chart generation failed:', e);
    }
}

// =====================================================================
// COMPARISON — two clean cards, no top color-bar (avoids the
// "accent stripe" look), separated by generous whitespace instead.
// =====================================================================
function addComparisonSlide(slide, slideData, colors) {
    const left = slideData.comparisonData?.left || [];
    const right = slideData.comparisonData?.right || [];
    const colW = 5.6, gap = 0.5, startX = 0.7, top = 1.9, h = 4.6;

    const drawCard = (x, heading, headingColor, items) => {
        slide.addShape('roundRect', {
            x, y: top, w: colW, h,
            rectRadius: 0.12,
            fill: { color: 'FAFAFA' },
            line: { color: 'E5E5E5', width: 1 }
        });
        slide.addText(heading, {
            x: x + 0.35, y: top + 0.3, w: colW - 0.7, h: 0.5,
            fontSize: 18, bold: true, color: headingColor, fontFace: 'Arial', margin: 0
        });
        let yPos = top + 0.95;
        items.slice(0, 6).forEach(item => {
            slide.addText(item, {
                x: x + 0.35, y: yPos, w: colW - 0.7, h: 0.55,
                fontSize: 13.5, color: colors.text, fontFace: 'Arial',
                valign: 'top', bullet: { code: '25CF', indent: 14 }
            });
            yPos += 0.62;
        });
    };

    drawCard(startX, 'Before', colors.primary, left);
    drawCard(startX + colW + gap, 'After', colors.secondary || colors.primary, right);
}

// =====================================================================
// TIMELINE
// =====================================================================
function addTimelineSlide(slide, slideData, colors) {
    const timeline = slideData.timelineData || [];
    if (timeline.length === 0) return;

    const numItems = Math.min(timeline.length, 8);
    const usableWidth = 10.5;
    const spacing = usableWidth / numItems;
    const yPos = 3.6;
    const startX = 1.4;

    slide.addShape('rect', {
        x: startX, y: yPos, w: numItems * spacing, h: 0.03,
        fill: { color: 'D8D8D8' }, line: { type: 'none' }
    });

    timeline.slice(0, 8).forEach((item, idx) => {
        const xPos = startX + idx * spacing + spacing / 2 - 0.15;

        slide.addShape('ellipse', {
            x: xPos, y: yPos - 0.12, w: 0.3, h: 0.3,
            fill: { color: colors.primary },
            line: { color: 'FFFFFF', width: 1.5 }
        });
        slide.addText(item.time || '', {
            x: xPos - 0.75, y: yPos - 0.85, w: spacing, h: 0.45,
            fontSize: 13, color: colors.primary, align: 'center', bold: true, fontFace: 'Arial'
        });
        const eventText = String(item.event || '');
        slide.addText(eventText, {
            x: xPos - 0.85 - (spacing - 0.3) / 2, y: yPos + 0.35, w: spacing + 0.3, h: 0.9,
            fontSize: 11, color: colors.text, align: 'center', valign: 'top', fontFace: 'Arial', shrinkText: true
        });
    });
}

// =====================================================================
// BIG NUMBER
// =====================================================================
function addBigNumberSlide(slide, slideData, colors) {
    const bigNum = slideData.bigNumber || { number: 'N/A', label: 'Statistic' };

    slide.addText(String(bigNum.number), {
        x: 0.7, y: 1.7, w: 11.93, h: 2.2,
        fontSize: 96, color: colors.primary, align: 'center', bold: true, fontFace: 'Arial'
    });
    slide.addText(String(bigNum.label), {
        x: 0.7, y: 3.9, w: 11.93, h: 0.7,
        fontSize: 24, color: colors.text, align: 'center', fontFace: 'Arial'
    });

    if (slideData.bullets && slideData.bullets.length > 0) {
        let yPos = 4.9;
        slideData.bullets.slice(0, 3).forEach(bullet => {
            slide.addText(bullet, {
                x: 1.5, y: yPos, w: 10.33, h: 0.5,
                fontSize: 14, color: colors.text, fontFace: 'Arial',
                align: 'center', valign: 'top'
            });
            yPos += 0.55;
        });
    }
}

// =====================================================================
// SHARED HEADER ACCENT + FOOTER — used by every "standard" content slide
// (content/chart/comparison/timeline/big-number/agenda/two-column/process)
// so the frame around each slide's own content stays consistent instead of
// each slide type re-implementing its own footer/heading treatment.
// =====================================================================
function addHeaderAccent(slide, colors) {
    // A slim theme-colored rule directly under the heading — ties every
    // content slide to the active theme without a heavy full-width bar.
    slide.addShape('rect', {
        x: GRID.marginX, y: GRID.accentY, w: 1.1, h: 0.045,
        fill: { color: colors.accentBar || colors.primary }, line: { type: 'none' }
    });
}

function addFooter(slide, pageNum, totalSlides, colors, label) {
    if (label) {
        slide.addText(label, {
            x: GRID.marginX, y: GRID.footerY, w: 6, h: 0.3,
            fontSize: TYPE_SCALE.micro, color: '999999', align: 'left', fontFace: 'Arial'
        });
    }
    slide.addText(`${pageNum} / ${totalSlides}`, {
        x: GRID.pageW - GRID.marginX - 2, y: GRID.footerY, w: 2, h: 0.3,
        fontSize: TYPE_SCALE.micro, color: '999999', align: 'right', fontFace: 'Arial'
    });
}

// =====================================================================
// SECTION DIVIDER — full-bleed themed slide marking a new major part of
// the deck. Builds and returns the whole slide itself (unlike the other
// add*Slide helpers) since it deliberately skips the standard
// heading+footer frame in favor of its own full-bleed treatment.
// =====================================================================
function addSectionDividerSlide(pptx, slideData, colors, sectionNum) {
    const slide = pptx.addSlide();
    slide.background = { color: colors.primaryDark || colors.primary };
    slide.addShape('rect', { x: 0, y: 3.55, w: GRID.pageW, h: 0.035, fill: { color: colors.accent || colors.secondary }, line: { type: 'none' } });
    slide.addText(String(sectionNum).padStart(2, '0'), {
        x: GRID.marginX, y: 2.45, w: 2, h: 0.7, fontSize: TYPE_SCALE.small, bold: true,
        color: colors.onDarkFaint, fontFace: 'Arial'
    });
    slide.addText(slideData.title || 'Section', {
        x: GRID.marginX, y: 3.0, w: GRID.contentW, h: 1.1, fontSize: 36, bold: true,
        color: 'FFFFFF', fontFace: 'Arial'
    });
    if (slideData.bullets && slideData.bullets[0]) {
        slide.addText(slideData.bullets[0], {
            x: GRID.marginX, y: 4.15, w: GRID.contentW, h: 0.6, fontSize: TYPE_SCALE.body,
            italic: true, color: colors.onDarkMuted, fontFace: 'Arial'
        });
    }
    return slide;
}

// =====================================================================
// AGENDA / TABLE OF CONTENTS — numbered list of upcoming sections.
// =====================================================================
function addAgendaSlide(slide, slideData, colors) {
    const items = slideData.bullets || [];
    if (items.length === 0) return;
    const top = GRID.bodyTop;
    const rowH = Math.min(0.85, 4.9 / items.length);
    let y = top;
    items.slice(0, 8).forEach((item, idx) => {
        slide.addShape('ellipse', { x: GRID.marginX, y: y + (rowH - 0.42) / 2, w: 0.42, h: 0.42, fill: { color: colors.primary }, line: { type: 'none' } });
        slide.addText(String(idx + 1), {
            x: GRID.marginX, y: y + (rowH - 0.42) / 2, w: 0.42, h: 0.42, fontSize: TYPE_SCALE.small,
            bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: 'Arial'
        });
        slide.addText(item, {
            x: GRID.marginX + 0.65, y, w: GRID.contentW - 0.65, h: rowH,
            fontSize: TYPE_SCALE.body, color: colors.text, valign: 'middle', fontFace: 'Arial'
        });
        y += rowH;
    });
}

// =====================================================================
// TWO-COLUMN — text+text, or text+image when an image source is present
// on the slide data (imageUrl/imageData). Nothing upstream currently
// supplies an image for a Lixa-generated document, so this path is
// dormant today but ready the moment one is — see slide.imageUrl/imageData
// handling in validateAndCleanSlides().
// =====================================================================
function addTwoColumnSlide(slide, slideData, colors) {
    const left = (slideData.columns && slideData.columns.left) || {};
    const right = (slideData.columns && slideData.columns.right) || {};
    const bullets = slideData.bullets || [];
    const leftItems = left.bullets && left.bullets.length ? left.bullets : bullets.slice(0, Math.ceil(bullets.length / 2));
    const rightItems = right.bullets && right.bullets.length ? right.bullets : bullets.slice(Math.ceil(bullets.length / 2));
    const imageSrc = slideData.imageData || slideData.imageUrl;

    const colW = 5.6, gap = 0.35, startX = GRID.marginX, top = GRID.bodyTop;
    const rightX = startX + colW + gap;

    if (left.heading) {
        slide.addText(left.heading, { x: startX, y: top, w: colW, h: 0.5, fontSize: TYPE_SCALE.h2, bold: true, color: colors.headingColor || colors.primary, fontFace: 'Arial' });
    }
    let ly = top + (left.heading ? 0.6 : 0);
    leftItems.slice(0, 6).forEach((item) => {
        slide.addText(item, { x: startX, y: ly, w: colW, h: 0.6, fontSize: TYPE_SCALE.bodySmall, color: colors.text, fontFace: 'Arial', valign: 'top', bullet: { code: '25CF', indent: 14 } });
        ly += 0.65;
    });

    if (imageSrc) {
        const imgOpts = { x: rightX, y: top, w: colW, h: 4.6, sizing: { type: 'contain', w: colW, h: 4.6 } };
        if (/^data:/.test(imageSrc)) imgOpts.data = imageSrc; else imgOpts.path = imageSrc;
        try { slide.addImage(imgOpts); } catch (e) { console.warn('Two-column image failed to embed:', e); }
    } else {
        if (right.heading) {
            slide.addText(right.heading, { x: rightX, y: top, w: colW, h: 0.5, fontSize: TYPE_SCALE.h2, bold: true, color: colors.secondary || colors.primary, fontFace: 'Arial' });
        }
        let ry = top + (right.heading ? 0.6 : 0);
        rightItems.slice(0, 6).forEach((item) => {
            slide.addText(item, { x: rightX, y: ry, w: colW, h: 0.6, fontSize: TYPE_SCALE.bodySmall, color: colors.text, fontFace: 'Arial', valign: 'top', bullet: { code: '25CF', indent: 14 } });
            ry += 0.65;
        });
    }
}

// =====================================================================
// QUOTE / CALLOUT — a single standout statement, set apart from ordinary
// content slides. Builds the whole slide (its own background/heading
// treatment), like the section divider.
// =====================================================================
function addQuoteSlide(pptx, slideData, colors) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FAFAFA' };
    slide.addText('“', { x: GRID.marginX, y: 0.5, w: 2, h: 1.5, fontSize: 90, bold: true, color: colors.primaryLight || colors.primary, fontFace: 'Georgia' });
    const quoteText = slideData.quote || (slideData.bullets && slideData.bullets[0]) || '';
    slide.addText(quoteText, {
        x: 1.3, y: 2.2, w: 10.73, h: 2.6, fontSize: 26, italic: true,
        color: colors.headingColor || colors.text, align: 'center', valign: 'middle', fontFace: 'Arial'
    });
    const attribution = slideData.attribution || '';
    if (attribution) {
        slide.addText(`— ${attribution}`, {
            x: 1.3, y: 5.0, w: 10.73, h: 0.5, fontSize: TYPE_SCALE.small,
            color: colors.secondary || colors.primary, align: 'center', bold: true, fontFace: 'Arial'
        });
    }
    return slide;
}

// =====================================================================
// PROCESS / FLOW-STEP — an ordered sequence of steps (protocol, workflow),
// distinct from the timeline (which is date/event-based).
// =====================================================================
function addProcessSlide(slide, slideData, colors) {
    const steps = (slideData.processSteps && slideData.processSteps.length)
        ? slideData.processSteps
        : (slideData.bullets || []).map(b => ({ label: b, description: '' }));
    const n = Math.min(steps.length, 6);
    if (n === 0) return;

    const startX = GRID.marginX, top = 2.7, gap = 0.22, boxH = 2.0;
    const boxW = (GRID.contentW - gap * (n - 1)) / n;

    steps.slice(0, n).forEach((step, idx) => {
        const x = startX + idx * (boxW + gap);
        const fill = idx % 2 === 0 ? colors.primary : (colors.primaryDark || colors.primary);
        slide.addShape('roundRect', { x, y: top, w: boxW, h: boxH, rectRadius: 0.08, fill: { color: fill }, line: { type: 'none' } });
        slide.addText(String(idx + 1), { x, y: top + 0.12, w: boxW, h: 0.4, fontSize: TYPE_SCALE.body, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Arial' });
        slide.addText(step.label || `Step ${idx + 1}`, {
            x: x + 0.12, y: top + 0.55, w: boxW - 0.24, h: 0.6, fontSize: 12.5, bold: true,
            color: 'FFFFFF', align: 'center', valign: 'top', fontFace: 'Arial', shrinkText: true
        });
        if (step.description) {
            slide.addText(step.description, {
                x: x + 0.12, y: top + 1.15, w: boxW - 0.24, h: boxH - 1.25, fontSize: 10.5,
                color: colors.onDarkMuted || 'E8E8E8', align: 'center', valign: 'top', fontFace: 'Arial', shrinkText: true
            });
        }
        if (idx < n - 1) {
            slide.addShape('rightArrow', {
                x: x + boxW + (gap - 0.16) / 2, y: top + boxH / 2 - 0.08, w: 0.16, h: 0.16,
                fill: { color: colors.accent || colors.secondary }, line: { type: 'none' }
            });
        }
    });
}

// =====================================================================
// GENERATE PPTX
// =====================================================================
async function generatePPTX() {
    if (!contentData) {
        showToast('No content to export.', 'error');
        return;
    }

    getDOMElements();

    if (generationStatus) {
        generationStatus.style.display = 'block';
        generationStatus.className = '';
        if (statusText) statusText.textContent = 'Preparing your presentation...';
    }
    if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    }

    try {
        const rawContent = contentData.content;
        const modeLabel = contentData.modeLabel || 'Clinical Presentation';
        const patientDisplay = contentData.patientName || 'N/A';
        const diagnosis = contentData.diagnosis || 'N/A';
        const profession = contentData.profession || 'N/A';

        if (statusText) statusText.textContent = 'Structuring content...';
        showToast('Structuring content...', 'info', 3000);

        let slides = await structureContentWithAI(rawContent, modeLabel, patientDisplay, diagnosis);
        if (!slides || !Array.isArray(slides) || slides.length === 0) {
            slides = createFallbackStructure(rawContent, modeLabel, patientDisplay);
        }
        structuredSlides = slides;

        // Extract tables from content
        const extractedTables = [];
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = rawContent;
        tempDiv.querySelectorAll('table').forEach(table => {
            const rows = [];
            table.querySelectorAll('tr').forEach(tr => {
                const cells = [];
                tr.querySelectorAll('td, th').forEach(td => cells.push(td.textContent.trim()));
                if (cells.length > 0) rows.push(cells);
            });
            if (rows.length > 0) extractedTables.push(rows);
        });

        updateSlideCount();
        if (statusText) statusText.textContent = 'Building PowerPoint...';

        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
        pptx.layout = 'WIDE';

        // PptxGenJS-safe colors (no '#', no rgba) — this is the fix.
        const colors = toPptColors(selectedTheme.colors);
        const totalSlides = slides.length + 2 + (extractedTables.length > 0 ? 1 : 0);
        // Footer topic/patient label (feature: footer on every content
        // slide except the title slide) — prefers the patient's name when
        // there is one, falls back to the deck's own topic/mode label.
        const footerLabel = (patientDisplay && patientDisplay !== 'N/A') ? patientDisplay : modeLabel;

        // -----------------------------------------------------------
        // TITLE SLIDE — solid dark background, no duplicate overlay,
        // no accent bars. Dark/light "sandwich" bookends the deck.
        // -----------------------------------------------------------
        const slideTitle = pptx.addSlide();
        slideTitle.background = { color: colors.primaryDark || colors.primary };

        slideTitle.addText(modeLabel, {
            x: 0.9, y: 1.5, w: 11.53, h: 1.6,
            fontSize: TYPE_SCALE.titleXL, color: 'FFFFFF', fontFace: 'Arial', bold: true, align: 'center'
        });
        slideTitle.addText(patientDisplay, {
            x: 0.9, y: 3.1, w: 11.53, h: 0.9,
            fontSize: TYPE_SCALE.titleL, color: 'FFFFFF', fontFace: 'Arial', bold: true, align: 'center'
        });
        slideTitle.addText('Clinical Presentation', {
            x: 0.9, y: 4.0, w: 11.53, h: 0.55,
            fontSize: 17, color: colors.onDarkFaint, fontFace: 'Arial', italic: true, align: 'center'
        });
        const meta = [`Clinician: ${profession}`, `Diagnosis: ${diagnosis}`, `Date: ${new Date().toLocaleDateString()}`];
        slideTitle.addText(meta.join('   |   '), {
            x: 0.9, y: 4.75, w: 11.53, h: 0.5,
            fontSize: TYPE_SCALE.small, color: colors.onDarkMuted, fontFace: 'Arial', align: 'center'
        });
        slideTitle.addText('Generated by rehablix', {
            x: 0, y: 6.95, w: 13.33, h: 0.4,
            fontSize: TYPE_SCALE.micro, color: colors.onDarkSubtle, align: 'center', fontFace: 'Arial'
        });
        // Speaker notes are only ever written when the source data already
        // carries one — ppt.js never fabricates this field (see
        // validateAndCleanSlides / contentData.notes).
        if (contentData.notes) slideTitle.addNotes(String(contentData.notes));

        // -----------------------------------------------------------
        // CONTENT SLIDES — 'section' and 'quote' are full-bleed slide
        // types that build their own complete slide (background, title
        // placement, everything) and skip the standard heading+footer
        // frame every other type shares.
        // -----------------------------------------------------------
        let slideIndex = 1;
        let sectionCounter = 0;
        for (const slideData of slides) {
            const type = slideData.type || 'content';
            const pageNum = slideIndex + 1;

            if (type === 'section') {
                sectionCounter++;
                const slide = addSectionDividerSlide(pptx, slideData, colors, sectionCounter);
                addFooter(slide, pageNum, totalSlides, colors, null);
                if (slideData.notes) slide.addNotes(String(slideData.notes));
                slideIndex++;
                continue;
            }
            if (type === 'quote') {
                const slide = addQuoteSlide(pptx, slideData, colors);
                addFooter(slide, pageNum, totalSlides, colors, footerLabel);
                if (slideData.notes) slide.addNotes(String(slideData.notes));
                slideIndex++;
                continue;
            }

            const slide = pptx.addSlide();
            slide.background = { color: 'FFFFFF' };
            addHeaderAccent(slide, colors);

            slide.addText(slideData.title || 'Section', {
                x: GRID.marginX, y: GRID.headingY, w: GRID.contentW, h: GRID.headingH,
                fontSize: TYPE_SCALE.h1, color: colors.headingColor || colors.primary,
                fontFace: 'Arial', bold: true, valign: 'middle', margin: 0
            });

            const bullets = slideData.bullets || [];

            switch (type) {
                case 'chart':
                    if (slideData.chartData) addChartToSlide(slide, slideData, colors);
                    if (bullets.length > 0) {
                        let yPos = GRID.bodyTop;
                        bullets.slice(0, 5).forEach(bullet => {
                            slide.addText(bullet, {
                                x: 8.5, y: yPos, w: 4.1, h: 0.7,
                                fontSize: TYPE_SCALE.small, color: colors.text, fontFace: 'Arial',
                                valign: 'top', bullet: { code: '25CF', indent: 12 }
                            });
                            yPos += 0.78;
                        });
                    }
                    break;

                case 'comparison':
                    addComparisonSlide(slide, slideData, colors);
                    break;

                case 'timeline':
                    addTimelineSlide(slide, slideData, colors);
                    break;

                case 'big-number':
                    addBigNumberSlide(slide, slideData, colors);
                    break;

                case 'agenda':
                    addAgendaSlide(slide, slideData, colors);
                    break;

                case 'two-column':
                    addTwoColumnSlide(slide, slideData, colors);
                    break;

                case 'process':
                    addProcessSlide(slide, slideData, colors);
                    break;

                default: {
                    const bulletCount = Math.min(bullets.length, 6);
                    if (bulletCount > 0) {
                        let yPos = GRID.bodyTop;
                        const rowH = Math.min(0.85, 4.9 / bulletCount);
                        bullets.slice(0, bulletCount).forEach(bullet => {
                            slide.addText(bullet, {
                                x: 0.9, y: yPos, w: 11.53, h: rowH,
                                fontSize: TYPE_SCALE.body, color: colors.text, fontFace: 'Arial',
                                valign: 'top', bullet: { code: '25CF', indent: 16 },
                                paraSpaceAfter: 8
                            });
                            yPos += rowH;
                        });
                    } else {
                        slide.addText('(No content available)', {
                            x: 0.9, y: 2.0, w: 11.53, h: 0.6,
                            fontSize: 15, color: colors.secondary || '999999',
                            fontFace: 'Arial', italic: true, valign: 'top'
                        });
                    }
                    break;
                }
            }

            addFooter(slide, pageNum, totalSlides, colors, footerLabel);
            if (slideData.notes) slide.addNotes(String(slideData.notes));
            slideIndex++;
        }

        // -----------------------------------------------------------
        // TABLE SLIDE (native table, not hand-drawn text boxes)
        // -----------------------------------------------------------
        if (extractedTables.length > 0) {
            const tableSlide = pptx.addSlide();
            tableSlide.background = { color: 'FFFFFF' };
            addHeaderAccent(tableSlide, colors);

            tableSlide.addText('Data Table', {
                x: GRID.marginX, y: GRID.headingY, w: GRID.contentW, h: GRID.headingH,
                fontSize: TYPE_SCALE.h1, color: colors.headingColor || colors.primary,
                fontFace: 'Arial', bold: true, valign: 'middle', margin: 0
            });

            addNativeTable(tableSlide, extractedTables[0], colors, 0.9, GRID.bodyTop, 11.53);

            addFooter(tableSlide, slideIndex + 1, totalSlides, colors, footerLabel);
            slideIndex++;
        }

        // -----------------------------------------------------------
        // CLOSING SLIDE
        // -----------------------------------------------------------
        const thankSlide = pptx.addSlide();
        thankSlide.background = { color: colors.primaryDark || colors.primary };

        thankSlide.addText('Thank You', {
            x: 0.9, y: 2.3, w: 11.53, h: 1.6,
            fontSize: 50, color: 'FFFFFF', fontFace: 'Arial', bold: true, align: 'center'
        });
        thankSlide.addText(patientDisplay, {
            x: 0.9, y: 4.0, w: 11.53, h: 0.7,
            fontSize: 22, color: colors.onDarkMuted, fontFace: 'Arial', align: 'center'
        });
        thankSlide.addText('Generated with rehablix', {
            x: 0.9, y: 4.75, w: 11.53, h: 0.5,
            fontSize: 13, color: colors.onDarkSubtle, fontFace: 'Arial', align: 'center'
        });

        // -----------------------------------------------------------
        // DOWNLOAD
        // -----------------------------------------------------------
        const fileName = `${patientDisplay.replace(/\s+/g, '_')}_${modeLabel.replace(/\s+/g, '_')}_${Date.now()}.pptx`;
        await pptx.writeFile({ fileName });

        if (statusText) statusText.textContent = 'PowerPoint downloaded successfully!';
        if (generationStatus) generationStatus.className = 'success';
        showToast('PowerPoint downloaded successfully!');

    } catch (err) {
        console.error('Generation error:', err);
        if (statusText) statusText.textContent = 'Error: ' + err.message;
        if (generationStatus) generationStatus.className = 'error';
        showToast('Error generating PowerPoint: ' + err.message, 'error');
    } finally {
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="fas fa-magic"></i> Generate & Download';
        }
        setTimeout(() => {
            if (generationStatus) generationStatus.style.display = 'none';
        }, 5000);
    }
}

// =====================================================================
// EVENT LISTENERS
// =====================================================================
function setupEventListeners() {
    getDOMElements();

    document.querySelectorAll('input[name="artStyle"]').forEach(el => {
        el.addEventListener('change', (e) => {
            selectedArtStyle = e.target.value;
            document.querySelectorAll('.style-option').forEach(opt => opt.classList.remove('selected'));
            e.target.closest('.style-option').classList.add('selected');
            updateStepIndicator(2);
        });
    });

    if (generateBtn) generateBtn.addEventListener('click', () => generatePPTX());

    document.querySelectorAll('.step-item').forEach((item, index) => {
        item.addEventListener('click', () => {
            const cards = document.querySelectorAll('.ppt-card');
            if (cards[index]) cards[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement === generateBtn) generatePPTX();
});

if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().onAuthStateChanged((user) => {
        currentUser = user;
        if (user) console.log('[PPT] User logged in:', user.email);
    });
}

async function init() {
    console.log('[PPT] Initializing...');
    await waitForDOM();
    getDOMElements();
    renderThemes();
    setupCarouselNav();

    const contentLoaded = loadContent();
    if (!contentLoaded && generateBtn) {
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> No content loaded';
    }

    setupEventListeners();
    updateStepIndicator(1);
    await fetchTokens();

    isInitialized = true;
    console.log('[PPT] Ready!');
}

init();
