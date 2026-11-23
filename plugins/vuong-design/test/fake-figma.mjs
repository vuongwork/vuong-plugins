// Fake Figma Plugin API for the builder runtime tests (plan 3 Task 5). It implements only what core/figma-runtime.js
// uses. Boxes are the assigned x / y / width / height relative to the parent (no auto layout computation), so geometry
// is not asserted here: real Figma checks it (Task 8). It throws where real Figma rejects a call and the builder could
// get it wrong:
//  - layoutSizingHorizontal / Vertical 'FILL' when the parent is not auto layout (a new node sits on the page, so
//    also before appendChild); 'HUG' on a node that is neither an auto-layout frame nor text;
//  - layoutPositioning 'ABSOLUTE' when the parent is not auto layout;
//  - fontName / setRangeFontName with a font not loaded, characters while a font of the node is not loaded;
//  - a SOLID paint whose color has a key other than r, g, b (e.g. `a`) or a channel outside 0..1, opacity outside 0..1;
//  - loadFontAsync of a font that listAvailableFontsAsync does not list; setTextStyleIdAsync / setEffectStyleIdAsync
//    with an unknown id; any use of a removed node; figma.notify (throws inside use_figma);
//  - a shared plugin data namespace that is not at least 3 alphanumeric characters (e.g. 'vd').
// Real-Figma behaviours mimicked: created nodes start on the current page; createFrame starts white and clipping;
// resize() on an auto-layout frame sets its layoutSizing to FIXED; fills / strokes getters return frozen copies.
// makeFakeFigma({ fonts, variables, textStyles, effectStyles, throwIf, ignore, idPrefix, idStart }) -> figma, plus figma._log (ops in call order:
// ['append', parentId, childId, child width, child height], ['constraints', id], ['layoutPositioning', id, value],
// ['pos', id] for x / y / relativeTransform), figma._loads (font key -> n).
// fonts: ['Family|Style', ...]; variables: names; textStyles / effectStyles: names; throwIf(op, node) -> true makes
// that call throw (op: 'resize'), to test error isolation.
// Variables and styles (plan 3 Task 6): figma.variables.createVariableCollection / createVariable / getLocalVariablesAsync /
// getLocalVariableCollectionsAsync, figma.createTextStyle / createEffectStyle. It throws where real Figma rejects:
// createVariable with an unknown type, a non-collection or a duplicate name in the collection; setValueForMode with an
// unknown mode, a colour channel outside 0..1, a non-number FLOAT, an alias to a missing variable or of another type;
// scopes outside VariableScope or of the wrong type; a text style font that is not loaded, a non-positive size, a line
// height / letter spacing without a valid unit; an effect colour with a channel outside 0..1 or without `a`, an unknown type.
// figma._collections lists the created collections.
// ignore: property names silently ignored by the setter on created frames / texts / svg frames (readback diff test).

export const DEFAULT_FONTS = ['Inter|Regular', 'Inter|Medium', 'Inter|Semi Bold', 'Inter|Bold',
  ...['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Italic'].map((s) => 'Be Vietnam Pro|' + s)];

