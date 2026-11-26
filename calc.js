/* =====================================================================
   BATTLE CALCULATOR — clash-calc.js
   Sections:
   1. State & Constants
   2. Math Engine (safe parser, no eval)
   3. Number & Expression Formatting
   4. Calculator Actions
   5. Rendering
   6. Button Feedback
   7. Sound (Web Audio, no files needed)
   8. Particle System (embers, coins, elixir)
   9. Special Button: Elixir Surge
   10. Event Handling
   11. Initialisation
   ===================================================================== */

'use strict';


/* =====================================================================
   1. STATE & CONSTANTS
   ===================================================================== */
const MAX_NUMBER_LENGTH = 15;
const MAX_EXPRESSION_LENGTH = 60;
const OPERATORS = ['+', '-', '×', '÷'];

const state = {
    expression: '',
    previous: '',
    justEvaluated: false,
    errorMessage: '',
    lastOperation: null,
    surging: false
};

const calculatorEl   = document.getElementById('calculator');
const displayEl      = document.getElementById('display');
const previousLineEl = document.getElementById('previousLine');
const currentLineEl  = document.getElementById('currentLine');
const keysContainer  = document.getElementById('keys');
const keyButtons     = Array.from(keysContainer.querySelectorAll('.key'));
const surgeBtn       = document.getElementById('surgeBtn');
const soundToggle    = document.getElementById('soundToggle');
const screenFlashEl  = document.getElementById('screenFlash');
const vignetteEl     = document.getElementById('surgeVignette');

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function isOperator(character) {
    return OPERATORS.includes(character);
}


/* =====================================================================
   2. MATH ENGINE  (unchanged from your original calculator)
   ===================================================================== */
function evaluate(expression) {
    let position = 0;
    let lastFactorWasPercent = false;

    function peek() {
        return expression[position];
    }

    function parseExpression() {
        let result = parseTerm().value;

        while (peek() === '+' || peek() === '-') {
            const operator = expression[position++];
            const term = parseTerm();
            let right = term.value;

            // "a + n%" means a + (a × n / 100)
            if (term.isBarePercent) {
                right = result * right;
            }

            result = operator === '+' ? result + right : result - right;
        }
        return result;
    }

    function parseTerm() {
        lastFactorWasPercent = false;
        let value = parseUnary();
        let isBarePercent = lastFactorWasPercent;

        while (peek() === '×' || peek() === '÷') {
            isBarePercent = false;
            const operator = expression[position++];
            const right = parseUnary();

            if (operator === '×') {
                value *= right;
            } else {
                if (right === 0) {
                    throw new Error('DIVIDE_BY_ZERO');
                }
                value /= right;
            }
        }
        return { value: value, isBarePercent: isBarePercent };
    }

    function parseUnary() {
        if (peek() === '-') {
            position++;
            return -parseUnary();
        }
        if (peek() === '+') {
            position++;
            return parseUnary();
        }
        return parsePostfix();
    }

    function parsePostfix() {
        let value = parseNumber();
        let percentCount = 0;

        while (peek() === '%') {
            position++;
            value /= 100;
            percentCount++;
        }
        lastFactorWasPercent = percentCount > 0;
        return value;
    }

    function parseNumber() {
        const match = /^(\d+\.?\d*|\.\d+)/.exec(expression.slice(position));
        if (!match) {
            throw new Error('SYNTAX');
        }
        position += match[0].length;
        return parseFloat(match[0]);
    }

    const finalValue = parseExpression();

    if (position !== expression.length) {
        throw new Error('SYNTAX');
    }
    return finalValue;
}


/* =====================================================================
   3. NUMBER & EXPRESSION FORMATTING
   ===================================================================== */
function formatNumber(value) {
    if (!Number.isFinite(value)) {
        throw new Error('OVERFLOW');
    }

    const rounded = Number(value.toPrecision(12));
    if (rounded === 0) {
        return '0';
    }

    const absolute = Math.abs(rounded);
    if (absolute >= 1e21) {
        throw new Error('OVERFLOW');
    }
    if (absolute < 1e-6) {
        return rounded.toFixed(12).replace(/\.?0+$/, '');
    }
    return String(rounded);
}

