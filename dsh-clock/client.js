/*
 * Floating Clock — Client half.
 *
 * A small draggable clock in shell.overlay:
 *   - shows the current time
 *   - stopwatch (正计时), countdown (倒计时), alarm (闹钟)
 *   - only ONE of the three may be active at a time
 *   - collapses into a pill after a while without a touch;
 *     the pill alternates between the current time and the running task
 */
window.__ModuleLoader__.load({
  id: 'dsh-clock',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const IDLE_MS = 5000;    // untouched for this long -> collapse into a pill
    const ROTATE_MS = 10000; // pill alternation period
    const TICK_MS = 250;
    const SNOOZE_MS = 5 * 60000;
    const LS_KEY = 'dsh.floating-clock.v1';
    const W = 240;
    const PILL_H = 34;
    const PILL_W = W;   // 小化胶囊与展开面板等宽
    const EXPANDED_H = 264;

    const ZH = (navigator.language || 'en').toLowerCase().startsWith('zh');

    const TXT = ZH
      ? {
        title: '时钟', clock: '时钟', stopwatch: '正计时', timer: '倒计时', alarm: '闹钟',
        start: '开始', pause: '暂停', resume: '继续', reset: '重置', stop: '停止',
        dismiss: '关闭', snooze: '稍后5分', repeatDaily: '每天重复', arm: '启用闹钟',
        min: '分', sec: '秒', hour: '时',
        busy: '同一时间只能运行一个：正计时 / 倒计时 / 闹钟',
        done: '倒计时结束', ringing: '闹钟时间到', collapse: '收起', expand: '展开',
        msg: '提醒内容', msgHint: '例如：喝水、开会',
        settings: '悬浮时钟设置', palette: '面板颜色', followTheme: '跟随主题',
        customHex: '自定义颜色', hexApply: '应用', hexInvalid: '请输入合法的颜色值，如 #77DD77',
        paletteHint: '选择悬浮时钟面板的背景色：浅色背景自动使用黑色文字，深色背景自动使用白色文字，始终保证可读。选“A”跟随应用主题。支持十六进制自定义，如 #77DD77。',
        setFirst: '请先设置时长',
      }
      : {
        title: 'Clock', clock: 'Clock', stopwatch: 'Count up', timer: 'Countdown', alarm: 'Alarm',
        start: 'Start', pause: 'Pause', resume: 'Resume', reset: 'Reset', stop: 'Stop',
        dismiss: 'Dismiss', snooze: 'Snooze 5m', repeatDaily: 'Repeat daily', arm: 'Set alarm',
        min: 'min', sec: 'sec', hour: 'h',
        busy: 'Only one of count up / countdown / alarm can run',
        done: 'Countdown finished', ringing: 'Alarm time', collapse: 'Collapse', expand: 'Expand',
        msg: 'Message', msgHint: 'e.g. drink water',
        settings: 'Floating clock', palette: 'Panel colour', followTheme: 'Follow theme',
        customHex: 'Custom colour', hexApply: 'Apply', hexInvalid: 'Enter a valid colour, e.g. #77DD77',
        paletteHint: 'Background colour of the clock panel: light backgrounds automatically get dark text, dark backgrounds light text, always readable. “A” follows the app theme. Hex values like #77DD77 are supported.',
        setFirst: 'Set a duration first',
      };

    // --------------------------------------------------------------- utils
    const pad = (n, w) => String(Math.floor(Math.abs(n))).padStart(w || 2, '0');

    function fmtSpan(ms) {
      const s = Math.floor(ms / 1000);
      const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
      return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
    }

    function fmtClock(d) {
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    let fmtWeekday;
    try { fmtWeekday = new Intl.DateTimeFormat(navigator.language, { weekday: 'short' }); }
    catch { fmtWeekday = { format: (d) => ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] }; }

    function nextOccurrence(now, hour, minute) {
      const d = new Date(now);
      d.setHours(hour, minute, 0, 0);
      if (d.getTime() <= now) d.setDate(d.getDate() + 1);
      return d.getTime();
    }

    function defaultState() {
      return {
        mode: 'clock',
        x: null, y: null,
        stopwatch: { running: false, startedAt: 0, accum: 0 },
        timer: { running: false, endAt: 0, duration: 60000, left: 60000 },
        alarm: { on: false, hour: 8, minute: 0, repeat: false, targetAt: 0, message: '' },
      };
    }

    function load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        const base = defaultState();
        if (!p || typeof p !== 'object') return null;
        return {
          ...base, ...p,
          stopwatch: { ...base.stopwatch, ...(p.stopwatch || {}) },
          timer: { ...base.timer, ...(p.timer || {}) },
          alarm: { ...base.alarm, ...(p.alarm || {}) },
        };
      } catch { return null; }
    }

    // A countdown or alarm that elapsed while the page was closed must land in
    // its end state instead of silently restarting.
    function reconcile(s) {
      const now = Date.now();
      const out = {
        ...s,
        stopwatch: { ...s.stopwatch },
        timer: { ...s.timer },
        alarm: { ...s.alarm },
      };
      if (out.timer.running) {
        if (out.timer.endAt <= now) {
          out.timer.running = false;
          out.timer.left = 0;
          out.pendingAlert = 'done';
        } else out.timer.left = out.timer.endAt - now;
      }
      if (out.alarm.on) {
        if (!out.alarm.repeat || !out.alarm.targetAt || out.alarm.targetAt <= now) {
          const target = nextOccurrence(now, out.alarm.hour, out.alarm.minute);
          if (!out.alarm.repeat && out.alarm.targetAt && out.alarm.targetAt <= now) out.pendingAlert = 'ringing';
          out.alarm.targetAt = target;
          if (!out.alarm.repeat && out.pendingAlert === 'ringing') out.alarm.on = false;
        }
      }
      return out;
    }

    const ACCENTS = ['#38bdf8', '#8b5cf6', '#f472b6', '#34d399', '#fbbf24', '#f97316', '#ef4444', '#2dd4bf'];

    // Shared settings: the settings page writes, the widget reads.
    // Persisted under their own keys so both mount orders work.
    const ACCENT_KEY = 'dsh.floating-clock.accent';

    function loadAccent() {
      try {
        const v = localStorage.getItem(ACCENT_KEY);
        return v && HEX_RE.test(v) ? v : null;
      } catch { return null; }
    }

    // #abc / #aabbcc / 无# 均可，归一化为小写 #rrggbb
    const HEX_RE = /^#[0-9a-f]{6}$/i;
    function normalizeHex(input) {
      let s = String(input || '').trim().toLowerCase();
      if (s && s[0] !== '#') s = '#' + s;
      if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
      return HEX_RE.test(s) ? s : null;
    }

    // --- colour helpers ------------------------------------------------------
    function parseRgb(str) {
      const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(str || '');
      if (!m) return null;
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    }
    function hexToRgb(h) {
      const s = h.replace('#', '');
      return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    }
    function rgbToHex(rgb) {
      return '#' + rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
    }
    function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    function luminance(rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); }
    function contrast(a, b) { const hi = Math.max(a, b) + 0.05, lo = Math.min(a, b) + 0.05; return hi / lo; }
    function mixRgb(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
    // 与某目标色按 t 比例混合（用于从主色派生面板深/浅层级）
    function tint(hex, target, t) { return rgbToHex(mixRgb(hexToRgb(hex), target, t)); }

    // 把前景色向黑/白微调，直到与背景对比度 >= min（保持色调）。
    function ensureReadable(fgHex, bgHex, min) {
      const bgL = luminance(hexToRgb(bgHex)), fgL = luminance(hexToRgb(fgHex));
      if (contrast(fgL, bgL) >= (min || 4.5)) return fgHex;
      const target = bgL > 0.35 ? [10, 10, 12] : [245, 245, 248];
      const fg = hexToRgb(fgHex);
      for (let t = 0.08; t <= 1.001; t += 0.08) {
        const c = mixRgb(fg, target, t);
        if (contrast(luminance(c), bgL) >= (min || 4.5)) return rgbToHex(c);
      }
      return rgbToHex(target);
    }

    // 从所选主色派生整套面板配色：背景层级 + 文字（浅底黑字、深底白字，
    // 并保证对比度达到 WCAG AA 4.5:1，任何颜色都清晰可读）。
    function derivePalette(hexColor) {
      const rgb = hexToRgb(hexColor);
      const L = luminance(rgb);
      const dark = L < 0.45;                       // 深底 -> 白字；浅底 -> 黑字
      const bg = hexColor;                          // 面板背景 = 所选色
      const bgLayer1 = tint(hexColor, dark ? [255, 255, 255] : [0, 0, 0], 0.10); // 内嵌控件底
      const bgLayer2 = tint(hexColor, dark ? [255, 255, 255] : [0, 0, 0], 0.18); // 激活态底
      const border1 = tint(hexColor, dark ? [255, 255, 255] : [0, 0, 0], 0.22);
      const border2 = tint(hexColor, dark ? [255, 255, 255] : [0, 0, 0], 0.38);
      // 文字：主文字/次文字都以纯黑或纯白为基底，保证在任何底色上可读
      const baseText = dark ? '#f7f8fa' : '#0b0c0e';
      const baseDim = dark ? '#dbe0e6' : '#33383e';
      const text = ensureReadable(baseText, bg, 4.5);
      const textDim = ensureReadable(baseDim, bg, 3.0);
      const textOnLayer = ensureReadable(baseText, bgLayer1, 4.5);
      // 强调/激活态落在 bgLayer2 上
      const accent = ensureReadable(
        dark ? tint(hexColor, [255, 255, 255], 0.5) : tint(hexColor, [0, 0, 0], 0.4),
        bgLayer2, 4.5);
      // 响铃警示色 / 危险操作色：按各自底色校正到可读
      const warn = ensureReadable(dark ? '#f5c24a' : '#9a6500', bgLayer1, 4.5);
      const danger = ensureReadable(dark ? '#ff8f8f' : '#c0343d', bgLayer1, 4.5);
      return {
        bg, bgLayer1, bgLayer2, border1, border2,
        text, textDim, textOnLayer, accent, warn, danger, dark,
      };
    }

    // Settings page component registered as its own settings section tab.
    function ClockSettings() {
      const [accent, setAccent] = React.useState(loadAccent);
      const [hexText, setHexText] = React.useState(() => (accent ? accent : ''));
      const [hexBad, setHexBad] = React.useState(false);
      const emit = () => window.dispatchEvent(new CustomEvent('dsh-floating-clock-accent'));
      const pick = (v) => {
        setAccent(v);
        setHexText(v || '');
        setHexBad(false);
        try { v ? localStorage.setItem(ACCENT_KEY, v) : localStorage.removeItem(ACCENT_KEY); } catch { /* ignore */ }
        emit();
      };
      const applyHex = () => {
        const norm = normalizeHex(hexText);
        if (!norm) { setHexBad(true); return; }
        pick(norm);
      };
      return h('div', { className: 'dflk-set' },
        h('div', { className: 'dflk-set-label' }, TXT.palette),
        h('div', { className: 'dflk-swatches' },
          h('button', {
            className: `dflk-swatch dflk-swatch-auto${!accent ? ' dflk-swatch-on' : ''}`,
            title: TXT.followTheme, onClick: () => pick(null),
          }, h('span', { className: 'dflk-swatch-auto-mark' }, 'A')),
          ACCENTS.map((c) => h('button', {
            key: c,
            className: `dflk-swatch${accent === c ? ' dflk-swatch-on' : ''}`,
            style: { background: c },
            title: c,
            onClick: () => pick(c),
          }))),
        h('div', { className: 'dflk-hex-row' },
          h('span', { className: 'dflk-set-sublabel' }, TXT.customHex),
          h('span', {
            className: 'dflk-hex-preview',
            style: { background: normalizeHex(hexText) || 'transparent' },
          }),
          h('input', {
            className: `dflk-hex-input${hexBad ? ' dflk-hex-input-bad' : ''}`,
            type: 'text', spellCheck: false, maxLength: 9,
            placeholder: '#77DD77',
            value: hexText,
            onChange: (e) => { setHexText(e.target.value); setHexBad(false); },
            onKeyDown: (e) => { if (e.key === 'Enter') applyHex(); },
          }),
          h('button', { className: 'dflk-hex-apply', onClick: applyHex }, TXT.hexApply)),
        hexBad ? h('div', { className: 'dflk-hex-error' }, TXT.hexInvalid) : null,
        h('div', { className: 'dflk-set-hint' }, TXT.paletteHint));
    }

    // ---------------------------------------------------------------- view
    function Clock() {
      const [state, setState] = React.useState(() => reconcile(load() || defaultState()));
      const [now, setNow] = React.useState(() => Date.now());
      const [accent, setAccentState] = React.useState(loadAccent);
      React.useEffect(() => {
        const sync = () => setAccentState(loadAccent());
        window.addEventListener('dsh-floating-clock-accent', sync);
        window.addEventListener('storage', sync);
        return () => {
          window.removeEventListener('dsh-floating-clock-accent', sync);
          window.removeEventListener('storage', sync);
        };
      }, []);

      // 所选主色 -> 整套面板配色；未选择则跟随应用主题 token
      const paletteStyle = React.useMemo(() => {
        if (!accent) return {};
        const p = derivePalette(accent);
        return {
          '--dflk-bg': p.bg,
          '--dflk-bg1': p.bgLayer1,
          '--dflk-bg2': p.bgLayer2,
          '--dflk-border1': p.border1,
          '--dflk-border2': p.border2,
          '--dflk-text': p.text,
          '--dflk-text-dim': p.textDim,
          '--dflk-text-strong': p.textOnLayer,
          '--dflk-accent': p.accent,
          '--dflk-warn': p.warn,
          '--dflk-danger': p.danger,
        };
      }, [accent]);
      // 刷新后若有到期未处理的闹钟/倒计时，保持展开让用户能关闭
      const [collapsed, setCollapsed] = React.useState(() => {
        const s0 = load();
        return !(s0 && reconcile(s0).pendingAlert);
      });
      const [rotate, setRotate] = React.useState(true);
      const [alert, setAlert] = React.useState(() => state.pendingAlert || null);
      const lastTouch = React.useRef(Date.now());
      const dragging = React.useRef(null);
      const rootRef = React.useRef(null);

      React.useEffect(() => {
        if (state.pendingAlert) setState((s) => { const { pendingAlert, ...rest } = s; return rest; });
      }, []);

      // --- persistence -----------------------------------------------------
      React.useEffect(() => {
        try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota */ }
      }, [state]);

      // --- ticking ----------------------------------------------------------
      React.useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), TICK_MS);
        const spin = setInterval(() => setRotate((r) => !r), ROTATE_MS);
        const idle = setInterval(() => {
          if (Date.now() - lastTouch.current > IDLE_MS) setCollapsed(true);
        }, 500);
        return () => { clearInterval(tick); clearInterval(spin); clearInterval(idle); };
      }, []);

      const touch = React.useCallback(() => {
        lastTouch.current = Date.now();
        setCollapsed(false);
      }, []);

      // Dragging the pill must not blow it up mid-drag; only a real click does.
      const wakeOnly = React.useCallback(() => { lastTouch.current = Date.now(); }, []);

      const sw = state.stopwatch, tm = state.timer, al = state.alarm;

      // --- only one task at a time ----------------------------------------
      const active = sw.running ? 'stopwatch' : tm.running ? 'timer' : al.on ? 'alarm' : null;
      const blocked = (kind) => active !== null && active !== kind;

      // --- alarm firing (while the page is open) ---------------------------
      React.useEffect(() => {
        if (!al.on || alert === 'ringing') return;
        if (now >= al.targetAt) {
          setAlert('ringing');
          lastTouch.current = Date.now();
          setCollapsed(false);
          setState((s) => {
            if (!s.alarm.on) return s;
            const keep = s.alarm.repeat;
            return {
              ...s,
              alarm: { ...s.alarm, on: keep, targetAt: keep ? nextOccurrence(Date.now(), s.alarm.hour, s.alarm.minute) : 0 },
            };
          });
        }
      }, [now, al.on, al.targetAt, alert]);

      // --- countdown finishing ---------------------------------------------
      React.useEffect(() => {
        if (tm.running && tm.endAt && now >= tm.endAt) {
          setState((s) => ({ ...s, timer: { ...s.timer, running: false, left: 0 } }));
          setAlert('done');
          lastTouch.current = Date.now();
          setCollapsed(false);
        }
      }, [now, tm.running, tm.endAt]);

      // --- audible signal ---------------------------------------------------
      React.useEffect(() => {
        if (!alert) return undefined;
        let ctx = null;
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
        if (!ctx) return undefined;
        let on = false;
        const holder = setInterval(() => {
          on = !on;
          try {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type = 'sine'; o.frequency.value = on ? 880 : 660;
            g.gain.setValueAtTime(0.0001, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
            o.start(); o.stop(ctx.currentTime + 0.32);
          } catch { /* autoplay blocked */ }
        }, 400);
        return () => { clearInterval(holder); try { ctx.close(); } catch { /* ignore */ } };
      }, [alert]);

      // --- drag ---------------------------------------------------------------
      const onPointerDown = React.useCallback((e) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('.dflk-nodrag')) return;
        const el = rootRef.current;
        if (!el) return;
        wakeOnly();
        const r = el.getBoundingClientRect();
        dragging.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }, [wakeOnly]);

      const onPointerMove = React.useCallback((e) => {
        const d = dragging.current;
        if (!d) return;
        wakeOnly();
        if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 4) d.moved = true;
        const w = collapsed ? PILL_W : W;
        const hh = collapsed ? PILL_H : EXPANDED_H;
        const x = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - d.dx));
        const y = Math.max(4, Math.min(window.innerHeight - hh - 4, e.clientY - d.dy));
        setState((s) => (s.x === x && s.y === y ? s : { ...s, x, y }));
      }, [collapsed, wakeOnly]);

      // A click (not a drag) on the collapsed pill expands it.
      const onPillClick = React.useCallback(() => {
        if (dragging.current && dragging.current.moved) return;
        touch();
      }, [touch]);

      const onPointerUp = React.useCallback(() => { dragging.current = null; }, []);

      const pos = React.useMemo(() => {
        const w = collapsed ? PILL_W : W;
        const hh = collapsed ? PILL_H : EXPANDED_H;
        const x = state.x == null ? window.innerWidth - w - 28 : Math.max(4, Math.min(window.innerWidth - w - 4, state.x));
        const y = state.y == null ? window.innerHeight - hh - 112 : Math.max(4, Math.min(window.innerHeight - hh - 4, state.y));
        return { x, y };
      }, [state.x, state.y, collapsed]);

      // --- actions ------------------------------------------------------------
      const swMs = sw.running ? sw.accum + (now - sw.startedAt) : sw.accum;
      const tmMs = tm.running ? Math.max(0, tm.endAt - now) : tm.left;

      const startSw = () => setState((s) => ({
        ...s, mode: 'stopwatch',
        stopwatch: { running: true, startedAt: Date.now(), accum: s.stopwatch.accum },
      }));
      const pauseSw = () => setState((s) => ({
        ...s,
        stopwatch: { running: false, startedAt: 0, accum: s.stopwatch.accum + (Date.now() - s.stopwatch.startedAt) },
      }));
      const resetSw = () => setState((s) => ({ ...s, stopwatch: { running: false, startedAt: 0, accum: 0 } }));

      const setDur = (mins, secs) => setState((s) => {
        const ms = (mins * 60 + secs) * 1000;
        return { ...s, timer: { ...s.timer, duration: ms, left: s.timer.running ? s.timer.left : ms } };
      });
      const startTm = () => {
        const dur = tm.duration;
        if (dur <= 0) return;
        setState((s) => ({
          ...s, mode: 'timer',
          timer: { running: true, endAt: Date.now() + dur, duration: dur, left: dur },
        }));
      };
      const pauseTm = () => setState((s) => ({
        ...s,
        timer: { ...s.timer, running: false, left: Math.max(0, s.timer.endAt - Date.now()) },
      }));
      const resetTm = () => setState((s) => ({
        ...s,
        timer: { running: false, endAt: 0, left: s.timer.duration, duration: s.timer.duration },
      }));

      const armAlarm = () => setState((s) => ({
        ...s, mode: 'alarm',
        alarm: {
          ...s.alarm, on: true,
          targetAt: nextOccurrence(Date.now(), s.alarm.hour, s.alarm.minute),
        },
      }));
      const unarmAlarm = () => setState((s) => ({
        ...s, alarm: { ...s.alarm, on: false, targetAt: 0 },
      }));

      const btn = (label, onClick, opts) => h('button', {
        className: `dflk-btn dflk-nodrag${opts && opts.primary ? ' dflk-btn-primary' : ''}${opts && opts.danger ? ' dflk-btn-danger' : ''}`,
        onClick: () => { touch(); onClick(); },
        disabled: !!(opts && opts.disabled),
        title: opts && opts.title ? opts.title : undefined,
      }, label);

      // --- expanded body --------------------------------------------------------
      let body;
      if (state.mode === 'clock') {
        const d = new Date(now);
        body = h('div', { className: 'dflk-body' },
          h('div', { className: 'dflk-time' }, fmtClock(d)),
          h('div', { className: 'dflk-sub' },
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${fmtWeekday.format(d)}`));
      } else if (state.mode === 'stopwatch') {
        body = h('div', { className: 'dflk-body' },
          h('div', { className: 'dflk-time' }, fmtSpan(swMs)),
          h('div', { className: 'dflk-row' },
            sw.running
              ? btn(TXT.pause, pauseSw)
              : btn(sw.accum > 0 ? TXT.resume : TXT.start, startSw, {
                primary: true, disabled: blocked('stopwatch'),
                title: blocked('stopwatch') ? TXT.busy : undefined,
              }),
            btn(TXT.reset, resetSw, { disabled: sw.running || sw.accum === 0 })));
      } else if (state.mode === 'timer') {
        const cur = tm.running ? tm.endAt - now : tm.left;
        const durSec = Math.max(0, Math.round(tm.duration / 1000));
        body = h('div', { className: 'dflk-body' },
          h('div', { className: 'dflk-time' }, fmtSpan(Math.max(0, cur))),
          h('div', { className: 'dflk-fields' },
            h('label', { className: 'dflk-nodrag' },
              h('input', {
                type: 'number', min: 0, max: 180, step: 1, disabled: tm.running,
                value: Math.floor(durSec / 60),
                onChange: (e) => setDur(Math.max(0, Math.min(180, Number(e.target.value) || 0)), durSec % 60),
              }), ' ', TXT.min),
            h('label', { className: 'dflk-nodrag' },
              h('input', {
                type: 'number', min: 0, max: 59, step: 1, disabled: tm.running,
                value: durSec % 60,
                onChange: (e) => setDur(Math.floor(durSec / 60), Math.max(0, Math.min(59, Number(e.target.value) || 0))),
              }), ' ', TXT.sec)),
          h('div', { className: 'dflk-row' },
            tm.running
              ? btn(TXT.pause, pauseTm)
              : btn(TXT.start, startTm, {
                primary: true, disabled: blocked('timer') || tm.duration <= 0,
                title: blocked('timer') ? TXT.busy : tm.duration <= 0 ? TXT.setFirst : undefined,
              }),
            btn(TXT.reset, resetTm, { disabled: tm.running })));
      } else {
        body = h('div', { className: 'dflk-body' },
          h('div', { className: 'dflk-time' }, `${pad(al.hour)}:${pad(al.minute)}`),
          h('div', { className: 'dflk-fields' },
            h('label', { className: 'dflk-nodrag' },
              h('input', {
                type: 'number', min: 0, max: 23, step: 1, disabled: al.on,
                value: al.hour,
                onChange: (e) => setState((s) => ({ ...s, alarm: { ...s.alarm, hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) } })),
              }), ' ', TXT.hour),
            h('label', { className: 'dflk-nodrag' },
              h('input', {
                type: 'number', min: 0, max: 59, step: 1, disabled: al.on,
                value: al.minute,
                onChange: (e) => setState((s) => ({ ...s, alarm: { ...s.alarm, minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)) } })),
              }), ' ', TXT.min)),
          h('label', { className: 'dflk-check dflk-nodrag' },
            h('input', {
              type: 'checkbox', checked: al.repeat, disabled: al.on,
              onChange: (e) => setState((s) => ({ ...s, alarm: { ...s.alarm, repeat: e.target.checked } })),
            }), ' ', TXT.repeatDaily),
          h('div', { className: 'dflk-msg dflk-nodrag' },
            h('input', {
              type: 'text', maxLength: 40, value: al.message || '',
              placeholder: TXT.msgHint,
              onChange: (e) => setState((s) => ({ ...s, alarm: { ...s.alarm, message: e.target.value } })),
            })),
          h('div', { className: 'dflk-row' },
            al.on
              ? btn(TXT.stop, unarmAlarm, { danger: true })
              : btn(TXT.arm, armAlarm, {
                primary: true, disabled: blocked('alarm'),
                title: blocked('alarm') ? TXT.busy : undefined,
              })));
      }

      const head = h('div', { className: 'dflk-head', onPointerDown, onPointerUp },
        h('span', { className: 'dflk-head-title' }, TXT.title),
        h('span', { className: 'dflk-grip' }, '⋮⋮'),
        h('button', {
          className: 'dflk-min dflk-nodrag', title: TXT.collapse,
          onClick: (e) => { e.stopPropagation(); touch(); setCollapsed(true); },
        }, '–'));

      const bar = h('div', { className: 'dflk-tabs dflk-nodrag' },
        ['clock', 'stopwatch', 'timer', 'alarm'].map((m) => h('button', {
          key: m,
          className: `dflk-tab${state.mode === m ? ' dflk-tab-on' : ''}`,
          onClick: () => {
            touch();
            setState((s) => {
              if (s.mode === m) return s;
              const next = { ...s, mode: m };
              // 离开页签时，已暂停的正计时归零；仍在运行的不打断
              if (s.mode === 'stopwatch' && !s.stopwatch.running && s.stopwatch.accum > 0) {
                next.stopwatch = { running: false, startedAt: 0, accum: 0 };
              }
              // 离开页签时，已暂停/已结束的倒计时回到设定时长；仍在运行的不打断
              if (s.mode === 'timer' && !s.timer.running && s.timer.left !== s.timer.duration) {
                next.timer = { running: false, endAt: 0, duration: s.timer.duration, left: s.timer.duration };
              }
              return next;
            });
          },
        }, TXT[m])));

      const ring = alert ? h('div', { className: 'dflk-ring' },
        h('span', { className: 'dflk-ring-text' },
          alert === 'ringing' && al.message ? al.message : (alert === 'done' ? TXT.done : TXT.ringing)),
        h('div', { className: 'dflk-row' },
          btn(TXT.dismiss, () => setAlert(null), { danger: true }),
          alert === 'ringing' && al.repeat
            ? btn(TXT.snooze, () => {
              setAlert(null);
              setState((s) => ({
                ...s,
                alarm: { ...s.alarm, on: true, targetAt: Date.now() + SNOOZE_MS },
              }));
            })
            : null)) : null;

      // --- collapsed pill ---------------------------------------------------------
      if (collapsed) {
        let task = null, label = null;
        if (sw.running) { task = fmtSpan(swMs); label = TXT.stopwatch; }
        else if (tm.running) { task = fmtSpan(Math.max(0, tm.endAt - now)); label = TXT.timer; }
        else if (al.on && al.targetAt) {
          const d = new Date(al.targetAt);
          task = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
          label = TXT.alarm;
        }
        if (alert) {
          task = alert === 'ringing' && al.message ? al.message : (alert === 'done' ? TXT.done : TXT.ringing);
          label = TXT.alarm;
        }
        const showTask = task && !rotate;
        return h('div', {
          ref: rootRef, className: 'dflk-root dflk-pill',
          style: { left: pos.x, top: pos.y, width: PILL_W, ...paletteStyle },
          onPointerDown, onPointerMove, onPointerUp, onClick: onPillClick,
          title: TXT.clock + ' · ' + TXT.expand,
        },
        showTask
          ? h('span', { className: 'dflk-pill-label' }, label)
          : h('span', { className: 'dflk-pill-label dflk-pill-label-dim' }, TXT.clock),
        h('span', { className: 'dflk-pill-text' }, showTask ? task : fmtClock(new Date(now))));
      }

      return h('div', {
        ref: rootRef, className: 'dflk-root',
        style: { left: pos.x, top: pos.y, width: W, ...paletteStyle },
        onPointerMove, onPointerUp,
      }, head, bar, body, ring);
    }

    // ---------------------------------------------------------------- css
    const CSS = `
.dflk-root{
  position:fixed;z-index:9999;
  box-sizing:border-box;
  background:var(--dflk-bg,var(--dsw-alias-bg-overlay,#23272e));
  border:1px solid var(--dflk-border2,var(--dsw-alias-border-l2,#454c54));
  border-radius:12px;
  box-shadow:0 10px 30px rgba(0,0,0,.32);
  color:var(--dflk-text,var(--dsw-alias-label-primary,#e6e6e6));
  font:12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;
  user-select:none;overflow:hidden;touch-action:none;
}
.dflk-pill{display:flex;align-items:center;gap:7px;height:${PILL_H}px;padding:0 12px;cursor:grab;border-radius:999px;justify-content:space-between}
.dflk-pill-label{font-size:10px;color:var(--dflk-text-dim,var(--dsw-alias-label-secondary,#9aa4af));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:88px}
.dflk-pill-label-dim{opacity:.7}
.dflk-pill-text{font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;white-space:nowrap}
.dflk-head{display:flex;align-items:center;gap:6px;padding:7px 8px 2px;cursor:grab}
.dflk-head-title{font-weight:600;font-size:11px;color:var(--dflk-text-dim,var(--dsw-alias-label-secondary,#9aa4af))}
.dflk-grip{flex:1;text-align:center;color:var(--dflk-text-dim,var(--dsw-alias-label-secondary,#9aa4af));letter-spacing:-2px;opacity:.6}
.dflk-min{width:20px;height:20px;border:none;border-radius:6px;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0}
.dflk-min:hover{background:var(--dflk-bg2,var(--dsw-alias-bg-layer-2,#2b3038))}
.dflk-tabs{display:flex;gap:2px;padding:3px;margin:0 10px 8px;background:var(--dflk-bg1,var(--dsw-alias-bg-layer-1,#171b20));border-radius:8px}
.dflk-tab{flex:1;border:none;background:transparent;color:var(--dflk-text-dim,var(--dsw-alias-label-secondary,#9aa4af));padding:4px 2px;border-radius:6px;cursor:pointer;font:inherit}
.dflk-tab:hover{color:var(--dflk-text,var(--dsw-alias-label-primary,#e6e6e6))}
.dflk-tab-on{background:var(--dflk-bg2,var(--dsw-alias-bg-layer-2,#2b3038));color:var(--dflk-accent,var(--dsw-alias-brand-primary,#2f7fd8))}
.dflk-body{padding:0 12px 12px}
.dflk-time{font-size:26px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums;letter-spacing:.5px;padding:2px 0 8px}
.dflk-sub{text-align:center;color:var(--dflk-text-dim,var(--dsw-alias-label-secondary,#9aa4af));font-size:11px}
.dflk-fields{display:flex;gap:8px;justify-content:center;margin:0 0 8px}
.dflk-fields label{display:flex;align-items:center;gap:4px;color:var(--dflk-text-dim,var(--dsw-alias-label-secondary,#9aa4af))}
.dflk-fields input{width:46px;padding:3px 4px;border-radius:6px;border:1px solid var(--dflk-border1,var(--dsw-alias-border-l1,#30363d));background:var(--dflk-bg1,var(--dsw-alias-bg-layer-1,#171b20));color:var(--dflk-text-strong,var(--dsw-alias-label-primary,#e6e6e6));font:inherit;text-align:center}
.dflk-fields input:disabled{opacity:.5}
.dflk-check{display:flex;align-items:center;justify-content:center;gap:5px;color:var(--dflk-text-dim,var(--dsw-alias-label-secondary,#9aa4af));margin:0 0 8px;cursor:pointer}
.dflk-msg{display:flex;justify-content:center;margin:0 0 8px}
.dflk-msg input{width:100%;max-width:180px;padding:4px 8px;border-radius:6px;border:1px solid var(--dflk-border1,var(--dsw-alias-border-l1,#30363d));background:var(--dflk-bg1,var(--dsw-alias-bg-layer-1,#171b20));color:var(--dflk-text-strong,var(--dsw-alias-label-primary,#e6e6e6));font:inherit;text-align:center}
.dflk-msg input::placeholder{color:var(--dflk-text-dim,var(--dsw-alias-label-secondary,#9aa4af));opacity:.8}
.dflk-row{display:flex;gap:6px;justify-content:center}
.dflk-btn{padding:5px 12px;border-radius:7px;border:1px solid var(--dflk-border1,var(--dsw-alias-border-l1,#30363d));background:var(--dflk-bg1,var(--dsw-alias-bg-layer-1,#171b20));color:var(--dflk-text-strong,var(--dsw-alias-label-primary,#e6e6e6));cursor:pointer;font:inherit}
.dflk-btn:hover:not(:disabled){border-color:var(--dflk-border2,var(--dsw-alias-border-l2,#454c54))}
.dflk-btn:disabled{opacity:.4;cursor:not-allowed}
.dflk-btn-primary{border-color:var(--dflk-accent,var(--dsw-alias-brand-primary,#2f7fd8));color:var(--dflk-accent,var(--dsw-alias-brand-primary,#2f7fd8));font-weight:600}
.dflk-btn-primary:hover:not(:disabled){background:var(--dflk-bg2,var(--dsw-alias-bg-layer-2,#2b3038))}
.dflk-btn-danger{color:var(--dflk-danger,var(--dsw-alias-state-error-primary,#f0616d))}
.dflk-ring{margin:0 12px 12px;padding:8px;border-radius:9px;background:var(--dflk-bg1,var(--dsw-alias-bg-layer-1,#171b20));border:1px solid var(--dflk-warn,var(--dsw-alias-state-warn-primary,#e0a132));animation:dflk-pulse 1s ease-in-out infinite}
.dflk-ring-text{display:block;text-align:center;font-weight:600;margin-bottom:7px;color:var(--dflk-warn,var(--dsw-alias-state-warn-primary,#e0a132));word-break:break-all}
@keyframes dflk-pulse{50%{border-color:var(--dflk-accent,var(--dsw-alias-brand-primary,#2f7fd8))}}
.dflk-set{display:flex;flex-direction:column;gap:10px}
.dflk-set-label{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dflk-swatches{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.dflk-swatch{width:26px;height:26px;border-radius:999px;border:2px solid transparent;cursor:pointer;padding:0}
.dflk-swatch:hover{transform:scale(1.08)}
.dflk-swatch-on{border-color:var(--dsw-alias-label-primary,#e6e6e6);box-shadow:0 0 0 2px var(--dsw-alias-bg-overlay,#23272e) inset}
.dflk-swatch-auto{background:transparent;border:1px dashed var(--dsw-alias-border-l2,#454c54);display:flex;align-items:center;justify-content:center}
.dflk-swatch-auto.dflk-swatch-on{border:2px solid var(--dsw-alias-label-primary,#e6e6e6)}
.dflk-swatch-auto-mark{font-size:12px;font-weight:700;color:var(--dsw-alias-label-secondary,#9aa4af)}
.dflk-set-hint{font-size:11px;color:var(--dsw-alias-label-secondary,#9aa4af);line-height:1.5}
.dflk-set-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-primary,#e6e6e6);cursor:pointer;margin-top:2px}
.dflk-set-sublabel{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa4af)}
.dflk-hex-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dflk-hex-preview{width:22px;height:22px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#454c54);flex:none}
.dflk-hex-input{width:96px;padding:5px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,#30363d);background:var(--dsw-alias-bg-layer-1,#171b20);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-family:ui-monospace,Consolas,monospace;text-transform:lowercase}
.dflk-hex-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#2f7fd8)}
.dflk-hex-input-bad{border-color:var(--dsw-alias-state-error-primary,#f0616d)}
.dflk-hex-apply{padding:5px 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,#30363d);background:var(--dsw-alias-bg-layer-1,#171b20);color:var(--dsw-alias-label-primary,#e6e6e6);cursor:pointer;font:inherit}
.dflk-hex-apply:hover{border-color:var(--dsw-alias-border-l2,#454c54)}
.dflk-hex-error{font-size:11px;color:var(--dsw-alias-state-error-primary,#f0616d)}
`;

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const styles = ctx.get('styles');
          if (styles && typeof styles.insert === 'function') return styles.insert(CSS);
          const el = document.createElement('style');
          el.textContent = CSS;
          document.head.appendChild(el);
          return () => el.remove();
        }, 'floating-clock-styles');

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'floating-clock', order: 90,
        }, Clock));

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'floating-clock', order: 60,
          label: TXT.settings,
        }, ClockSettings));
      },
    };
  },
});