const NUM_FIELDS = new Set(['width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing',
  'counterAxisSpacing', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'strokeWeight',
  'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'opacity', 'fontSize', 'minWidth', 'maxWidth']);
const TEXT_FIELDS = new Set(['fontSize', 'fontFamily', 'fontStyle', 'fontWeight', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent']);
const SIDES = ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'];
const CORNERS = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'];
const fk = (f) => f.family + '|' + f.style;

function checkPaints(ps) {
  if (!Array.isArray(ps)) throw new Error('paints must be an array');
  for (const p of ps) {
    if (p.type === 'SOLID') {
      const ks = Object.keys(p.color || {});
      if (ks.some((k) => !['r', 'g', 'b'].includes(k)) || ks.length !== 3) throw new Error('Invalid SOLID color: keys ' + ks.join(','));
      for (const k of ks) if (!(p.color[k] >= 0 && p.color[k] <= 1)) throw new Error('Color channel out of range: ' + k + '=' + p.color[k]);
    } else if (/^GRADIENT_/.test(p.type)) {
      if (!Array.isArray(p.gradientTransform) || !Array.isArray(p.gradientStops)) throw new Error('bad gradient');
      for (const s of p.gradientStops) for (const k of ['r', 'g', 'b', 'a']) if (!(s.color[k] >= 0 && s.color[k] <= 1)) throw new Error('bad stop');
    } else if (p.type === 'IMAGE') { if (!p.imageHash) throw new Error('image without hash'); } else throw new Error('paint type ' + p.type);
    if (p.opacity !== undefined && !(p.opacity >= 0 && p.opacity <= 1)) throw new Error('paint opacity out of range');
  }
  return Object.freeze(ps.map((p) => Object.freeze({ ...p })));
}

export function makeFakeFigma({ fonts = DEFAULT_FONTS, variables = [], textStyles = [], effectStyles = [], throwIf = () => false, ignore = [], idPrefix = '1', idStart = 0 } = {}) {
  let seq = idStart;
  const nid = () => idPrefix + ':' + ++seq;
  const MIXED = Symbol('mixed');
  const log = [], loads = {}, loaded = new Set();
  const avail = new Set(fonts);
  const VARS = variables.map((name, i) => ({ id: 'VariableID:' + i, name }));
  const styles = (names, p) => names.map((name, i) => ({ id: `S:${p}${i},`, name }));
  const TS = styles(textStyles, 't'), ES = styles(effectStyles, 'e');
  const alias = (v) => ({ type: 'VARIABLE_ALIAS', id: v.id });

  // ---- variables and styles ----
  const COLLS = [];
  const COLOR_SCOPES = ['ALL_SCOPES', 'ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR', 'EFFECT_COLOR'];
  const FLOAT_SCOPES = ['ALL_SCOPES', 'TEXT_CONTENT', 'CORNER_RADIUS', 'WIDTH_HEIGHT', 'GAP', 'STROKE_FLOAT', 'EFFECT_FLOAT', 'OPACITY', 'FONT_WEIGHT',
    'FONT_SIZE', 'LINE_HEIGHT', 'LETTER_SPACING', 'PARAGRAPH_SPACING', 'PARAGRAPH_INDENT'];
  const chan = (c, ks, what) => { for (const k of ks) if (!(typeof c[k] === 'number' && c[k] >= 0 && c[k] <= 1)) throw new Error(what + ' channel ' + k + ' must be a number in 0..1, got ' + c[k]); };
  const unitVal = (v, units, what) => {
    if (!v || !units.includes(v.unit)) throw new Error(what + ': bad unit ' + (v && v.unit));
    if (v.unit !== 'AUTO' && !Number.isFinite(v.value)) throw new Error(what + ': value must be a number');
    return Object.freeze({ ...v });
  };
  class Variable {
    constructor(name, coll, type, id) {
      this.id = id; this.name = name; this.variableCollectionId = coll.id; this.resolvedType = type;
      this.description = ''; this._scopes = ['ALL_SCOPES']; this.valuesByMode = {};
    }
    get scopes() { return [...this._scopes]; }
    set scopes(v) {
      if (!Array.isArray(v)) throw new Error('scopes must be an array');
      const ok = this.resolvedType === 'COLOR' ? COLOR_SCOPES : FLOAT_SCOPES;
      for (const s of v) if (!ok.includes(s)) throw new Error('Scope ' + s + ' is not valid for ' + this.resolvedType);
      this._scopes = [...v];
    }
    setValueForMode(modeId, value) {
      const c = COLLS.find((x) => x.id === this.variableCollectionId);
      if (!c || !c.modes.some((m) => m.modeId === modeId)) throw new Error('setValueForMode: unknown mode ' + modeId);
      if (value && value.type === 'VARIABLE_ALIAS') {
        const t = VARS.find((x) => x.id === value.id);
        if (!t) throw new Error('setValueForMode: alias to a missing variable ' + value.id);
        if (t.resolvedType !== this.resolvedType) throw new Error('setValueForMode: alias of another type');
        if (t === this) throw new Error('setValueForMode: alias to itself');
      } else if (this.resolvedType === 'COLOR') {
        if (!value || typeof value !== 'object') throw new Error('COLOR value must be an object');
        const ks = Object.keys(value);
        if (ks.some((k) => !['r', 'g', 'b', 'a'].includes(k)) || !['r', 'g', 'b'].every((k) => ks.includes(k))) throw new Error('Invalid COLOR value: keys ' + ks.join(','));
        chan(value, ks, 'COLOR');
      } else if (this.resolvedType === 'FLOAT') {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('FLOAT value must be a finite number');
      }
      this.valuesByMode = { ...this.valuesByMode, [modeId]: value && typeof value === 'object' ? { ...value } : value };
    }
  }
  class TextStyle {
    constructor() {
      this.id = `S:t${TS.length + 1000},`; this.type = 'TEXT'; this.name = 'Style'; this.description = ''; this._fn = { family: 'Inter', style: 'Regular' };
      this._fs = 12; this._lh = { unit: 'AUTO' }; this._ls = { unit: 'PERCENT', value: 0 }; this._tc = 'ORIGINAL'; this._td = 'NONE';
    }
    get fontName() { return this._fn; }
    set fontName(f) { if (!f || !loaded.has(fk(f))) throw new Error('Font "' + (f && fk(f)) + '" is not loaded: call figma.loadFontAsync first'); this._fn = { ...f }; }
    get fontSize() { return this._fs; }
    set fontSize(v) { if (!(typeof v === 'number' && v > 0)) throw new Error('fontSize must be > 0'); this._fs = v; }
    get lineHeight() { return this._lh; }
    set lineHeight(v) { this._lh = unitVal(v, ['PIXELS', 'PERCENT', 'AUTO'], 'lineHeight'); }
    get letterSpacing() { return this._ls; }
    set letterSpacing(v) { this._ls = unitVal(v, ['PIXELS', 'PERCENT'], 'letterSpacing'); }
    get textCase() { return this._tc; }
    set textCase(v) { if (!['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'].includes(v)) throw new Error('bad textCase ' + v); this._tc = v; }
    get textDecoration() { return this._td; }
    set textDecoration(v) { if (!['NONE', 'UNDERLINE', 'STRIKETHROUGH'].includes(v)) throw new Error('bad textDecoration ' + v); this._td = v; }
  }
  class EffectStyle {
    constructor() { this.id = `S:e${ES.length + 1000},`; this.type = 'EFFECT'; this.name = 'Style'; this.description = ''; this._fx = []; }
    get effects() { return this._fx; }
    set effects(v) {
      if (!Array.isArray(v)) throw new Error('effects must be an array');
      for (const e of v) {
        if (!['DROP_SHADOW', 'INNER_SHADOW'].includes(e.type)) throw new Error('bad effect type ' + e.type);
        if (!e.color || Object.keys(e.color).sort().join() !== 'a,b,g,r') throw new Error('effect colour needs r, g, b, a');
        chan(e.color, ['r', 'g', 'b', 'a'], 'effect colour');
        if (!e.offset || !Number.isFinite(e.offset.x) || !Number.isFinite(e.offset.y)) throw new Error('effect offset needs x, y');
        if (!(e.radius >= 0)) throw new Error('effect radius must be >= 0');
        if (e.spread !== undefined && !Number.isFinite(e.spread)) throw new Error('effect spread must be a number');
        if (e.blendMode !== undefined && e.blendMode !== 'NORMAL') throw new Error('blendMode ' + e.blendMode);
      }
      this._fx = v.map((e) => ({ ...e, color: { ...e.color }, offset: { ...e.offset } }));
    }
  }

  class Node {
    constructor(type) {
      this.id = nid(); this.type = type; this.name = type; this.parent = null; this._kids = null; this._pd = {};
      this.x = 0; this.y = 0; this.width = 100; this.height = 100; this.opacity = 1; this._removed = false;
      this.boundVariables = {}; this._fills = []; this._strokes = []; this.constraints = { horizontal: 'MIN', vertical: 'MIN' };
      this.layoutPositioning = 'AUTO';
    }
    _ok() { if (this._removed) throw new Error('The node with id ' + this.id + ' does not exist'); }
    get removed() { return this._removed; }
    get children() { this._ok(); return this._kids ? [...this._kids] : undefined; }
    get fills() { return this._fills; }
    set fills(v) { this._ok(); this._fills = checkPaints(v); this._pb('fills', v); }
    get strokes() { return this._strokes; }
    set strokes(v) { this._ok(); this._strokes = checkPaints(v); this._pb('strokes', v); }
    // real Figma mirrors bound paints in boundVariables.fills / strokes as a VariableAlias[]
    _pb(k, ps) { const a = ps.filter((p) => p.boundVariables && p.boundVariables.color).map((p) => p.boundVariables.color); const b = { ...this.boundVariables }; if (a.length) b[k] = a; else delete b[k]; this.boundVariables = b; }
    // x / y (and relativeTransform, which sets them) log ['pos', id] once the node is born: the placing order test
    get x() { return this._x; }
    set x(v) { this._x = v; if (this._born) log.push(['pos', this.id]); }
    get y() { return this._y; }
    set y(v) { this._y = v; if (this._born) log.push(['pos', this.id]); }
    get constraints() { return this._c; }
    set constraints(v) { this._ok(); this._c = { ...v }; if (this._born) log.push(['constraints', this.id]); }
    get layoutPositioning() { return this._lp; }
    set layoutPositioning(v) {
      this._ok();
      if (v === 'ABSOLUTE' && !isAL(this.parent)) throw new Error('layoutPositioning ABSOLUTE needs an auto-layout parent');
      this._lp = v; if (this._born) log.push(['layoutPositioning', this.id, v]);
    }
    get layoutSizingHorizontal() { return this._lsh || 'FIXED'; }
    set layoutSizingHorizontal(v) { this._sizing('_lsh', v); }
    get layoutSizingVertical() { return this._lsv || 'FIXED'; }
    set layoutSizingVertical(v) { this._sizing('_lsv', v); }
    _sizing(k, v) {
      this._ok();
      if (v === 'FILL' && !(isAL(this.parent) && this._lp !== 'ABSOLUTE')) throw new Error('FILL can only be set on children of auto-layout frames');
      if (v === 'HUG' && !(isAL(this) || this.type === 'TEXT')) throw new Error('HUG can only be set on auto-layout frames and text');
      if (!['FILL', 'HUG', 'FIXED'].includes(v)) throw new Error('bad sizing ' + v);
      this[k] = v;
    }
    get minWidth() { return this._minW === undefined ? null : this._minW; }
    set minWidth(v) { this._ok(); this._minW = v; }
    get maxWidth() { return this._maxW === undefined ? null : this._maxW; }
    set maxWidth(v) { this._ok(); this._maxW = v; }
    // the parents' offsets plus the node's own relativeTransform (rotated ancestors are not modelled)
    get absoluteTransform() {
      let x = 0, y = 0;
      for (let n = this.parent; n && n.type !== 'PAGE'; n = n.parent) { x += n.x; y += n.y; }
      const m = this.relativeTransform;
      return [[m[0][0], m[0][1], x + m[0][2]], [m[1][0], m[1][1], y + m[1][2]]];
    }
    // as real Figma: the bounding box of the transformed node (a rotated node's box is larger than width x height)
    get absoluteBoundingBox() {
      const T = this.absoluteTransform;
      const c = [[0, 0], [this.width, 0], [0, this.height], [this.width, this.height]].map(([u, v]) => [T[0][0] * u + T[0][1] * v + T[0][2], T[1][0] * u + T[1][1] * v + T[1][2]]);
      const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]), x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    set relativeTransform(m) { this._ok(); this._rt = m; this.x = m[0][2]; this.y = m[1][2]; }
    get relativeTransform() { const m = this._rt; return m ? [[m[0][0], m[0][1], this.x], [m[1][0], m[1][1], this.y]] : [[1, 0, this.x], [0, 1, this.y]]; }
    resize(w, h) {
      this._ok();
      if (throwIf('resize', this)) throw new Error('fake failure on resize');
      if (!(w >= 0.01 && h >= 0.01)) throw new Error('resize: size must be >= 0.01');
      this.width = w; this.height = h;
      if (isAL(this)) { this._lsh = 'FIXED'; this._lsv = 'FIXED'; }
    }
    remove() { this._ok(); if (this.parent) this.parent._kids.splice(this.parent._kids.indexOf(this), 1); this.parent = null; this._removed = true; }
    // real Figma: 'The namespace must be at least 3 alphanumeric characters' (plugin-api d.ts, PluginDataMixin)
    _ns(ns) { if (!/^[A-Za-z0-9]{3,}$/.test(ns)) throw new Error('in setSharedPluginData: The namespace must be at least 3 alphanumeric characters'); }
    setSharedPluginData(ns, k, v) { this._ok(); this._ns(ns); this._pd[ns + '/' + k] = String(v); }
    getSharedPluginData(ns, k) { this._ok(); this._ns(ns); return this._pd[ns + '/' + k] || ''; }
    setBoundVariable(field, v) {
      this._ok();
      if (!NUM_FIELDS.has(field)) throw new Error('setBoundVariable: field ' + field + ' is not bindable');
      if (!v || !VARS.includes(v)) throw new Error('setBoundVariable: unknown variable');
      // real Figma: a text field (VariableBindableTextField) of a TEXT node is a VariableAlias[] (one per range)
      this.boundVariables = { ...this.boundVariables, [field]: this.type === 'TEXT' && TEXT_FIELDS.has(field) ? [alias(v)] : alias(v) };
    }
    findAll(fn) {
      const out = [];
      const w = (n) => { for (const c of n._kids || []) { if (fn(c)) out.push(c); w(c); } };
      w(this); return out;
    }
  }
  const isAL = (n) => !!n && n.type === 'FRAME' && n.layoutMode !== 'NONE';

  class Parent extends Node {
    constructor(type) { super(type); this._kids = []; }
    appendChild(c) {
      this._ok(); c._ok();
      if (c.parent) c.parent._kids.splice(c.parent._kids.indexOf(c), 1);
      this._kids.push(c); c.parent = this; log.push(['append', this.id, c.id, c.width, c.height]);
    }
  }

  class Frame extends Parent {
    constructor() {
      super('FRAME');
      this.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]; this.clipsContent = true; this.layoutMode = 'NONE';
      this.paddingTop = this.paddingRight = this.paddingBottom = this.paddingLeft = 0; this.itemSpacing = 0; this.counterAxisSpacing = 0;
      this.primaryAxisAlignItems = 'MIN'; this.counterAxisAlignItems = 'MIN'; this.layoutWrap = 'NO_WRAP'; this.strokesIncludedInLayout = true;
      this.strokeAlign = 'INSIDE'; this.dashPattern = []; this.effects = [];
      for (const k of CORNERS) this[k] = 0;
      for (const k of SIDES) this[k] = 1;
      this._born = true;
    }
    get cornerRadius() { const v = CORNERS.map((k) => this[k]); return v.every((x) => x === v[0]) ? v[0] : MIXED; }
    set cornerRadius(v) { for (const k of CORNERS) this[k] = v; }
    get strokeWeight() { const v = SIDES.map((k) => this[k]); return v.every((x) => x === v[0]) ? v[0] : MIXED; }
    set strokeWeight(v) { for (const k of SIDES) this[k] = v; }
    set effects(v) {
      for (const e of v) for (const k of ['r', 'g', 'b', 'a']) if (!(e.color[k] >= 0 && e.color[k] <= 1)) throw new Error('bad effect colour');
      this._fx = v;
    }
    get effects() { return this._fx; }
    async setEffectStyleIdAsync(id) { this._ok(); if (!ES.find((s) => s.id === id)) throw new Error('unknown effect style'); this.effectStyleId = id; }
  }

  class Text extends Node {
    constructor() {
      super('TEXT');
      this._chars = ''; this._st = []; this._base = { fontName: { family: 'Inter', style: 'Regular' }, fontSize: 12, fills: checkPaints([{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]), textStyleId: '' };
      this.textAutoResize = 'WIDTH_AND_HEIGHT'; this.textAlignHorizontal = 'LEFT'; this.textAlignVertical = 'TOP';
      this.lineHeight = { unit: 'AUTO' }; this.letterSpacing = { unit: 'PERCENT', value: 0 }; this.textDecoration = 'NONE'; this.textCase = 'ORIGINAL';
      this._ranges = []; this._born = true;
    }
    _get(k) {
      if (!this._st.length) return this._base[k];
      const v = this._st.map((s) => JSON.stringify(s[k]));
      return v.every((x) => x === v[0]) ? this._st[0][k] : MIXED;
    }
    _set(k, v, s = 0, e = this._st.length) {
      this._ok();
      if (s < 0 || e > this._st.length || s >= e) { if (this._st.length || s !== 0) throw new Error(`range ${s}..${e} outside 0..${this._st.length}`); }
      if (!this._st.length) { this._base = { ...this._base, [k]: v }; return; }
      for (let i = s; i < e; i++) this._st[i] = { ...this._st[i], [k]: v };
    }
    _font(f) { if (!loaded.has(fk(f))) throw new Error('Font "' + fk(f) + '" is not loaded: call figma.loadFontAsync first'); }
    get characters() { return this._chars; }
    set characters(v) {
      this._ok();
      for (const s of this._st.length ? this._st : [this._base]) this._font(s.fontName);
      const tpl = this._st[0] || this._base;
      this._chars = String(v); this._st = [...this._chars].length ? Array.from({ length: this._chars.length }, () => ({ ...tpl })) : [];
      if (!this._st.length) this._base = { ...tpl };
    }
    get fontName() { return this._get('fontName'); }
    set fontName(f) { this._font(f); this._set('fontName', { ...f }); }
    get fontSize() { return this._get('fontSize'); }
    set fontSize(v) { this._set('fontSize', v); }
    get fills() { return this._get('fills'); }
    set fills(v) { this._set('fills', checkPaints(v)); }
    get textStyleId() { return this._get('textStyleId'); }
    async setTextStyleIdAsync(id) { if (!TS.find((s) => s.id === id)) throw new Error('unknown text style'); this._set('textStyleId', id); }
    async setRangeTextStyleIdAsync(s, e, id) { if (!TS.find((x) => x.id === id)) throw new Error('unknown text style'); this._set('textStyleId', id, s, e); }
    setRangeFontName(s, e, f) { this._font(f); this._set('fontName', { ...f }, s, e); }
    setRangeFontSize(s, e, v) { this._set('fontSize', v, s, e); }
    setRangeFills(s, e, v) { this._set('fills', checkPaints(v), s, e); }
    setRangeLineHeight(s, e, v) { this._rng('lineHeight', s, e, v); }
    setRangeLetterSpacing(s, e, v) { this._rng('letterSpacing', s, e, v); }
    setRangeTextDecoration(s, e, v) { this._rng('textDecoration', s, e, v); }
    setRangeTextCase(s, e, v) { this._rng('textCase', s, e, v); }
    _rng(k, s, e, v) { this._ok(); if (s < 0 || e > this._chars.length || s >= e) throw new Error('bad range'); this._ranges.push([k, s, e, v]); }
    getStyledTextSegments(fields) {
      const out = [];
      for (let i = 0; i < this._st.length; i++) {
        const key = JSON.stringify(fields.map((f) => this._st[i][f]));
        const last = out[out.length - 1];
        if (last && last._k === key) { last.end = i + 1; last.characters += this._chars[i]; continue; }
        const seg = { _k: key, start: i, end: i + 1, characters: this._chars[i] };
        for (const f of fields) seg[f] = this._st[i][f];
        out.push(seg);
      }
      return out.map(({ _k, ...s }) => s);
    }
  }

  class Vector extends Node { constructor() { super('VECTOR'); this._born = true; } }

  class Page extends Parent { constructor(name) { super('PAGE'); this.name = name; } }
  const root = { children: [new Page('Page 1')] };
  let current = root.children[0];
  // ignore: property names whose setter is silently a no-op (an API that drops a setting), to test the readback diff
  const born = (n) => {
    for (const k of ignore) { const v = n[k]; Object.defineProperty(n, k, { get: () => v, set: () => {}, configurable: true }); }
    current.appendChild(n); return n;
  };

  const figma = {
    mixed: MIXED,
    root,
    get currentPage() { return current; },
    async setCurrentPageAsync(p) { if (!root.children.includes(p)) throw new Error('not a page'); current = p; figma._pageSets++; },
    _pageSets: 0,
    createPage() { const p = new Page('Page ' + (root.children.length + 1)); root.children.push(p); return p; },
    createFrame: () => born(new Frame()),
    createText: () => born(new Text()),
    createNodeFromSvg(svg) {
      if (!/^<svg[\s>]/.test(svg) || /<invalid/.test(svg)) throw new Error('Failed to parse SVG');
      const f = born(new Frame());
      const num = (k) => { const m = new RegExp(`<svg[^>]*\\s${k}="([\\d.]+)"`).exec(svg); return m ? +m[1] : 24; };
      f.width = num('width'); f.height = num('height');
      const v = new Vector(); f.appendChild(v);
      const col = (k) => { const m = new RegExp(`<g[^>]*\\s${k}="(#[0-9a-f]{6})"`).exec(svg); if (!m) return []; const x = parseInt(m[1].slice(1), 16); return [{ type: 'SOLID', color: { r: (x >> 16 & 255) / 255, g: (x >> 8 & 255) / 255, b: (x & 255) / 255 } }]; };
      v.fills = col('fill'); v.strokes = col('stroke');
      return f;
    },
    createImage: (bytes) => ({ hash: 'img' + bytes.length }),
    base64Decode: (s) => Uint8Array.from(Buffer.from(s, 'base64')),
    async listAvailableFontsAsync() { return [...avail].map((k) => { const [family, style] = k.split('|'); return { fontName: { family, style } }; }); },
    async loadFontAsync(f) {
      if (!avail.has(fk(f))) throw new Error('font not available: ' + fk(f));
      loaded.add(fk(f)); loads[fk(f)] = (loads[fk(f)] || 0) + 1;
    },
    createTextStyle() { const t = new TextStyle(); TS.push(t); return t; },
    createEffectStyle() { const t = new EffectStyle(); ES.push(t); return t; },
    _collections: COLLS,
    async getLocalTextStylesAsync() { return [...TS]; },
    async getLocalEffectStylesAsync() { return [...ES]; },
    variables: {
      async getLocalVariablesAsync() { return [...VARS]; },
      async getLocalVariableCollectionsAsync() { return [...COLLS]; },
      createVariableCollection(name) {
        const id = 'VariableCollectionId:' + (COLLS.length + 1);
        const c = { id, name, modes: [{ modeId: id + ':0', name: 'Mode 1' }], defaultModeId: id + ':0', variableIds: [],
          renameMode(modeId, n) { const m = c.modes.find((x) => x.modeId === modeId); if (!m) throw new Error('renameMode: unknown mode'); m.name = n; } };
        COLLS.push(c); return c;
      },
      createVariable(name, collection, type) {
        if (!collection || typeof collection !== 'object' || !COLLS.includes(collection)) throw new Error('createVariable: collection must be a VariableCollection');
        if (!['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'].includes(type)) throw new Error('createVariable: bad type ' + type);
        if (!name || typeof name !== 'string') throw new Error('createVariable: name required');
        if (VARS.some((v) => v.variableCollectionId === collection.id && v.name === name)) throw new Error('Duplicate variable name ' + name);
        const v = new Variable(name, collection, type, 'VariableID:' + (VARS.length + 1000)); VARS.push(v); collection.variableIds.push(v.id); return v;
      },
      setBoundVariableForPaint(p, field, v) {
        if (field !== 'color' || !VARS.includes(v)) throw new Error('setBoundVariableForPaint: bad args');
        return { ...p, boundVariables: { color: alias(v) } };
      },
    },
    notify() { throw new Error('figma.notify is not available in use_figma'); },
    _log: log,
    _loads: loads,
  };
  return figma;
}