function formatExpression(expression) {
    let output = '';

    for (let i = 0; i < expression.length; i++) {
        const character = expression[i];

        if (isOperator(character)) {
            const isUnaryMinus = character === '-' && (i === 0 || isOperator(expression[i - 1]));
            if (isUnaryMinus) {
                output += '-';
            } else {
                output += ' ' + (character === '-' ? '−' : character) + ' ';
            }
        } else {
            output += character;
        }
    }
    return output;
}

function getLastNumber(expression) {
    return /(\d*\.?\d*)$/.exec(expression)[1];
}

function stripTrailingOperators(expression) {
    let result = expression;
    while (result.length > 0 && isOperator(result.slice(-1))) {
        result = result.slice(0, -1);
    }
    return result;
}

function getDisplayOperand(expression) {
    const base = stripTrailingOperators(expression);
    if (base === '') {
        return expression === '-' ? '-' : '0';
    }

    const match = /(\d*\.?\d*%*)$/.exec(base);
    let token = match[1];
    const start = base.length - token.length;

    const isNegative = base[start - 1] === '-' &&
        (start - 1 === 0 || isOperator(base[start - 2]));

    if (isNegative) {
        token = '-' + token;
    }
    return token === '' ? '0' : token;
}

function getErrorText(error) {
    switch (error.message) {
        case 'DIVIDE_BY_ZERO': return 'Cannot divide by zero';
        case 'OVERFLOW':       return 'Number too large';
        default:               return 'Invalid expression';
    }
}


/* =====================================================================
   4. CALCULATOR ACTIONS  (unchanged from your original calculator)
   ===================================================================== */
function clearErrorIfNeeded() {
    if (state.errorMessage) {
        state.errorMessage = '';
        state.expression = '';
        state.previous = '';
        state.justEvaluated = false;
        state.lastOperation = null;
    }
}

function startNewIfEvaluated() {
    if (state.justEvaluated) {
        state.expression = '';
        state.previous = '';
        state.justEvaluated = false;
        state.lastOperation = null;
    }
}

function inputDigit(digit) {
    clearErrorIfNeeded();
    startNewIfEvaluated();

    const expression = state.expression;

    if (expression.endsWith('%')) return;
    if (expression.length >= MAX_EXPRESSION_LENGTH) return;

    const lastNumber = getLastNumber(expression);
    if (lastNumber.length >= MAX_NUMBER_LENGTH) return;

    if (lastNumber === '0') {
        state.expression = expression.slice(0, -1) + digit;
    } else {
        state.expression = expression + digit;
    }
}

function inputDecimal() {
    clearErrorIfNeeded();

    if (state.justEvaluated) {
        state.expression = '0.';
        state.previous = '';
        state.justEvaluated = false;
        state.lastOperation = null;
        return;
    }

    const expression = state.expression;

    if (expression.endsWith('%')) return;
    if (expression.length >= MAX_EXPRESSION_LENGTH) return;

    const lastNumber = getLastNumber(expression);
    if (lastNumber.includes('.')) return;

    state.expression = expression + (lastNumber === '' ? '0.' : '.');
}

function inputOperator(operator) {
    clearErrorIfNeeded();

    if (state.justEvaluated) {
        state.justEvaluated = false;
        state.previous = '';
        state.lastOperation = null;
    }

    const expression = state.expression;

    if (expression === '') {
        if (operator === '-') {
            state.expression = '-';
        }
        return;
    }
    if (expression === '-') return;

    if (isOperator(expression.slice(-1))) {
        let base = expression.slice(0, -1);
        if (isOperator(base.slice(-1))) {
            base = base.slice(0, -1);
        }
        if (base === '') return;
        state.expression = base + operator;
        return;
    }

    if (expression.length >= MAX_EXPRESSION_LENGTH) return;
    state.expression = expression + operator;
}

function inputPercent() {
    clearErrorIfNeeded();

    const expression = state.expression;
    if (expression === '') return;

    const lastCharacter = expression.slice(-1);
    if (!/[\d%]/.test(lastCharacter)) return;
    if (expression.length >= MAX_EXPRESSION_LENGTH) return;

    state.justEvaluated = false;
    state.previous = '';
    state.lastOperation = null;
    state.expression = expression + '%';
}

