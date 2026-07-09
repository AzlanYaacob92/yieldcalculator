/* ============================================================================
   app.js  —  presentation layer  (Chemculate Yields)
   Forked from Stoichiomathics: same landing → picker/custom-builder →
   measurements → strategy → Learn/Check/Verify flow, plus new machinery for
   the reaction's downstream yield:
     Verdict (limiting reactant known) → Outputs selector (tick what to
     find: excess used/left over, and/or any product formed; choose mass /
     concentration / gas volume for each) → the answer, in whichever mode's
     style (Learn keeps stepping through card-learn; Check keeps revealing
     through card-prac; Verify's worksheet — card-verify — is reused as the
     single shared "final results" screen for every mode).
   Depends on chemistry.js (AM, CAT, QUAL, MOLAR_VOL, fmtEq, fmtFormula,
   molarMass, massParts, composition, computeLimiting, computeProductYields,
   computeExcessUsage, amountFromMoles). All chemistry stays in chemistry.js.
   ========================================================================== */

/* ---------------- theme toggle ----------------
   Independent of the main IIFE below — it only flips the data-theme
   attribute the dark-mode CSS variables key off, and remembers the choice.
   (Same mechanism as the Concentration Trainer.) */
(function () {
  const toggleBtn = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-toggle-icon');
  if (!toggleBtn) return;
  const root = document.documentElement;

  function isDark() { return root.getAttribute('data-theme') === 'dark'; }

  function reflect() {
    const dark = isDark();
    toggleBtn.setAttribute('aria-pressed', String(dark));
    toggleBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    if (icon) icon.textContent = dark ? '☀️' : '🌙';
  }

  reflect(); // match whatever the inline head script already applied

  toggleBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { /* private browsing, etc. */ }
    reflect();
  });
})();