function toggleSign() {
    clearErrorIfNeeded();

    const expression = state.expression;
    if (expression === '' || expression === '0') return;
    if (isOperator(expression.slice(-1))) return;

    const match = /(\d*\.?\d*%*)$/.exec(expression);
    const start = expression.length - match[1].length;
    const before = expression[start - 1];
    const beforeBefore = expression[start - 2];
    let next;

    if (start === 0) {
        next = '-' + expression;
    } else if (before === '-') {
        const isUnary = (start - 1 === 0) || isOperator(beforeBefore);
        next = isUnary
            ? expression.slice(0, start - 1) + expression.slice(start)
            : expression.slice(0, start - 1) + '+' + expression.slice(start);
    } else if (before === '+') {
        next = expression.slice(0, start - 1) + '-' + expression.slice(start);
    } else {
        next = expression.slice(0, start) + '-' + expression.slice(start);
    }

    state.justEvaluated = false;
    state.previous = '';
    state.lastOperation = null;
    state.expression = next;
}

function deleteLast() {
    if (state.errorMessage) {
        clearAll();
        return;
    }
    if (state.justEvaluated) return;

    state.previous = '';
    state.expression = state.expression.slice(0, -1);
}

function clearAll() {
    state.expression = '';
    state.previous = '';
    state.errorMessage = '';
    state.justEvaluated = false;
    state.lastOperation = null;
}

function rememberLastOperation(expression) {
    const match = /[\d%.]([+\-×÷])(-?[\d.]+%*)$/.exec(expression);
    state.lastOperation = match ? { operator: match[1], operand: match[2] } : null;
}

function calculate() {
    if (state.errorMessage) return false;

    let expression;

    if (state.justEvaluated) {
        if (!state.lastOperation) return false;
        expression = state.expression + state.lastOperation.operator + state.lastOperation.operand;
    } else {
        expression = state.expression;
        if (expression === '' || expression === '-') return false;

        if (isOperator(expression.slice(-1))) {
            const operator = expression.slice(-1);
            const base = stripTrailingOperators(expression);
            if (base === '') return false;
            expression = base + operator + getDisplayOperand(base);
        }
    }

    try {
        const result = formatNumber(evaluate(expression));
        if (!state.justEvaluated) {
            rememberLastOperation(expression);
        }
        state.previous = formatExpression(expression) + ' =';
        state.expression = result;
        state.justEvaluated = true;
        return true;
    } catch (error) {
        state.previous = formatExpression(expression) + ' =';
        state.expression = '';
        state.errorMessage = getErrorText(error);
        state.justEvaluated = false;
        state.lastOperation = null;
        return false;
    }
}


/* =====================================================================
   5. RENDERING
   ===================================================================== */
let lastRenderedText = null;

function fitDisplayText() {
    currentLineEl.style.fontSize = '';
    let size = parseFloat(getComputedStyle(currentLineEl).fontSize);

    while (currentLineEl.scrollWidth > currentLineEl.clientWidth && size > 18) {
        size -= 2;
        currentLineEl.style.fontSize = size + 'px';
    }
    currentLineEl.scrollLeft = currentLineEl.scrollWidth;
}

function render() {
    let text;
    let previousText;

    if (state.errorMessage) {
        text = state.errorMessage;
        previousText = state.previous;
    } else if (state.justEvaluated) {
        text = state.expression;
        previousText = state.previous;
    } else {
        text = getDisplayOperand(state.expression);
        previousText = formatExpression(state.expression);
    }

    currentLineEl.textContent = text;
    currentLineEl.classList.toggle('is-error', Boolean(state.errorMessage));
    previousLineEl.textContent = previousText;

    fitDisplayText();

    if (text !== lastRenderedText) {
        currentLineEl.classList.remove('tick');
        void currentLineEl.offsetWidth;
        currentLineEl.classList.add('tick');
        lastRenderedText = text;
    }
}


/* =====================================================================
   6. BUTTON FEEDBACK
   ===================================================================== */
function addRipple(button, event) {
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');

    const clientX = event && event.clientX ? event.clientX : rect.left + rect.width / 2;
    const clientY = event && event.clientY ? event.clientY : rect.top + rect.height / 2;

    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (clientY - rect.top - size / 2) + 'px';

    button.appendChild(ripple);
    ripple.addEventListener('animationend', function () { ripple.remove(); });
}

function flashKeyboardPress(button) {
    button.classList.add('is-pressed');
    setTimeout(function () { button.classList.remove('is-pressed'); }, 130);
}


/* =====================================================================
   7. SOUND  (tiny synthesized effects — no audio files)
   ===================================================================== */
const Sound = (function () {
    let audio = null;
    let enabled = true;

    function context() {
        if (!audio) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return null;
            audio = new AudioCtx();
        }
        if (audio.state === 'suspended') audio.resume();
        return audio;
    }

    // Plays one oscillator note
    function tone(freq, type, start, duration, volume, endFreq) {
        const ctx = context();
        if (!ctx || !enabled) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = ctx.currentTime + start;

        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);

        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + duration + 0.05);
    }

    // Filtered noise burst (booms, whooshes)
    function noise(start, duration, volume, fromFreq, toFreq) {
        const ctx = context();
        if (!ctx || !enabled) return;

        const length = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

        const source = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        const t0 = ctx.currentTime + start;

        source.buffer = buffer;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(fromFreq, t0);
        filter.frequency.exponentialRampToValueAtTime(toFreq, t0 + duration);
        gain.gain.setValueAtTime(volume, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start(t0);
    }

    return {
        setEnabled: function (value) { enabled = value; if (value) context(); },
        isEnabled: function () { return enabled; },

        key: function () {
            tone(300 + Math.random() * 120, 'square', 0, 0.07, 0.05, 160);
        },
        operator: function () {
            tone(520, 'triangle', 0, 0.09, 0.08, 330);
        },
        clear: function () {
            tone(260, 'sawtooth', 0, 0.16, 0.06, 90);
        },
        equals: function () {
            tone(988, 'square', 0, 0.09, 0.06);
            tone(1318, 'square', 0.08, 0.28, 0.06);
            tone(1976, 'sine', 0.08, 0.35, 0.05);
        },
        error: function () {
            tone(160, 'sawtooth', 0, 0.25, 0.08, 70);
        },
        surgeCharge: function () {
            tone(110, 'sawtooth', 0, 0.95, 0.09, 880);
            tone(220, 'square', 0, 0.95, 0.04, 1320);
            noise(0, 0.95, 0.12, 300, 5000);
        },
        surgeBoom: function () {
            tone(120, 'sine', 0, 0.7, 0.35, 28);
            noise(0, 0.9, 0.5, 4000, 80);
            [523, 659, 784, 1047, 1319, 1568].forEach(function (f, i) {
                tone(f, 'triangle', 0.05 + i * 0.07, 0.5, 0.07);
            });
        },
        surgeRain: function () {
            for (let i = 0; i < 9; i++) {
                tone(1400 + Math.random() * 1600, 'sine', i * 0.09, 0.12, 0.035);
            }
        }
    };
})();


/* =====================================================================
   8. PARTICLE SYSTEM  (one canvas: embers, coins, elixir, shockwaves)
   ===================================================================== */