(function () {

  /* ---------------- display formatting ---------------- */
  function sig(x, n) { n = n || 4; if (x === 0) return '0'; if (!isFinite(x)) return '—'; return Number(x.toPrecision(n)).toString(); }
  const mm1 = x => x.toFixed(1);
  // stacked fraction — numerator over denominator with a bar, as on paper
  function frac(num, den) {
    return `<span class="frac"><span class="frac-num">${num}</span><span class="frac-den">${den}</span></span>`;
  }

  /* ---------------- reduced motion ---------------- */
  let prefersReducedMotion = false;
  try {
    prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { /* matchMedia unavailable — treat as full motion */ }

  /* ---------------- animation helpers ----------------
     Every pan pairs a real CSS animation with a timed fallback, so
     navigation never gets stuck. Copied from the Concentration Trainer. */
  function onAnimEnd(el, fallbackMs, cb) {
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      el.removeEventListener('animationend', onEnd);
      clearTimeout(timer);
      cb();
    }
    function onEnd(e) { if (e.target === el) finish(); }
    el.addEventListener('animationend', onEnd);
    const timer = setTimeout(finish, fallbackMs);
  }

  function enterCard(el, direction) {
    if (!el) return;
    el.hidden = false;
    if (prefersReducedMotion) return;
    const cls = direction === 'back' ? 'anim-pan-in-left' : 'anim-pan-in-right';
    el.classList.remove('anim-pan-in-left', 'anim-pan-in-right');
    void el.offsetWidth;
    el.classList.add(cls);
    onAnimEnd(el, 700, () => el.classList.remove(cls));
  }

  function exitCard(el, direction, cb) {
    if (!el) { if (cb) cb(); return; }
    if (prefersReducedMotion) { el.hidden = true; if (cb) cb(); return; }
    const cls = direction === 'back' ? 'anim-pan-out-right' : 'anim-pan-out-left';
    el.classList.remove('anim-pan-out-left', 'anim-pan-out-right');
    void el.offsetWidth;
    el.classList.add(cls);
    onAnimEnd(el, 550, () => {
      el.hidden = true;
      el.classList.remove(cls);
      if (cb) cb();
    });
  }

  // The one wizard transition primitive: pan `fromEl` out (if any), run
  // `updateFn`, then pan `toEl` in. fromEl and toEl may be the same element,
  // refreshed in place.
  function panTransition(fromEl, toEl, direction, updateFn) {
    function doEnter() {
      if (updateFn) updateFn();
      enterCard(toEl, direction);
    }
    if (fromEl) exitCard(fromEl, direction, doEnter);
    else doEnter();
  }

  /* ---------------- stacked-equation grid ----------------
     The quantity left of the first '=' appears once; every following
     '='-separated segment gets its own row with the '=' signs stacked in a
     shared column. Each row's cells (lhs / '=' / rhs, or a solo span) are
     wrapped in one `.eq-row` container that participates in the outer grid
     via `grid-template-columns: subgrid` — so the '=' signs still line up
     across rows, but each row is a single element. That single element is
     what the typewriter animates, so a line types as one continuous
     left-to-right sweep instead of the lhs and rhs wiping separately. */
  function splitTopLevelEquals(line) {
    const parts = [];
    let depth = 0, cur = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '<') depth++;
      else if (c === '>') depth = Math.max(0, depth - 1);
      if (c === '=' && depth === 0) { parts.push(cur); cur = ''; }
      else cur += c;
    }
    parts.push(cur);
    return parts.map(s => s.trim());
  }

  function mathGrid(html) {
    const lines = String(html).split(/<br\s*\/?>/i);
    let rows = '';
    let row = 0;
    lines.forEach(line => {
      const segs = splitTopLevelEquals(line);
      if (segs.length === 1) {
        row += 1;
        rows += `<span class="eq-row" style="grid-row:${row}"><span class="eq-seg eq-solo" style="grid-column:1 / -1">${segs[0]}</span></span>`;
        return;
      }
      segs.slice(1).forEach((seg, si) => {
        row += 1;
        const lhs = si === 0 ? `<span class="eq-seg eq-lhs" style="grid-column:1">${segs[0]}</span>` : `<span class="eq-seg eq-lhs" style="grid-column:1"></span>`;
        rows += `<span class="eq-row" style="grid-row:${row}">${lhs}<span class="eq-op" style="grid-column:2">=</span><span class="eq-seg eq-rhs" style="grid-column:3">${seg}</span></span>`;
      });
    });
    return `<span class="eqgrid" style="grid-template-columns:max-content max-content minmax(0, max-content)">${rows}</span>`;
  }

  /* Typewriter reveal for a math grid: each equation row (lhs + '=' + rhs,
     as one element) wipes into view in a single left-to-right pass, one
     line after another. Fraction bars stay intact because the clip-path
     wipe never breaks markup — it just reveals more of the same row. */
  function typewriterMathGrid(el, html) {
    el.innerHTML = mathGrid(html);
    if (prefersReducedMotion) return;
    try {
      const grid = el.querySelector('.eqgrid');
      if (!grid) return;
      const rowsEls = Array.from(grid.querySelectorAll('.eq-row'));
      let delay = 0;
      rowsEls.forEach(rowEl => {
        const len = Math.max(rowEl.textContent.length, 4);
        const steps = Math.max(10, Math.min(60, Math.round(len * 1.4)));
        const duration = steps * 26; // ms — consistent typing speed regardless of line length
        rowEl.classList.add('typewipe');
        rowEl.style.setProperty('--tw-steps', steps);
        rowEl.style.animationDuration = duration + 'ms';
        rowEl.style.animationDelay = delay + 'ms';
        delay += duration + 160;
      });
    } catch (e) { /* content already shown; animation is best-effort */ }
  }

  /* ---------------- periodic table layout (periods 1–6) ---------------- */
  const PT = [
    ["H",1,1,1],["He",2,1,18],
    ["Li",3,2,1],["Be",4,2,2],["B",5,2,13],["C",6,2,14],["N",7,2,15],["O",8,2,16],["F",9,2,17],["Ne",10,2,18],
    ["Na",11,3,1],["Mg",12,3,2],["Al",13,3,13],["Si",14,3,14],["P",15,3,15],["S",16,3,16],["Cl",17,3,17],["Ar",18,3,18],
    ["K",19,4,1],["Ca",20,4,2],["Sc",21,4,3],["Ti",22,4,4],["V",23,4,5],["Cr",24,4,6],["Mn",25,4,7],["Fe",26,4,8],["Co",27,4,9],["Ni",28,4,10],["Cu",29,4,11],["Zn",30,4,12],["Ga",31,4,13],["Ge",32,4,14],["As",33,4,15],["Se",34,4,16],["Br",35,4,17],["Kr",36,4,18],
    ["Rb",37,5,1],["Sr",38,5,2],["Y",39,5,3],["Zr",40,5,4],["Nb",41,5,5],["Mo",42,5,6],["Tc",43,5,7],["Ru",44,5,8],["Rh",45,5,9],["Pd",46,5,10],["Ag",47,5,11],["Cd",48,5,12],["In",49,5,13],["Sn",50,5,14],["Sb",51,5,15],["Te",52,5,16],["I",53,5,17],["Xe",54,5,18],
    ["Cs",55,6,1],["Ba",56,6,2],["La",57,6,3],["Hf",72,6,4],["Ta",73,6,5],["W",74,6,6],["Re",75,6,7],["Os",76,6,8],["Ir",77,6,9],["Pt",78,6,10],["Au",79,6,11],["Hg",80,6,12],["Tl",81,6,13],["Pb",82,6,14],["Bi",83,6,15],["Po",84,6,16],["At",85,6,17],["Rn",86,6,18]
  ];
  const ZBY = {}; PT.forEach(([s, z]) => ZBY[s] = z);
  const ACTIVE = new Set(); QUAL.forEach(q => q.el.forEach(e => ACTIVE.add(e)));

  /* ---------------- state ---------------- */
  function freshInput() { return { method: "mass", mass: "", conc: "", cvol: "", cvolUnit: "cm3", gvol: "", gvolUnit: "dm3", cond: "RTP" }; }
  function freshOutFormat() { return { method: "mass", cvol: "", cvolUnit: "cm3", cond: "RTP" }; }
  const state = {
    mode: null,             // 'learn' | 'test' | 'verify'
    cat: "all", els: new Set(), matchMode: "all",
    sel: null,              // a QUAL index, or the string 'custom'
    inA: freshInput(), inB: freshInput(),
    learn: null,            // { steps, idx, calcShown, phase: 'main' | 'yield' }
    prac: null,             // { steps, idx, revealed, guess, phase: 'main' | 'yield' }
    customCount: 1,         // number of products chosen in the custom builder (1–4)
    customFields: null,     // working {coef, name} rows while the builder is open — session-only, never saved
    customQ: null,          // the built custom reaction, same shape as a QUAL entry
    outputs: null           // [{ kind:'excess'|'product', idx, enabled, fmt }] — what to calculate and how
  };
  const MODE_VERB = { learn: 'Learn', test: 'Check my understanding', verify: 'Verify my answer' };

  // Every place downstream (measure/strategy/learn/practice/verify) reads the
  // active reaction through this, so a custom, session-only reaction can sit
  // alongside the QUAL database without ever being written into it.
  function currentQ() { return state.sel === 'custom' ? state.customQ : QUAL[state.sel]; }

  /* ---------------- cards + navigation ---------------- */
  const cards = {
    landing: document.getElementById('card-landing'),
    picker:  document.getElementById('card-picker'),
    customSetup: document.getElementById('card-custom-setup'),
    customBuild: document.getElementById('card-custom-build'),
    measure: document.getElementById('card-measure'),
    strategy:document.getElementById('card-strategy'),
    learn:   document.getElementById('card-learn'),
    prac:    document.getElementById('card-prac'),
    verify:  document.getElementById('card-verify'),
    verdict: document.getElementById('card-verdict'),
    outputs: document.getElementById('card-outputs')
  };
  const backLink = document.getElementById('back-link');
  let current = 'landing';

  function goTo(key, direction, updateFn) {
    const from = cards[current], to = cards[key];
    current = key;
    backLink.hidden = (key === 'landing');
    panTransition(from === to ? null : from, to, direction || 'forward', updateFn);
    if (to && to.scrollIntoView && key !== 'landing') {
      setTimeout(() => { try { to.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {} }, 60);
    }
  }

  function resetAll() {
    state.mode = null; state.sel = null;
    state.inA = freshInput(); state.inB = freshInput();
    state.learn = null; state.prac = null;
    state.customCount = 1; state.customFields = null; state.customQ = null;
    state.outputs = null;
    renderCatalog();
  }

  backLink.addEventListener('click', () => {
    goTo('landing', 'back', resetAll);
  });

  /* ---------------- landing ---------------- */
  document.querySelectorAll('[data-choose]').forEach(btn => btn.addEventListener('click', () => {
    state.mode = btn.dataset.choose;
    goTo('picker', 'forward');
  }));

  // gentle entrance: lead line pans in, choice cards grow in with a stagger
  function playLandingEntrance() {
    if (prefersReducedMotion) return;
    const lead = document.getElementById('hero-lead');
    if (lead) lead.classList.add('anim-hero-in');
    document.querySelectorAll('.choice-card').forEach((c, i) => {
      c.classList.add('anim-grow-in');
      c.style.animationDelay = (120 + i * 110) + 'ms';
    });
  }

  /* ---------------- picker: periodic table ---------------- */
  const ptable = document.getElementById('ptable');
  PT.forEach(([sym, z, p, g]) => {
    const cell = document.createElement('div');
    const on = ACTIVE.has(sym);
    cell.className = 'cell ' + (on ? 'on' : 'off');
    cell.style.gridColumn = g; cell.style.gridRow = p;
    cell.dataset.sym = sym;
    cell.innerHTML = '<span class="z">' + z + '</span>' + sym;
    if (on) cell.addEventListener('click', () => toggleEl(sym));
    ptable.appendChild(cell);
  });
  const ftag = document.createElement('div');
  ftag.className = 'ftag'; ftag.style.gridRow = 7; ftag.textContent = 'f-block omitted';
  ptable.appendChild(ftag);

  const catsel = document.getElementById('catsel');
  const presentCats = [...new Set(QUAL.map(q => q.cat))];
  catsel.innerHTML = '<option value="all">All reaction types</option>' +
    Object.entries(CAT).filter(([k]) => presentCats.includes(k)).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  function catalogPass(q) {
    if (state.cat !== 'all' && q.cat !== state.cat) return false;
    if (state.els.size) {
      const arr = [...state.els];
      if (state.matchMode === 'all') { if (!arr.every(e => q.el.includes(e))) return false; }
      else { if (!arr.some(e => q.el.includes(e))) return false; }
    }
    return true;
  }

  function renderCatalog() {
    document.querySelectorAll('.cell.on, .cell.sel').forEach(c => {
      const picked = state.els.has(c.dataset.sym);
      c.classList.toggle('sel', picked);
      if (!picked) c.classList.add('on');
    });
    const sc = document.getElementById('selchips');
    sc.innerHTML = [...state.els].sort((a, b) => ZBY[a] - ZBY[b]).map(s =>
      `<button class="selchip" data-rm="${s}" type="button">${s}<span>×</span></button>`).join('');
    sc.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => toggleEl(b.dataset.rm)));

    const filtering = state.els.size > 0;
    const list = document.getElementById('list');
    const count = document.getElementById('count');

    const notListedCard = `<div class="rx rx--custom" id="rx-not-listed">
      <div class="idx">+</div>
      <div class="rxbody">
        <div class="eq">My reaction is not listed</div>
        <div class="meta"><span class="cond">Build your own equation and use the same working</span></div>
      </div>
      <div class="pick">Build →</div>
    </div>`;
    function wireNotListed() {
      const el = document.getElementById('rx-not-listed');
      if (el) el.addEventListener('click', goToCustomSetup);
    }

    if (!filtering) {
      count.innerHTML = '';
      list.innerHTML = '<div class="empty">Tap one or more <b>lit elements</b> in the table above to surface a matching reaction — then pick it to continue.<br><span class="empty-faint">Dim elements don\u2019t appear in any two-reactant reaction.</span></div>' + notListedCard;
      wireNotListed();
      return;
    }

    const out = QUAL.filter(catalogPass);
    count.innerHTML = out.length ? `<b>${out.length}</b> matching reaction${out.length > 1 ? 's' : ''}` : '';
    if (!out.length) {
      list.innerHTML = '<div class="empty">No two-reactant reaction contains ' +
        (state.matchMode === 'all' && state.els.size > 1 ? '<b>all</b> of those elements together' : 'that combination') +
        '.<br>Try <b>Match any</b>, remove an element, or clear the filters.</div>' + notListedCard;
      wireNotListed();
      return;
    }
    list.innerHTML = out.map(q => {
      const c = CAT[q.cat];
      return `<div class="rx" data-id="${q.id}">
        <div class="idx">${q.id + 1}</div>
        <div class="rxbody">
          <div class="eq">${fmtEq(q.eq)}</div>
          <div class="meta">
            <span class="tag" style="background:${c.color}22;color:${c.color};border:1px solid ${c.color}55">${c.label}</span>
            ${q.cond ? `<span class="cond">${q.cond}</span>` : ''}
            ${q.hadSpect ? `<span class="cond cond--warn">H⁺/OH⁻ omitted</span>` : ''}
          </div>
        </div>
        <div class="pick">Use →</div>
      </div>`;
    }).join('') + notListedCard;
    list.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => selectReaction(+el.dataset.id)));
    wireNotListed();
  }

  function toggleEl(sym) {
    if (state.els.has(sym)) state.els.delete(sym); else state.els.add(sym);
    renderCatalog();
  }

  document.querySelectorAll('#matchmode button').forEach(b => b.addEventListener('click', () => {
    state.matchMode = b.dataset.match;
    document.querySelectorAll('#matchmode button').forEach(x => x.classList.toggle('active', x === b));
    renderCatalog();
  }));
  catsel.addEventListener('change', e => { state.cat = e.target.value; renderCatalog(); });
  document.getElementById('clear').addEventListener('click', () => {
    state.cat = 'all'; state.els.clear(); state.matchMode = 'all';
    catsel.value = 'all';
    document.querySelectorAll('#matchmode button').forEach(x => x.classList.toggle('active', x.dataset.match === 'all'));
    renderCatalog();
  });

  /* Selecting a reaction pans the whole periodic-table card away and brings
     the measurements card in — the table never clutters the working view. */
  function selectReaction(id) {
    state.sel = id;
    state.inA = freshInput(); state.inB = freshInput();
    state.learn = null; state.prac = null; state.outputs = null;
    goTo('measure', 'forward', renderMeasure);
  }

  /* ================= custom reaction builder =================
     Reactants stay fixed at two, matching the two-reactant limiting-reactant
     engine used everywhere else. Product count (1–4) is free, since products
     never feed the maths — they are typeset only. Nothing here is persisted:
     the built reaction lives in state.customQ for this session only. */
  const PROD_LETTERS = ['c', 'd', 'e', 'f'];
  const FORMULA_RE = /^[A-Za-z(][A-Za-z0-9()[\]^+-]*$/;

  function goToCustomSetup() {
    goTo('customSetup', 'forward', renderCustomSetup);
  }

  const prodcountEl = document.getElementById('prodcount');
  function renderCustomSetup() {
    prodcountEl.innerHTML = [1, 2, 3, 4].map(n =>
      `<button data-n="${n}" class="${n === state.customCount ? 'active' : ''}" type="button">${n}</button>`).join('');
    prodcountEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.customCount = +b.dataset.n;
      prodcountEl.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    }));
  }
  document.getElementById('custom-setup-back').addEventListener('click', () => goTo('picker', 'back'));
  document.getElementById('custom-setup-continue').addEventListener('click', () => {
    // (Re)build the field list to match the chosen product count, keeping
    // any names/coefficients already typed for slots that still exist.
    const prevFields = state.customFields;
    const reactants = [0, 1].map(i => (prevFields && prevFields.reactants[i]) || { coef: '1', name: '' });
    const products = Array.from({ length: state.customCount }, (_, i) =>
      (prevFields && prevFields.products[i]) || { coef: '1', name: '' });
    state.customFields = { reactants, products };
    goTo('customBuild', 'forward', renderCustomBuild);
  });

  function customEqPreview() {
    const { reactants, products } = state.customFields;
    const side = arr => arr.map(f => {
      const n = f.coef !== '' ? Number(f.coef) : NaN;
      return (isFinite(n) && n > 1 ? n : '') + (f.name || '…');
    }).join(' + ');
    return side(reactants) + ' -> ' + side(products);
  }

  function customFieldCard(label, letter, side, idx, field) {
    return `<div class="customfield">
      <div class="cf-label">${label}</div>
      <div class="coefrow">
        <input class="num-input coef-input" type="number" min="1" step="1" value="${field.coef}"
          data-side="${side}" data-idx="${idx}" data-role="coef" aria-label="${letter} coefficient">
        <input class="num-input name-input" type="text" value="${field.name}" placeholder="e.g. H2SO4"
          data-side="${side}" data-idx="${idx}" data-role="name" aria-label="${letter} formula" autocomplete="off" spellcheck="false">
      </div>
      <div class="formula-preview" data-side="${side}" data-idx="${idx}">${field.name ? fmtFormula(field.name) : ''}</div>
    </div>`;
  }

  function renderCustomBuild() {
    const { reactants, products } = state.customFields;
    document.getElementById('customReactants').innerHTML =
      customFieldCard('Reactant A', 'a', 'reactant', 0, reactants[0]) +
      customFieldCard('Reactant B', 'b', 'reactant', 1, reactants[1]);
    document.getElementById('customProducts').innerHTML =
      products.map((f, i) => customFieldCard(`Product ${PROD_LETTERS[i].toUpperCase()}`, PROD_LETTERS[i], 'product', i, f)).join('');
    document.getElementById('custom-error').hidden = true;
    updateCustomPreview();
    wireCustomBuild();
  }

  function updateCustomPreview() {
    document.getElementById('customPreview').innerHTML = fmtEq(customEqPreview());
  }

  function wireCustomBuild() {
    document.querySelectorAll('#customReactants input, #customProducts input').forEach(inp => {
      inp.addEventListener('input', e => {
        const { side, idx, role } = e.target.dataset;
        const arr = side === 'reactant' ? state.customFields.reactants : state.customFields.products;
        arr[+idx][role] = e.target.value;
        if (role === 'name') {
          const preview = document.querySelector(`.formula-preview[data-side="${side}"][data-idx="${idx}"]`);
          if (preview) preview.innerHTML = e.target.value ? fmtFormula(e.target.value) : '';
        }
        updateCustomPreview();
      });
    });
  }

  document.getElementById('custom-build-back').addEventListener('click', () => goTo('customSetup', 'back'));

  // Validate one field: a positive-integer coefficient and a formula whose
  // elements are all recognised. mustHaveMass gates the molar-mass check,
  // since only reactants ever need one (products are typeset only).
  function validateField(f, label, mustHaveMass) {
    const name = (f.name || '').trim();
    if (!name) return `Enter a formula for ${label}.`;
    if (!FORMULA_RE.test(name)) return `${label}'s formula (\u201c${name}\u201d) has a character that doesn't belong in a chemical formula.`;
    const comp = composition(name);
    if (!Object.keys(comp).length) return `${label}'s formula (\u201c${name}\u201d) doesn't look like a valid formula.`;
    if (mustHaveMass && molarMass(name) == null) {
      const bad = Object.keys(comp).find(el => !(el in AM));
      return `${label}'s formula (\u201c${name}\u201d) contains an element symbol${bad ? ` (\u201c${bad}\u201d)` : ''} that isn't recognised — check the spelling and capitalisation.`;
    }
    const coefN = Number(f.coef);
    if (!(Number.isInteger(coefN) && coefN >= 1)) return `${label}'s ratio number must be a whole number of 1 or more.`;
    return null;
  }

  document.getElementById('custom-build-continue').addEventListener('click', () => {
    const { reactants, products } = state.customFields;
    const err = document.getElementById('custom-error');
    const labels = { reactant: ['Reactant A', 'Reactant B'], product: products.map((_, i) => `Product ${PROD_LETTERS[i].toUpperCase()}`) };
    let msg = null;
    reactants.forEach((f, i) => { msg = msg || validateField(f, labels.reactant[i], true); });
    products.forEach((f, i) => { msg = msg || validateField(f, labels.product[i], false); });
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    err.hidden = true;

    const A = { coef: Number(reactants[0].coef), sp: reactants[0].name.trim() };
    const B = { coef: Number(reactants[1].coef), sp: reactants[1].name.trim() };
    const productsArr = products.map(f => ({ coef: Number(f.coef), sp: f.name.trim() }));
    const prodTokens = productsArr.map(p => `${p.coef > 1 ? p.coef : ''}${p.sp}`);
    const eq = `${A.coef > 1 ? A.coef : ''}${A.sp} + ${B.coef > 1 ? B.coef : ''}${B.sp} -> ${prodTokens.join(' + ')}`;
    const elset = new Set();
    [A.sp, B.sp, ...productsArr.map(p => p.sp)].forEach(sp => { const c = composition(sp); for (const k in c) elset.add(k); });

    const customQ = { eq, cat: 'custom', el: [...elset], cond: '', equil: false, A, B, products: productsArr, hadSpect: false, custom: true };
    selectCustomReaction(customQ);
  });

  function selectCustomReaction(q) {
    state.sel = 'custom';
    state.customQ = q;
    state.inA = freshInput(); state.inB = freshInput();
    state.learn = null; state.prac = null; state.outputs = null;
    goTo('measure', 'forward', renderMeasure);
  }

  /* ---------------- measurements ---------------- */
  const VOL_LABEL = { cm3: 'cm³ (mL)', dm3: 'dm³ (L)' };

  function methodSelect(side, inp) {
    const opts = [['mass', 'Mass (g)'], ['conc', 'Concentration × volume'], ['gas', 'Gas volume']];
    return `<select class="msel select" data-side="${side}" data-role="method" aria-label="measurement method">` +
      opts.map(([v, l]) => `<option value="${v}" ${inp.method === v ? 'selected' : ''}>${l}</option>`).join('') + `</select>`;
  }
  function volUnitSelect(side, role, val, firstUnit) {
    const order = firstUnit === 'dm3' ? ['dm3', 'cm3'] : ['cm3', 'dm3'];
    return `<select class="uSel select" data-side="${side}" data-role="${role}">` +
      order.map(u => `<option value="${u}" ${val === u ? 'selected' : ''}>${VOL_LABEL[u]}</option>`).join('') + `</select>`;
  }
  function fieldsFor(side, inp, sp) {
    if (inp.method === 'mass') {
      const M = molarMass(sp);
      return `<div class="hint">moles = mass ÷ M &nbsp;·&nbsp; M = ${mm1(M)} g mol⁻¹</div>
        <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="mass" value="${inp.mass}" data-side="${side}" data-role="mass"><span class="unit">g</span></div>`;
    }
    if (inp.method === 'conc') {
      return `<div class="hint">moles = concentration × volume</div>
        <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="concentration" value="${inp.conc}" data-side="${side}" data-role="conc"><span class="unit">mol dm⁻³</span></div>
        <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="volume" value="${inp.cvol}" data-side="${side}" data-role="cvol">
          ${volUnitSelect(side, 'cvolUnit', inp.cvolUnit, 'cm3')}</div>`;
    }
    return `<div class="hint">moles = gas volume ÷ molar volume</div>
      <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="gas volume" value="${inp.gvol}" data-side="${side}" data-role="gvol">
        ${volUnitSelect(side, 'gvolUnit', inp.gvolUnit, 'dm3')}</div>
      <div class="massrow"><select class="uSel select wide" data-side="${side}" data-role="cond"><option value="RTP" ${inp.cond === 'RTP' ? 'selected' : ''}>RTP · 24.0 dm³ mol⁻¹</option><option value="STP" ${inp.cond === 'STP' ? 'selected' : ''}>STP · 22.4 dm³ mol⁻¹</option></select></div>`;
  }

  function renderMeasure() {
    const q = currentQ();
    document.getElementById('measureEq').innerHTML = fmtEq(q.eq);
    document.getElementById('measureNote').innerHTML = q.hadSpect
      ? `<div class="note"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
          <span>H⁺ (or OH⁻) is supplied in excess and is <b>not</b> compared here — the limiting reactant is decided between <b>${fmtFormula(q.A.sp)}</b> and <b>${fmtFormula(q.B.sp)}</b> only.</span></div>`
      : '';
    document.getElementById('measure-error').hidden = true;
    renderInputs();
  }

  function renderInputs() {
    const q = currentQ();
    const cardsHtml = [['a', state.inA, q.A], ['b', state.inB, q.B]].map(([side, inp, x]) =>
      `<div class="massfield">
        <div class="who">${fmtFormula(x.sp)}${x.coef > 1 ? ` <span class="cf">coeff ${x.coef}</span>` : ''}</div>
        <div class="methodrow">${methodSelect(side, inp)}</div>
        ${fieldsFor(side, inp, x.sp)}
      </div>`).join('');
    document.getElementById('inputs').innerHTML = cardsHtml;
    wireInputs();
  }
  function inpFor(side) { return side === 'a' ? state.inA : state.inB; }
  function wireInputs() {
    document.querySelectorAll('#inputs [data-role="method"]').forEach(sel => sel.addEventListener('change', e => {
      inpFor(e.target.dataset.side).method = e.target.value; renderInputs();
    }));
    document.querySelectorAll('#inputs input[data-role]').forEach(inp => inp.addEventListener('input', e => {
      inpFor(e.target.dataset.side)[e.target.dataset.role] = e.target.value;
    }));
    document.querySelectorAll('#inputs select.uSel').forEach(sel => sel.addEventListener('change', e => {
      inpFor(e.target.dataset.side)[e.target.dataset.role] = e.target.value;
    }));
  }

  /* amount → moles */
  function molesOf(inp, sp) {
    if (inp.method === 'mass') { const m = parseFloat(inp.mass), M = molarMass(sp); return (m > 0) ? m / M : NaN; }
    if (inp.method === 'conc') { const c = parseFloat(inp.conc); let V = parseFloat(inp.cvol); if (!(c > 0) || !(V > 0)) return NaN; if (inp.cvolUnit === 'cm3') V /= 1000; return c * V; }
    if (inp.method === 'gas') { let V = parseFloat(inp.gvol); if (!(V > 0)) return NaN; if (inp.gvolUnit === 'cm3') V /= 1000; return V / MOLAR_VOL[inp.cond]; }
    return NaN;
  }

  document.getElementById('measure-back').addEventListener('click', () => {
    goTo(state.sel === 'custom' ? 'customBuild' : 'picker', 'back', state.sel === 'custom' ? renderCustomBuild : undefined);
  });

  document.getElementById('measure-continue').addEventListener('click', () => {
    const q = currentQ();
    const nA = molesOf(state.inA, q.A.sp), nB = molesOf(state.inB, q.B.sp);
    const err = document.getElementById('measure-error');
    if (!(isFinite(nA) && nA > 0 && isFinite(nB) && nB > 0)) {
      err.textContent = 'Enter a positive amount for both reactants — choose Mass, Concentration × volume, or Gas volume for each.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    goTo('strategy', 'forward', renderStrategy);
  });

  /* ---------------- strategy card (all branches) ---------------- */
  function renderStrategy() {
    const q = currentQ();
    const A = q.A, B = q.B;
    const instruction = document.getElementById('strategy-instruction');
    const text = document.getElementById('strategy-text');
    const foot = document.getElementById('strategy-footnote');
    const btn = document.getElementById('strategy-continue');

    instruction.textContent = 'Compare moles, not grams.';
    text.innerHTML = `Decide which of <b>${fmtFormula(A.sp)}</b> and <b>${fmtFormula(B.sp)}</b> runs out first. ` +
      `Convert each amount to <b>moles</b>, then use the equation's <b>${A.coef} : ${B.coef}</b> ratio to ask: ` +
      `is there enough ${fmtFormula(B.sp)} to use up all the ${fmtFormula(A.sp)}? ` +
      `Whichever reactant falls short is the <b>limiting reactant</b> — it controls how much product forms.`;
    if (q.hadSpect) {
      foot.textContent = 'H⁺ / OH⁻ is supplied in excess and is left out of the comparison.';
      foot.hidden = false;
    } else { foot.hidden = true; }

    btn.textContent = state.mode === 'learn' ? 'Start the working →'
                    : state.mode === 'test' ? 'Start practising →'
                    : 'Choose what to calculate →';
  }

  document.getElementById('strategy-back').addEventListener('click', () => {
    goTo('measure', 'back');
  });

  document.getElementById('strategy-continue').addEventListener('click', () => {
    if (state.mode === 'learn') {
      state.learn = { steps: buildLearnSteps(), idx: 0, calcShown: false, phase: 'main' };
      goTo('learn', 'forward', renderLearnStep);
    } else if (state.mode === 'test') {
      state.prac = { steps: buildPracSteps(), idx: 0, revealed: false, guess: null, phase: 'main' };
      goTo('prac', 'forward', renderPracStep);
    } else {
      goTo('outputs', 'forward', () => renderOutputs('Choose what to calculate, then see every answer at once.'));
    }
  });

  /* ---------------- shared computation for the working ---------------- */
  function computed() {
    const q = currentQ();
    const nA = molesOf(state.inA, q.A.sp), nB = molesOf(state.inB, q.B.sp);
    return { q, res: computeLimiting(q, nA, nB) };
  }

  /* line(s) converting one reactant's amount to moles —
     formula first, then the substitution, then the result, all in one
     stacked grid (notation follows the Concentration Trainer). */
  function moleMath(inp, sp, n) {
    const f = fmtFormula(sp);
    if (inp.method === 'mass') {
      const m = parseFloat(inp.mass), M = molarMass(sp);
      return `n(${f}) = ${frac('m', 'M')} = ${frac(sig(m) + ' g', mm1(M) + ' g mol⁻¹')} = ${sig(n)} mol`;
    }
    if (inp.method === 'conc') {
      const c = parseFloat(inp.conc); const Vr = parseFloat(inp.cvol);
      const V = inp.cvolUnit === 'cm3' ? Vr / 1000 : Vr;
      const conv = inp.cvolUnit === 'cm3' ? `V = ${sig(Vr)} cm³ = ${sig(V)} dm³<br>` : '';
      return `${conv}n(${f}) = c × V = ${sig(c)} × ${sig(V)} = ${sig(n)} mol`;
    }
    const Vr = parseFloat(inp.gvol);
    const V = inp.gvolUnit === 'cm3' ? Vr / 1000 : Vr;
    const Vm = MOLAR_VOL[inp.cond];
    const conv = inp.gvolUnit === 'cm3' ? `V = ${sig(Vr)} cm³ = ${sig(V)} dm³<br>` : '';
    return `${conv}n(${f}) = ${frac('V', 'V<sub>m</sub>')} = ${frac(sig(V) + ' dm³', Vm.toFixed(1) + ' dm³ mol⁻¹')} = ${sig(n)} mol`;
  }

  function moleStrategy(inp, sp) {
    const f = fmtFormula(sp);
    if (inp.method === 'mass') return `The amount of ${f} is given as a mass, so divide by its molar mass: n = m ÷ M.`;
    if (inp.method === 'conc') return `The amount of ${f} is given as a solution, so multiply concentration by volume (in dm³): n = c × V.`;
    return `The amount of ${f} is a gas volume, so divide by the molar gas volume: n = V ÷ V<sub>m</sub>.`;
  }
  function moleFootnote(inp) {
    if (inp.method === 'conc' && inp.cvolUnit === 'cm3') return 'The volume was entered in cm³ (mL) — convert to dm³ (L) by dividing by 1000 before multiplying.';
    if (inp.method === 'gas') {
      const base = inp.cond === 'RTP' ? 'RTP: 24.0 dm³ mol⁻¹ (room temperature and pressure)' : 'STP: 22.4 dm³ mol⁻¹ (standard temperature and pressure)';
      return (inp.gvolUnit === 'cm3' ? 'The gas volume was entered in cm³ (mL) — convert to dm³ (L) by dividing by 1000. ' : '') + 'Molar volume at ' + base + '.';
    }
    return null;
  }

  /* molar-mass working for one species — one term per element */
  function mmMath(sp) {
    const parts = massParts(sp), M = molarMass(sp);
    const formula = parts.map(p => (p.n > 1 ? p.n + 'A<sub>r</sub>(' + p.el + ')' : 'A<sub>r</sub>(' + p.el + ')')).join(' + ');
    const subst = parts.map(p => (p.n > 1 ? p.n + ' × ' + mm1(p.a) : mm1(p.a))).join(' + ');
    return `M(${fmtFormula(sp)}) = ${formula} = ${subst} = ${mm1(M)} g mol⁻¹`;
  }

  /* ---------------- LEARN: build the step list ---------------- */
  function buildLearnSteps() {
    const { q, res } = computed();
    const A = q.A, B = q.B, a = A.coef, b = B.coef;
    const steps = [];

    // molar masses — only for reactants entered by mass
    const massSides = [[A, state.inA], [B, state.inB]].filter(([x, inp]) => inp.method === 'mass');
    massSides.forEach(([x]) => {
      steps.push({
        instruction: `Work out the molar mass of ${fmtFormula(x.sp)}.`,
        strategy: 'Add up the relative atomic masses of every atom in the formula — multiply by the subscript where an element appears more than once.',
        math: mmMath(x.sp)
      });
    });

    // moles of each reactant
    [[A, state.inA, res.nA], [B, state.inB, res.nB]].forEach(([x, inp, n]) => {
      steps.push({
        instruction: `Convert the amount of ${fmtFormula(x.sp)} to moles.`,
        strategy: moleStrategy(inp, x.sp),
        footnote: moleFootnote(inp),
        math: moleMath(inp, x.sp, n)
      });
    });

    // mole ratio
    steps.push({
      instruction: 'Read off the mole ratio.',
      strategy: `From the balanced equation, ${fmtFormula(A.sp)} and ${fmtFormula(B.sp)} react in the ratio ${a} : ${b} — every ${a} mol of ${fmtFormula(A.sp)} needs ${b} mol of ${fmtFormula(B.sp)}.`,
      math: `${fmtFormula(A.sp)} : ${fmtFormula(B.sp)} = ${a} : ${b}`
    });

    // compare needed vs available
    const cmpWord = res.tie ? 'exactly equal to' : (res.enough ? 'no more than' : 'more than');
    steps.push({
      instruction: 'Compare: how much is needed vs available.',
      strategy: `Work out how much ${fmtFormula(B.sp)} would be needed to use up all ${sig(res.nA)} mol of ${fmtFormula(A.sp)}, then compare it with the ${sig(res.nB)} mol you actually have. Here, the amount needed is ${cmpWord} the amount available.`,
      math: `n(${fmtFormula(B.sp)}) needed = n(${fmtFormula(A.sp)}) × ${frac(String(b), String(a))} = ${sig(res.nA)} × ${frac(String(b), String(a))} = ${sig(res.nBneed)} mol<br>n(${fmtFormula(B.sp)}) available = ${sig(res.nB)} mol`
    });

    return steps;
  }

  const learnEyebrow = document.getElementById('learn-eyebrow');
  const learnInstruction = document.getElementById('learn-instruction');
  const learnStrategy = document.getElementById('learn-strategy');
  const learnFootnote = document.getElementById('learn-footnote');
  const learnMath = document.getElementById('learn-math');
  const learnNext = document.getElementById('learn-next');

  function renderLearnStep() {
    const { steps, idx } = state.learn;
    const s = steps[idx];
    learnEyebrow.textContent = `Step ${idx + 1} of ${steps.length}`;
    learnInstruction.innerHTML = s.instruction;
    learnStrategy.innerHTML = s.strategy;
    if (s.footnote) { learnFootnote.innerHTML = s.footnote; learnFootnote.hidden = false; }
    else { learnFootnote.hidden = true; }
    learnMath.innerHTML = '';
    learnNext.textContent = 'Show the calculation';
    state.learn.calcShown = false;
  }

  learnNext.addEventListener('click', () => {
    if (!state.learn) return;
    const { steps, idx, calcShown, phase } = state.learn;
    if (!calcShown) {
      typewriterMathGrid(learnMath, steps[idx].math);
      state.learn.calcShown = true;
      const isLast = idx === steps.length - 1;
      learnNext.textContent = isLast ? (phase === 'yield' ? 'See all my results' : 'Reveal the conclusion') : 'Next step →';
      return;
    }
    if (idx + 1 < steps.length) {
      panTransition(cards.learn, cards.learn, 'forward', () => {
        state.learn.idx = idx + 1;
        renderLearnStep();
      });
    } else if (phase === 'yield') {
      goTo('verify', 'forward', renderVerify);
    } else {
      goTo('verdict', 'forward', renderVerdict);
    }
  });

  /* ---------------- PRACTISE: one card at a time, gated ---------------- */
  function buildPracSteps() {
    const { q, res } = computed();
    const A = q.A, B = q.B, a = A.coef, b = B.coef;
    const fA = fmtFormula(A.sp), fB = fmtFormula(B.sp);

    return [
      {
        instruction: 'Here are the moles — the rest is yours.',
        strategy: 'Both amounts have been converted to moles for you. From here on, predict each result before you reveal it.',
        kind: 'given',
        body: `<div class="ans-lines">${mathGrid(`n(${fA}) = ${sig(res.nA)} mol<br>n(${fB}) = ${sig(res.nB)} mol`)}</div>`
      },
      {
        instruction: 'Read off the mole ratio.',
        strategy: `What is the ${fA} : ${fB} ratio in the balanced equation? Say it out loud, then reveal.`,
        kind: 'reveal',
        revealLabel: 'Ratio from the balanced equation — try it first',
        body: `<div class="ans-lines">${mathGrid(`${fA} : ${fB} = ${a} : ${b}`)}</div>`
      },
      {
        instruction: 'Compare: needed vs available.',
        strategy: `How much ${fB} would be needed to react with all ${sig(res.nA)} mol of ${fA}? Work it out on paper — n(${fA}) × ${b}⁄${a} — then reveal.`,
        kind: 'reveal',
        revealLabel: 'Needed amount vs available amount',
        body: `<div class="ans-lines">${mathGrid(`n(${fB}) needed = ${sig(res.nA)} × ${frac(String(b), String(a))} = ${sig(res.nBneed)} mol<br>n(${fB}) available = ${sig(res.nB)} mol`)}</div>`
      },
      {
        instruction: 'Which reactant is limiting?',
        strategy: res.tie
          ? 'Compare the needed amount with the available amount. Careful — this one may surprise you.'
          : 'Make a prediction first — then the answer reveals itself.',
        kind: 'guess'
      }
    ];
  }

  const pracEyebrow = document.getElementById('prac-eyebrow');
  const pracInstruction = document.getElementById('prac-instruction');
  const pracStrategy = document.getElementById('prac-strategy');
  const pracBody = document.getElementById('prac-body');
  const pracNext = document.getElementById('prac-next');

  function renderPracStep() {
    const { steps, idx } = state.prac;
    const s = steps[idx];
    pracEyebrow.textContent = `Step ${idx + 1} of ${steps.length}`;
    pracInstruction.innerHTML = s.instruction;
    pracStrategy.innerHTML = s.strategy;
    state.prac.revealed = false;
    state.prac.guess = null;

    if (s.kind === 'given') {
      pracBody.innerHTML = s.body;
      pracNext.hidden = false;
      pracNext.textContent = 'Next step →';
    } else if (s.kind === 'reveal') {
      pracBody.innerHTML =
        `<div class="reveal" data-reveal="1" role="button" tabindex="0">
          <span class="rl">${s.revealLabel}</span>
          <span class="rk">Reveal ▾</span>
        </div>`;
      pracNext.hidden = true;
      wirePracBody();
    } else { // guess
      const { q, res } = computed();
      pracBody.innerHTML =
        `<div class="gprompt">Make a prediction:</div>
         <div class="guess">
           ${[q.A, q.B].map(x => `<button class="gbtn" data-guess="${x.sp}" type="button">${fmtFormula(x.sp)}</button>`).join('')}
           ${res.tie ? '<button class="gbtn" data-guess="__tie__" type="button">Neither — exact</button>' : ''}
         </div>
         <div class="reveal" data-reveal="1" role="button" tabindex="0">
           <span class="rl">…or just reveal the answer</span>
           <span class="rk">Reveal ▾</span>
         </div>`;
      pracNext.hidden = true;
      wirePracBody();
    }
  }

  function wirePracBody() {
    pracBody.querySelectorAll('[data-reveal]').forEach(el => el.addEventListener('click', pracReveal));
    pracBody.querySelectorAll('[data-guess]').forEach(el => el.addEventListener('click', () => {
      state.prac.guess = el.dataset.guess;
      pracReveal();
    }));
  }

  function pracReveal() {
    const { steps, idx } = state.prac;
    const s = steps[idx];
    if (state.prac.revealed) return;
    state.prac.revealed = true;

    if (s.kind === 'reveal') {
      pracBody.innerHTML = s.body;
      pracNext.hidden = false;
      const isLast = idx === steps.length - 1;
      pracNext.textContent = isLast ? (state.prac.phase === 'yield' ? 'See all my results →' : 'Next step →') : 'Next step →';
      return;
    }

    // guess step → verdict feedback inline, then hand off to the verdict card
    const { q, res } = computed();
    const correctSp = res.tie ? '__tie__' : res.limiting.sp;
    const guessed = state.prac.guess;
    let feedback = '';
    if (guessed) {
      const correct = guessed === correctSp;
      feedback = `<div class="guess">` +
        [q.A, q.B].map(x => {
          const cls = x.sp === guessed ? (x.sp === correctSp ? 'ok' : 'no') : (x.sp === correctSp ? 'ok' : '');
          return `<button class="gbtn ${cls}" disabled type="button">${fmtFormula(x.sp)}</button>`;
        }).join('') +
        (res.tie ? `<button class="gbtn ${guessed === '__tie__' ? 'ok' : 'ok'}" disabled type="button">Neither — exact</button>` : '') +
        `</div><div class="gverdict ${guessed === correctSp ? 'gv-ok' : 'gv-no'}">${guessed === correctSp ? 'Correct ✓' : 'Not quite — see the conclusion'}</div>`;
    } else {
      feedback = `<div class="gverdict">Answer revealed — see the conclusion.</div>`;
    }
    pracBody.innerHTML = feedback;
    pracNext.hidden = false;
    pracNext.textContent = 'See the conclusion →';
  }

  pracNext.addEventListener('click', () => {
    if (!state.prac) return;
    const { steps, idx, phase } = state.prac;
    if (idx + 1 < steps.length) {
      panTransition(cards.prac, cards.prac, 'forward', () => {
        state.prac.idx = idx + 1;
        renderPracStep();
      });
    } else if (phase === 'yield') {
      goTo('verify', 'forward', renderVerify);
    } else {
      goTo('verdict', 'forward', renderVerdict);
    }
  });

  /* ================= outputs selector (Chemculate Yields) =================
     Reached either straight from Strategy (Verify mode — nothing's been
     revealed yet) or from the Verdict card's "Calculate the yield" button
     (Learn/Check — the limiting reactant is already known). Builds one row
     per thing the student could ask for: the excess reactant's used/left-over
     amount (skipped entirely for an exact, tie reaction — there's nothing
     left over to report), and one row per product in the equation. Nothing
     here is persisted — like the custom builder, it's rebuilt fresh every
     time this card is entered. */
  function rowId(row) { return row.kind + (row.idx == null ? '' : row.idx); }
  function findRow(id) { return state.outputs.find(r => rowId(r) === id); }

  function initOutputs(q, res) {
    const rows = [];
    if (computeExcessUsage(res)) rows.push({ kind: 'excess', idx: null, enabled: false, fmt: freshOutFormat() });
    (q.products || []).forEach((p, i) => rows.push({ kind: 'product', idx: i, enabled: false, fmt: freshOutFormat() }));
    state.outputs = rows;
  }

  function renderOutputs(subtext) {
    const { q, res } = computed();
    initOutputs(q, res);
    const sub = document.querySelector('#card-outputs .prompt-subtext');
    if (sub && subtext) sub.textContent = subtext;
    document.getElementById('outputs-error').hidden = true;
    paintOutputsList();
  }

  function outputConfigHtml(id, fmt) {
    const opts = [['mass', 'Mass (g)'], ['conc', 'Concentration (needs a volume)'], ['gas', 'Gas volume (RTP or STP)']];
    const methodSel = `<select class="select" data-rowid="${id}" data-role="out-method" aria-label="how to express the answer">` +
      opts.map(([v, l]) => `<option value="${v}" ${fmt.method === v ? 'selected' : ''}>${l}</option>`).join('') + `</select>`;
    let extra = '';
    if (fmt.method === 'conc') {
      extra = `<div class="output-extra">
        <input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="volume" value="${fmt.cvol}" data-rowid="${id}" data-role="out-cvol">
        <select class="select uSel" data-rowid="${id}" data-role="out-cvolUnit">
          <option value="cm3" ${fmt.cvolUnit === 'cm3' ? 'selected' : ''}>cm³ (mL)</option>
          <option value="dm3" ${fmt.cvolUnit === 'dm3' ? 'selected' : ''}>dm³ (L)</option>
        </select>
      </div>`;
    } else if (fmt.method === 'gas') {
      extra = `<select class="select" data-rowid="${id}" data-role="out-cond" aria-label="gas condition">
        <option value="RTP" ${fmt.cond === 'RTP' ? 'selected' : ''}>RTP · 24.0 dm³ mol⁻¹</option>
        <option value="STP" ${fmt.cond === 'STP' ? 'selected' : ''}>STP · 22.4 dm³ mol⁻¹</option>
      </select>`;
    }
    return `<div class="output-config">${methodSel}${extra}</div>`;
  }

  function paintOutputsList() {
    const { q, res } = computed();
    const list = document.getElementById('outputs-list');
    list.innerHTML = state.outputs.map(row => {
      const id = rowId(row);
      let title, sub;
      if (row.kind === 'excess') {
        const exc = computeExcessUsage(res);
        title = fmtFormula(exc.sp);
        sub = "The reactant with extra — find how much reacts, and how much is left over.";
      } else {
        const p = q.products[row.idx];
        title = fmtFormula(p.sp);
        sub = 'Find how much of this product the reaction can make.';
      }
      return `<div class="output-row ${row.enabled ? 'checked' : ''}">
        <label class="output-check">
          <input type="checkbox" data-rowid="${id}" ${row.enabled ? 'checked' : ''}>
          <span class="output-text"><span class="output-title">${title}</span><span class="output-sub">${sub}</span></span>
        </label>
        ${row.enabled ? outputConfigHtml(id, row.fmt) : ''}
      </div>`;
    }).join('');
    wireOutputsList();
  }

  function wireOutputsList() {
    document.querySelectorAll('#outputs-list input[type="checkbox"]').forEach(cb => cb.addEventListener('change', e => {
      findRow(e.target.dataset.rowid).enabled = e.target.checked;
      paintOutputsList();
    }));
    document.querySelectorAll('#outputs-list [data-role="out-method"]').forEach(sel => sel.addEventListener('change', e => {
      findRow(e.target.dataset.rowid).fmt.method = e.target.value;
      paintOutputsList();
    }));
    document.querySelectorAll('#outputs-list [data-role="out-cvol"]').forEach(inp => inp.addEventListener('input', e => {
      findRow(e.target.dataset.rowid).fmt.cvol = e.target.value;
    }));
    document.querySelectorAll('#outputs-list [data-role="out-cvolUnit"]').forEach(sel => sel.addEventListener('change', e => {
      findRow(e.target.dataset.rowid).fmt.cvolUnit = e.target.value;
    }));
    document.querySelectorAll('#outputs-list [data-role="out-cond"]').forEach(sel => sel.addEventListener('change', e => {
      findRow(e.target.dataset.rowid).fmt.cond = e.target.value;
    }));
  }

  document.getElementById('outputs-back').addEventListener('click', () => {
    goTo(state.mode === 'verify' ? 'strategy' : 'verdict', 'back', state.mode === 'verify' ? renderStrategy : renderVerdict);
  });

  document.getElementById('outputs-continue').addEventListener('click', () => {
    const err = document.getElementById('outputs-error');
    const enabled = state.outputs.filter(r => r.enabled);
    if (!enabled.length) { err.textContent = 'Tick at least one thing to calculate.'; err.hidden = false; return; }
    const badConc = enabled.find(r => r.fmt.method === 'conc' && !(parseFloat(r.fmt.cvol) > 0));
    if (badConc) { err.textContent = 'Enter a positive volume for anything you want expressed as a concentration.'; err.hidden = false; return; }
    err.hidden = true;

    if (state.mode === 'verify') {
      goTo('verify', 'forward', renderVerify);
    } else if (state.mode === 'learn') {
      state.learn = { steps: buildYieldLearnSteps(), idx: 0, calcShown: false, phase: 'yield' };
      goTo('learn', 'forward', renderLearnStep);
    } else {
      state.prac = { steps: buildYieldPracSteps(), idx: 0, revealed: false, guess: null, phase: 'yield' };
      goTo('prac', 'forward', renderPracStep);
    }
  });

  // moles → the student's chosen unit, one labelled line (mirrors moleMath,
  // run in reverse). `label` prefixes the line, e.g. "Used" / "Left over".
  function yieldMath(sp, n, fmt, label) {
    const f = fmtFormula(sp);
    const out = amountFromMoles(n, sp, fmt.method, fmt);
    const lead = label ? label + ': ' : '';
    if (fmt.method === 'mass') {
      const M = molarMass(sp);
      return `${lead}m(${f}) = n × M = ${sig(n)} × ${mm1(M)} = ${sig(out.value)} g`;
    }
    if (fmt.method === 'gas') {
      const Vm = MOLAR_VOL[fmt.cond];
      return `${lead}V(${f}) = n × V<sub>m</sub> = ${sig(n)} × ${Vm.toFixed(1)} = ${sig(out.value)} dm³`;
    }
    const Vr = parseFloat(fmt.cvol);
    const V = fmt.cvolUnit === 'cm3' ? Vr / 1000 : Vr;
    const conv = fmt.cvolUnit === 'cm3' ? `V = ${sig(Vr)} cm³ = ${sig(V)} dm³<br>` : '';
    return `${conv}${lead}c(${f}) = n ÷ V = ${sig(n)} ÷ ${sig(V)} = ${sig(out.value)} mol dm⁻³`;
  }

  function buildYieldLearnSteps() {
    const { q, res } = computed();
    const steps = [];
    state.outputs.filter(r => r.enabled).forEach(row => {
      if (row.kind === 'excess') {
        const exc = computeExcessUsage(res);
        const f = fmtFormula(exc.sp);
        steps.push({
          instruction: `How much ${f} is used, and how much is left over?`,
          strategy: `${f} is the reactant with extra. The amount that reacts scales with the limiting reactant; whatever's left of the original amount is left over.`,
          math: yieldMath(exc.sp, exc.nUsed, row.fmt, 'Used') + '<br>' + yieldMath(exc.sp, exc.nLeft, row.fmt, 'Left over')
        });
      } else {
        const p = q.products[row.idx];
        const y = computeProductYields(q, res)[row.idx];
        const f = fmtFormula(p.sp);
        const limSp = res.tie ? fmtFormula(q.A.sp) : fmtFormula(res.limiting.sp);
        steps.push({
          instruction: `How much ${f} can be formed?`,
          strategy: `Every mole of ${limSp} that reacts makes a fixed ratio of ${f}, straight from the balanced equation.`,
          math: yieldMath(p.sp, y.n, row.fmt, null)
        });
      }
    });
    return steps;
  }

  function buildYieldPracSteps() {
    const { q, res } = computed();
    const steps = [];
    state.outputs.filter(r => r.enabled).forEach(row => {
      if (row.kind === 'excess') {
        const exc = computeExcessUsage(res);
        const f = fmtFormula(exc.sp);
        steps.push({
          instruction: `How much ${f} is used, and how much is left over?`,
          strategy: `Work it out on paper — how much ${f} reacts, and what's left of the original amount? Then reveal.`,
          kind: 'reveal',
          revealLabel: `${f} — used and left over`,
          body: `<div class="ans-lines">${mathGrid(yieldMath(exc.sp, exc.nUsed, row.fmt, 'Used') + '<br>' + yieldMath(exc.sp, exc.nLeft, row.fmt, 'Left over'))}</div>`
        });
      } else {
        const p = q.products[row.idx];
        const y = computeProductYields(q, res)[row.idx];
        const f = fmtFormula(p.sp);
        steps.push({
          instruction: `How much ${f} can be formed?`,
          strategy: `Use the mole ratio from the balanced equation, then reveal.`,
          kind: 'reveal',
          revealLabel: `Amount of ${f} formed`,
          body: `<div class="ans-lines">${mathGrid(yieldMath(p.sp, y.n, row.fmt, null))}</div>`
        });
      }
    });
    return steps;
  }

  /* ---------------- VERIFY: answers only ---------------- */
  function renderVerify() {
    const { q, res } = computed();
    const A = q.A, B = q.B;
    const fA = fmtFormula(A.sp), fB = fmtFormula(B.sp);
    const rows = [];

    const massSides = [[A, state.inA], [B, state.inB]].filter(([x, inp]) => inp.method === 'mass');
    if (massSides.length) {
      rows.push(['Molar mass' + (massSides.length > 1 ? 'es' : ''),
        massSides.map(([x]) => `M(${fmtFormula(x.sp)}) = <b>${mm1(molarMass(x.sp))}</b> g mol⁻¹`).join('<span class="dotsep">·</span>')]);
    }
    rows.push(['Moles', `n(${fA}) = <b>${sig(res.nA)}</b> mol<span class="dotsep">·</span>n(${fB}) = <b>${sig(res.nB)}</b> mol`]);
    rows.push(['Mole ratio', `${fA} : ${fB} = <b>${A.coef} : ${B.coef}</b>`]);
    rows.push(['Needed vs available', `need n(${fB}) = <b>${sig(res.nBneed)}</b> mol; have <b>${sig(res.nB)}</b> mol → needed is <b>${res.tie ? 'equal to' : (res.enough ? '≤' : '>')}</b> available`]);
    rows.push(['Conclusion', res.tie
      ? `Limiting: <b>neither — exactly stoichiometric</b>`
      : `Limiting: <b>${fmtFormula(res.limiting.sp)}</b><span class="dotsep">·</span>Excess: <b>${fmtFormula(res.excess.sp)}</b> (<b>${sig(res.leftMass)}</b> g / ${sig(res.leftMol)} mol left over)`]);

    // yield rows — anything ticked on the outputs-selector card
    if (state.outputs) {
      state.outputs.filter(r => r.enabled).forEach(row => {
        if (row.kind === 'excess') {
          const exc = computeExcessUsage(res);
          if (!exc) return; // exactly stoichiometric — nothing left over to report
          const f = fmtFormula(exc.sp);
          const used = amountFromMoles(exc.nUsed, exc.sp, row.fmt.method, row.fmt);
          const left = amountFromMoles(exc.nLeft, exc.sp, row.fmt.method, row.fmt);
          rows.push([`${f} · used &amp; left over`,
            `Used: <b>${sig(used.value)}</b> ${used.unit}<span class="dotsep">·</span>Left over: <b>${sig(left.value)}</b> ${left.unit}`]);
        } else {
          const p = q.products[row.idx];
          const y = computeProductYields(q, res)[row.idx];
          const out = amountFromMoles(y.n, y.sp, row.fmt.method, row.fmt);
          rows.push([`${fmtFormula(p.sp)} formed`, `<b>${sig(out.value)}</b> ${out.unit}`]);
        }
      });
    }

    document.getElementById('verify-body').innerHTML = rows.map(([label, html]) =>
      `<div class="vrow"><div class="vlabel">${label}</div><div class="vval">${html}</div></div>`).join('');
  }

  document.getElementById('verify-again').addEventListener('click', () => goTo('measure', 'back'));
  document.getElementById('verify-restart').addEventListener('click', () => goTo('landing', 'back', resetAll));

  /* ---------------- verdict card ---------------- */
  function renderVerdict() {
    const { q, res } = computed();
    const head = document.getElementById('verdict-headline');
    const body = document.getElementById('verdict-body');
    if (res.tie) {
      head.innerHTML = 'Exactly stoichiometric';
      body.innerHTML = `Neither reactant is in excess — both <b>${fmtFormula(q.A.sp)}</b> and <b>${fmtFormula(q.B.sp)}</b> are used up completely.`;
    } else {
      head.innerHTML = `Limiting reactant: <span class="chip chip--lim">${fmtFormula(res.limiting.sp)}</span>`;
      body.innerHTML = `<b>${fmtFormula(res.limiting.sp)}</b> runs out first, so it controls how much product forms. ` +
        `<b>${fmtFormula(res.excess.sp)}</b> is in <span class="chip chip--exc">excess</span> — about ` +
        `<b>${sig(res.leftMass)} g</b> (${sig(res.leftMol)} mol) of it is left over once the reaction stops.`;
    }
  }

  document.getElementById('verdict-calc-more').addEventListener('click', () => {
    goTo('outputs', 'forward', () => renderOutputs("Tick anything you'd like calculated, then choose how you want each answer expressed."));
  });
  document.getElementById('verdict-again').addEventListener('click', () => goTo('measure', 'back'));
  document.getElementById('verdict-restart').addEventListener('click', () => goTo('landing', 'back', resetAll));

  /* ---------------- boot ---------------- */
  renderCatalog();
  playLandingEntrance();
})();