const FX = (function () {
    const canvas = document.getElementById('fx');
    const ctx = canvas.getContext('2d');

    const embers = [];
    const parts = [];
    const rings = [];
    const MAX_PARTS = 420;

    const COIN_COLORS   = ['255,213,74', '255,236,140', '232,168,29', '255,255,255'];
    const ELIXIR_COLORS = ['214,150,255', '168,85,255', '240,200,255', '120,60,230'];

    let width = 0;
    let height = 0;

    function random(min, max) { return min + Math.random() * (max - min); }
    function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

    function resize() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        embers.length = 0;
        const count = Math.min(60, Math.round(width * height / 26000));
        for (let i = 0; i < count; i++) embers.push(makeEmber(true));
    }

    function makeEmber(anywhere) {
        return {
            x: Math.random() * width,
            y: anywhere ? Math.random() * height : height + 10,
            r: random(1, 2.8),
            vx: random(-0.2, 0.2),
            vy: random(-0.7, -0.25),
            phase: Math.random() * 6.28,
            color: pick(['255,200,80', '255,150,50', '255,230,150'])
        };
    }

    function addPart(p) {
        parts.push(p);
        if (parts.length > MAX_PARTS) parts.splice(0, parts.length - MAX_PARTS);
    }

    function drawStar(x, y, size, color, alpha) {
        ctx.fillStyle = 'rgba(' + color + ',' + alpha + ')';
        ctx.beginPath();
        ctx.moveTo(x, y - size);
        ctx.quadraticCurveTo(x, y, x + size, y);
        ctx.quadraticCurveTo(x, y, x, y + size);
        ctx.quadraticCurveTo(x, y, x - size, y);
        ctx.quadraticCurveTo(x, y, x, y - size);
        ctx.fill();
    }

    function drawCoin(p, alpha) {
        const squash = Math.abs(Math.cos(p.spin));
        ctx.fillStyle = 'rgba(' + p.color + ',' + alpha + ')';
        ctx.strokeStyle = 'rgba(120,70,0,' + alpha + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size * Math.max(0.2, squash), p.size, 0, 0, 6.28);
        ctx.fill();
        ctx.stroke();
    }

    function drawDrop(p, alpha) {
        ctx.fillStyle = 'rgba(' + p.color + ',' + alpha + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 6.28);
        ctx.fill();
        // little teardrop tail
        ctx.beginPath();
        ctx.moveTo(p.x - p.size * 0.8, p.y - p.size * 0.4);
        ctx.lineTo(p.x, p.y - p.size * 2.6);
        ctx.lineTo(p.x + p.size * 0.8, p.y - p.size * 0.4);
        ctx.fill();
    }

    function frame(time) {
        const t = time / 1000;
        ctx.clearRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'lighter';

        // ambient embers
        for (let i = 0; i < embers.length; i++) {
            const e = embers[i];
            e.x += e.vx + Math.sin(t + e.phase) * 0.25;
            e.y += e.vy;
            if (e.y < -10) embers[i] = makeEmber(false);
            const glow = 0.45 + 0.4 * Math.sin(t * 2 + e.phase);
            ctx.fillStyle = 'rgba(' + e.color + ',' + (glow * 0.18) + ')';
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 3, 0, 6.28); ctx.fill();
            ctx.fillStyle = 'rgba(' + e.color + ',' + glow + ')';
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 6.28); ctx.fill();
        }

        // shockwave rings
        for (let i = rings.length - 1; i >= 0; i--) {
            const ring = rings[i];
            ring.life -= 0.03;
            if (ring.life <= 0) { rings.splice(i, 1); continue; }
            ring.r += (ring.max - ring.r) * 0.12;
            ctx.strokeStyle = 'rgba(' + ring.color + ',' + ring.life + ')';
            ctx.lineWidth = 10 * ring.life + 1;
            ctx.beginPath(); ctx.arc(ring.x, ring.y, ring.r, 0, 6.28); ctx.stroke();
        }

        // particles
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];

            if (p.type === 'pull') {
                p.x += (p.tx - p.x) * p.pull;
                p.y += (p.ty - p.y) * p.pull;
                p.pull += 0.004;
            } else {
                p.x += p.vx;
                p.y += p.vy;
                p.vx *= 0.985;
                p.vy = p.vy * 0.985 + p.gravity;
            }
            p.spin += 0.25;
            p.life -= p.decay;

            if (p.life <= 0 || p.y > height + 40) { parts.splice(i, 1); continue; }

            const alpha = Math.min(1, p.life * 1.5);
            if (p.type === 'coin')       drawCoin(p, alpha);
            else if (p.type === 'drop')  drawDrop(p, alpha);
            else                         drawStar(p.x, p.y, p.size * (0.4 + p.life * 0.6), p.color, alpha);
        }

        ctx.globalCompositeOperation = 'source-over';
        requestAnimationFrame(frame);
    }

    // Radial burst. kind: 'spark' | 'coin' | 'elixir'
    function burst(x, y, count, kind) {
        if (prefersReducedMotion) count = Math.ceil(count / 4);
        const colors = kind === 'elixir' ? ELIXIR_COLORS : COIN_COLORS;
        const big = count > 12;

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * 6.28;
            const speed = random(1, big ? 9 : 3);
            addPart({
                type: kind === 'coin' ? 'coin' : kind === 'elixir' ? 'drop' : 'spark',
                x: x, y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - (big ? 3 : 1),
                gravity: kind === 'spark' ? 0.04 : 0.22,
                size: kind === 'spark' ? random(3, 7) : random(3, 6),
                spin: Math.random() * 6.28,
                life: random(0.8, 1.4),
                decay: 0.014,
                color: pick(colors)
            });
        }
    }

    // Particles that fly INTO a point (charge-up effect)
    function pull(tx, ty, count) {
        if (prefersReducedMotion) count = Math.ceil(count / 3);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * 6.28;
            const distance = random(90, Math.max(width, height) * 0.5);
            addPart({
                type: 'pull',
                x: tx + Math.cos(angle) * distance,
                y: ty + Math.sin(angle) * distance,
                tx: tx, ty: ty, pull: 0.03,
                size: random(3, 6), spin: 0,
                life: 1, decay: 0.012,
                color: pick(ELIXIR_COLORS)
            });
        }
    }

    // Elixir raining from the top of the screen
    function rain(count) {
        if (prefersReducedMotion) count = Math.ceil(count / 4);
        for (let i = 0; i < count; i++) {
            addPart({
                type: 'drop',
                x: random(0, width),
                y: random(-200, -10),
                vx: random(-0.4, 0.4),
                vy: random(3, 8),
                gravity: 0.15,
                size: random(3, 7), spin: 0,
                life: 2, decay: 0.004,
                color: pick(ELIXIR_COLORS)
            });
        }
    }

    function ring(x, y, color, maxRadius) {
        if (prefersReducedMotion) return;
        rings.push({ x: x, y: y, r: 10, max: maxRadius, life: 1, color: color });
    }

    function start() {
        resize();
        window.addEventListener('resize', resize);
        if (prefersReducedMotion) { frame(0); } else { requestAnimationFrame(frame); }
    }

    return { start: start, burst: burst, pull: pull, rain: rain, ring: ring };
})();


/* =====================================================================
   9. SPECIAL BUTTON: ELIXIR SURGE
   Sequence (about 2.4 seconds):
     0 ms     charge-up  — button shakes, particles are sucked in, screen rumbles
     950 ms   RELEASE    — white-purple flash, shockwaves, elixir explosion,
                           screen shake, the result is calculated and doubled
     1500 ms  elixir rain, vignette fades
     2500 ms  button ready again
   ===================================================================== */
function runSurge() {
    if (state.errorMessage) {          // nothing to power up: shake + buzz
        Sound.error();
        calculatorEl.classList.remove('is-shaking');
        void calculatorEl.offsetWidth;
        calculatorEl.classList.add('is-shaking');
        return;
    }

    state.surging = true;

    const rect = surgeBtn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // ---- Phase 1: charge-up
    surgeBtn.classList.add('is-charging');
    calculatorEl.classList.add('is-charging');
    document.body.classList.add('is-charging');
    vignetteEl.classList.add('on');
    Sound.surgeCharge();

    const pullTimer = setInterval(function () { FX.pull(cx, cy, 8); }, 70);

    // ---- Phase 2: release
    setTimeout(function () {
        clearInterval(pullTimer);

        surgeBtn.classList.remove('is-charging');
        calculatorEl.classList.remove('is-charging');
        document.body.classList.remove('is-charging');
        surgeBtn.classList.add('is-released');

        // Calculator effect: finish the sum, then double it
        applySurgeToResult();
        render();
        currentLineEl.classList.remove('is-surged');
        void currentLineEl.offsetWidth;
        currentLineEl.classList.add('is-surged');

        // Screen effects
        screenFlashEl.style.setProperty('--fx', (cx / window.innerWidth * 100) + '%');
        screenFlashEl.style.setProperty('--fy', (cy / window.innerHeight * 100) + '%');
        screenFlashEl.classList.remove('go');
        void screenFlashEl.offsetWidth;
        screenFlashEl.classList.add('go');

        document.body.classList.add('is-shaking');

        FX.ring(cx, cy, '255,255,255', 260);
        FX.ring(cx, cy, '200,120,255', 420);
        setTimeout(function () { FX.ring(cx, cy, '255,213,74', 560); }, 120);
        FX.burst(cx, cy, 90, 'elixir');
        FX.burst(cx, cy, 40, 'coin');
        FX.burst(cx, cy, 30, 'spark');
        Sound.surgeBoom();
    }, 950);

    // ---- Phase 3: elixir rain
    setTimeout(function () {
        vignetteEl.classList.remove('on');
        Sound.surgeRain();
        let waves = 0;
        const rainTimer = setInterval(function () {
            FX.rain(14);
            if (++waves >= 8) clearInterval(rainTimer);
        }, 110);
    }, 1500);

    // ---- Cleanup
    setTimeout(function () {
        surgeBtn.classList.remove('is-released');
        document.body.classList.remove('is-shaking');
        currentLineEl.classList.remove('is-surged');
        state.surging = false;
    }, 2500);
}

// Finishes any pending calculation, then doubles the number
function applySurgeToResult() {
    if (!state.justEvaluated && state.expression !== '' && state.expression !== '-') {
        calculate();
    }
    if (state.errorMessage) return;

    if (state.justEvaluated) {
        try {
            const doubled = formatNumber(Number(state.expression) * 2);
            state.previous = state.previous.replace(/ =$/, '') + ' ×2 ⚡ =';
            state.expression = doubled;
            state.lastOperation = null;
        } catch (error) {
            state.errorMessage = getErrorText(error);
            state.expression = '';
            state.justEvaluated = false;
        }
    }
}


/* =====================================================================
   10. EVENT HANDLING
   ===================================================================== */
function activate(button, event) {
    if (state.surging) return;   // keys are locked during the Surge sequence

    const action = button.dataset.action;
    const value = button.dataset.value;
    let succeeded = true;

    switch (action) {
        case 'digit':     inputDigit(value);      break;
        case 'decimal':   inputDecimal();         break;
        case 'operator':  inputOperator(value);   break;
        case 'percent':   inputPercent();         break;
        case 'toggle':    toggleSign();           break;
        case 'backspace': deleteLast();           break;
        case 'clear':     clearAll();             break;
        case 'equals':    succeeded = calculate(); break;
    }

    render();
    addRipple(button, event);

    const rect = button.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    if (action === 'equals') {
        if (state.errorMessage) {
            Sound.error();
        } else {
            Sound.equals();
        }
    } else if (action === 'operator') {
        Sound.operator();
    } else if (action === 'clear') {
        Sound.clear();
    } else {
        Sound.key();
    }
    FX.burst(cx, cy, 6, 'spark');
}

keysContainer.addEventListener('click', function (event) {
    const button = event.target.closest('.key');
    if (button) activate(button, event);
});

surgeBtn.addEventListener('click', runSurge);

calculatorEl.addEventListener('animationend', function (event) {
    if (event.target === calculatorEl) calculatorEl.classList.remove('is-shaking');
});

soundToggle.addEventListener('click', function () {
    const on = !Sound.isEnabled();
    Sound.setEnabled(on);
    soundToggle.setAttribute('aria-pressed', String(on));
    soundToggle.textContent = on ? '🔊' : '🔇';
    if (on) Sound.key();
});

// Keyboard: key name -> button
const keyMap = new Map();
keyButtons.forEach(function (button) {
    (button.dataset.keys || '').split('|').forEach(function (keyName) {
        if (keyName) keyMap.set(keyName, button);
    });
});

document.addEventListener('keydown', function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // "S" fires the special button
    if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        runSurge();
        return;
    }

    const button = keyMap.get(event.key);
    if (!button) return;

    event.preventDefault();
    if (event.repeat && button.dataset.action !== 'backspace') return;

    flashKeyboardPress(button);
    activate(button, null);
});


/* =====================================================================
   11. INITIALISATION
   ===================================================================== */
keyButtons.forEach(function (button, index) {
    button.style.setProperty('--i', index);   // staggered entrance
});

FX.start();
render();