import { GruaPLC, GruaPlanta, GRUA_ESTADOS, PIEZA_ALTO } from './grua-plc.js';
import { ParqPLC, ParqPlanta, PARQ_ESTADOS } from './parq-plc.js';

const $ = (s, r = document) => r.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const SCAN = 10; // ms por ciclo de scan

// ---------------------------------------------------------------- utilidades
class Runner {
  constructor(step, render) { this.step = step; this.render = render; this.speed = 1; this.acc = 0; this.t = 0; this.active = false; this.last = 0; }
  start() { this.active = true; this.last = performance.now(); requestAnimationFrame(ts => this.loop(ts)); }
  stop() { this.active = false; }
  loop(ts) {
    if (!this.active) return;
    const real = Math.min(100, ts - this.last); this.last = ts;
    this.acc += real * this.speed;
    while (this.acc >= SCAN) { this.acc -= SCAN; this.t += SCAN; this.step(SCAN); }
    this.render();
    requestAnimationFrame(t => this.loop(t));
  }
}

function momentary(btn, set) {
  let downAt = 0, timer = null;
  const press = () => { clearTimeout(timer); downAt = performance.now(); set(true); btn.classList.add('is-pressed'); };
  const release = () => {
    if (!btn.classList.contains('is-pressed')) return;
    const left = Math.max(0, 160 - (performance.now() - downAt));
    timer = setTimeout(() => { set(false); btn.classList.remove('is-pressed'); }, left);
  };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch {} press(); });
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } });
  btn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') release(); });
}

function speedSeg(el, runner) {
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x === b));
    runner.speed = +b.dataset.s;
  });
}

function makeLog(el) {
  return (t, msg, cls = '') => {
    const li = document.createElement('li');
    li.innerHTML = `<time>${(t / 1000).toFixed(1).padStart(6, ' ')}s</time><span class="${cls}">${msg}</span>`;
    el.appendChild(li);
    while (el.children.length > 160) el.firstChild.remove();
    el.scrollTop = el.scrollHeight;
  };
}

function buildStates(el, names, carry = [], alarm = []) {
  el.innerHTML = names.map((n, i) =>
    `<li data-i="${i}" class="${carry.includes(i) ? 'carry' : ''} ${alarm.includes(i) ? 'alarm' : ''}"><span>${String(i).padStart(2, '0')}</span>${n}</li>`).join('');
  let prev = -1;
  return i => { if (i === prev) return; el.children[prev]?.classList.remove('on'); el.children[i]?.classList.add('on'); prev = i; };
}

function buildIO(el, ins, outs) {
  const col = (title, list, cls) => `<div class="io-col"><h4>${title}</h4>${list.map(([d, n]) =>
    `<div class="led ${cls}" data-n="${n}"><i></i><em>${d}</em>${n}</div>`).join('')}</div>`;
  el.innerHTML = col('ENTRADAS', ins, 'in') + col('SALIDAS', outs, 'out');
  const leds = [...el.querySelectorAll('.led')];
  return vals => leds.forEach(l => l.classList.toggle('on', !!vals[l.dataset.n]));
}

function buildWatch(el, keys) {
  el.innerHTML = keys.map(([k]) => `<dt>${k}</dt><dd data-k="${k}">–</dd>`).join('');
  const dds = keys.map(([k, fmt]) => [el.querySelector(`[data-k="${k}"]`), fmt]);
  return v => dds.forEach(([dd, fmt]) => {
    const val = fmt(v); if (dd.textContent !== String(val)) dd.textContent = val;
    dd.classList.toggle('on', val === 'TRUE');
  });
}
const B = x => (x ? 'TRUE' : 'FALSE');

// ============================================================ PUENTE GRÚA
const grua = (() => {
  const plc = new GruaPLC(), plant = new GruaPlanta();
  const inp = { P_INICIO: false, DETENER: false, SW1: false, SW2: false };
  const log = makeLog($('#g-log'));
  const svg = $('#g-svg');
  const NOMBRE = { G: 'grande', M: 'mediana', P: 'pequeña' };
  let Y = {}, X = {}, prevEstado = 0, prevCarga = null;

  const PX = x => 140 + x * 180;
  const FLOOR = 342, TOP = 104, ZR = FLOOR - TOP;
  const ZY = z => TOP + z * ZR;
  const TH = PIEZA_ALTO * ZR;
  const W = { G: 132, M: 98, P: 66 };
  const COL = { G: '#ff2e88', M: '#00e5ff', P: '#f7d046' };

  svg.innerHTML = `
    <defs>
      <linearGradient id="g-beam" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#1b2140"/><stop offset="1" stop-color="#0d1020"/></linearGradient>
      <filter id="g-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <g stroke="#2b3357" stroke-width="2">
      <line x1="40" y1="54" x2="40" y2="${FLOOR}"/><line x1="600" y1="54" x2="600" y2="${FLOOR}"/>
    </g>
    <rect x="30" y="40" width="580" height="14" rx="2" fill="url(#g-beam)" stroke="#00e5ff" stroke-opacity=".55"/>
    <line x1="22" y1="${FLOOR}" x2="618" y2="${FLOOR}" stroke="#2b3357" stroke-width="2"/>
    ${[0, 1, 2].map(i => `
      <rect x="${PX(i) - 76}" y="${FLOOR}" width="152" height="6" fill="#141932"/>
      <text x="${PX(i)}" y="${FLOOR + 30}" text-anchor="middle" class="g-lbl" fill="#7a84a6" font-family="JetBrains Mono, ui-monospace, monospace" font-size="12" letter-spacing="2">P${i + 1}</text>
      <text x="${PX(i)}" y="${FLOOR + 46}" text-anchor="middle" fill="#4f5a80" font-family="JetBrains Mono, ui-monospace, monospace" font-size="9.5">X${i} · ${['IZQ', 'CENTRO', 'DER'][i]}</text>
      <circle id="g-s${i}" cx="${PX(i)}" cy="34" r="4" fill="#1d2238" stroke="#2d3555"/>`).join('')}
    <g id="g-dyn"></g>
    <g font-family="JetBrains Mono, ui-monospace, monospace" font-size="9.5" fill="#4f5a80">
      <circle id="g-sup" cx="58" cy="74" r="4" fill="#1d2238" stroke="#2d3555"/><text x="68" y="77.5">X3 ARRIBA</text>
      <circle id="g-sdn" cx="58" cy="90" r="4" fill="#1d2238" stroke="#2d3555"/><text x="68" y="93.5">X4 ABAJO</text>
    </g>`;
  const dyn = $('#g-dyn');

  const piece = (k, cx, yTop) => {
    const w = W[k];
    return `<g><rect x="${cx - w / 2}" y="${yTop}" width="${w}" height="${TH - 2}" rx="3" fill="${COL[k]}" fill-opacity=".16" stroke="${COL[k]}" stroke-width="1.6"/>
      <line x1="${cx - w / 2 + 6}" y1="${yTop + 5}" x2="${cx + w / 2 - 6}" y2="${yTop + 5}" stroke="${COL[k]}" stroke-opacity=".45"/>
      <text x="${cx}" y="${yTop + TH / 2 + 4}" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-weight="700" font-size="12" fill="${COL[k]}">${k}</text></g>`;
  };

  function render() {
    const tx = PX(plant.x), hy = ZY(plant.z);
    let s = '';
    for (const p of [1, 2, 3]) plant.pilas[p].forEach((k, i) => { s += piece(k, PX(p - 1), FLOOR - (i + 1) * TH); });
    const iman = !!Y.IMAN;
    s += `<line x1="${tx - 6}" y1="66" x2="${tx - 6}" y2="${hy - 14}" stroke="#7a84a6" stroke-width="1.3"/>
      <line x1="${tx + 6}" y1="66" x2="${tx + 6}" y2="${hy - 14}" stroke="#7a84a6" stroke-width="1.3"/>
      <g ${Y.MOV_IZQ || Y.MOV_DER ? 'filter="url(#g-glow)"' : ''}>
        <rect x="${tx - 30}" y="50" width="60" height="18" rx="3" fill="#121628" stroke="#ff2e88" stroke-width="1.6"/>
        <circle cx="${tx - 18}" cy="49" r="4" fill="#06070d" stroke="#ff2e88"/><circle cx="${tx + 18}" cy="49" r="4" fill="#06070d" stroke="#ff2e88"/>
        <text x="${tx}" y="63" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-size="8.5" fill="#ff2e88">${Y.MOV_IZQ ? '◀' : Y.MOV_DER ? '▶' : Y.SUBIR ? '▲' : Y.BAJAR ? '▼' : '■'}</text>
      </g>
      <rect x="${tx - 28}" y="${hy - 14}" width="56" height="14" rx="2" fill="${iman ? '#ff2e88' : '#1a1f38'}" stroke="${iman ? '#ff9cc6' : '#4f5a80'}" ${iman ? 'filter="url(#g-glow)"' : ''}/>
      <text x="${tx}" y="${hy - 4}" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-size="8" fill="${iman ? '#06070d' : '#7a84a6'}" font-weight="700">${iman ? 'ON' : 'IMÁN'}</text>`;
    if (plant.carga) s += piece(plant.carga, tx, hy);
    dyn.innerHTML = s;

    const S = X;
    [S.SEN_IZQ, S.SEN_CEN, S.SEN_DER].forEach((on, i) => {
      const c = $(`#g-s${i}`); c.setAttribute('fill', on ? '#35f2a1' : '#1d2238'); c.setAttribute('stroke', on ? '#35f2a1' : '#2d3555');
    });
    for (const [id, on] of [['#g-sup', S.SEN_ARRIBA], ['#g-sdn', S.SEN_ABAJO]]) { const c = $(id); c.setAttribute('fill', on ? '#35f2a1' : '#1d2238'); c.setAttribute('stroke', on ? '#35f2a1' : '#2d3555'); }

    const v = plc.v;
    setStates(v.ESTADO);
    $('#g-state-pill').textContent = `E${v.ESTADO} · ${GRUA_ESTADOS[v.ESTADO]}`;
    $('#g-movs').textContent = plant.movs;
    $('#g-paso').textContent = `${Math.min(v.PASO, v.N_MOV)} / ${v.N_MOV}`;
    $('#g-od').textContent = v.PASO >= v.N_MOV ? 'completo' : `P${v.ORIGEN} → P${v.DESTINO}`;
    setIO({ ...X, ...inp, ...Y });
    setWatch(v);
  }

  function step(dt) {
    X = { ...plant.sensores(), ...inp };
    Y = plc.scan(X, dt);
    plant.step(Y, dt);
    const v = plc.v, t = runner.t;
    if (plant.carga && !prevCarga) log(t, `Toma pieza ${NOMBRE[plant.carga]} en P${plant.punto()}`, 't-hot');
    if (!plant.carga && prevCarga) log(t, `Suelta pieza ${NOMBRE[prevCarga]} en P${plant.punto()} · movimiento ${plant.movs}`, 't-hot');
    prevCarga = plant.carga;
    if (v.ESTADO !== prevEstado) {
      if (v.ESTADO === 0 && v.PASO >= v.N_MOV && v.PASO > 0) {
        const ok = plant.pilas[2].join('') === 'PMG' && !plant.pilas[1].length && !plant.pilas[3].length;
        log(t, ok ? `Secuencia completa: ${plant.movs} movimientos, P2 = G/M/P ✓` : 'Secuencia terminada (revisa la pila inicial y los SW)', ok ? 't-ok' : 't-warn');
      } else if (v.ESTADO === 0 && prevEstado !== 0) log(t, `Detenido en el paso ${v.PASO + 1 > v.N_MOV ? v.N_MOV : v.PASO + 1} de ${v.N_MOV}. Inicio continúa`, 't-warn');
      else log(t, `E${prevEstado} → E${v.ESTADO} ${GRUA_ESTADOS[v.ESTADO]}`);
      prevEstado = v.ESTADO;
    }
  }

  const runner = new Runner(step, render);
  const setStates = buildStates($('#g-states'), GRUA_ESTADOS, [5, 6, 7, 8, 9, 10]);
  const setIO = buildIO($('#g-io'),
    [['X0', 'SEN_IZQ'], ['X1', 'SEN_CEN'], ['X2', 'SEN_DER'], ['X3', 'SEN_ARRIBA'], ['X4', 'SEN_ABAJO'], ['X20', 'SW1'], ['X21', 'P_INICIO'], ['X22', 'DETENER'], ['X23', 'SW2']],
    [['Y0', 'BAJAR'], ['Y1', 'SUBIR'], ['Y2', 'IMAN'], ['Y3', 'MOV_IZQ'], ['Y4', 'MOV_DER']]);
  const setWatch = buildWatch($('#g-watch'), [
    ['ESTADO', v => v.ESTADO], ['PASO', v => v.PASO], ['N_MOV', v => v.N_MOV], ['ORIGEN', v => v.ORIGEN], ['DESTINO', v => v.DESTINO],
    ['OBJ', v => v.OBJ], ['POS_ACT', v => v.POS_ACT], ['DIR', v => v.DIR], ['PARAR', v => B(v.PARAR)], ['CFG_DESC', v => B(v.CFG_DESC)], ['CFG_P3', v => B(v.CFG_P3)],
  ]);

  const swTxt = () => {
    $('#g-sw1-txt').textContent = inp.SW1 ? 'Descendente' : 'Ascendente';
    $('#g-sw2-txt').textContent = inp.SW2 ? 'Piezas en P3' : 'Piezas en P1';
  };
  $('#g-sw1').addEventListener('change', e => { inp.SW1 = e.target.checked; swTxt(); });
  $('#g-sw2').addEventListener('change', e => { inp.SW2 = e.target.checked; swTxt(); });
  const armar = () => {
    plant.reset(inp.SW1, inp.SW2); plc.powerOn(); prevEstado = 0; prevCarga = null;
    log(runner.t, `Pila ${inp.SW1 ? 'descendente' : 'ascendente'} armada en P${inp.SW2 ? 3 : 1} (SW1=${+inp.SW1}, SW2=${+inp.SW2}). PLC en RUN`, 't-ok');
  };
  $('#g-armar').addEventListener('click', armar);
  $('#g-reset').addEventListener('click', () => { plc.powerOn(); prevEstado = 0; log(runner.t, 'PLC STOP → RUN (M8002): ESTADO = 0, PASO = 0', 't-warn'); });
  momentary($('#g-inicio'), on => { inp.P_INICIO = on; });
  momentary($('#g-detener'), on => { inp.DETENER = on; if (on) log(runner.t, 'DETENER oprimido', 't-warn'); });
  speedSeg($('#g-speed'), runner);

  armar();
  return runner;
})();

// ============================================================ PARQUEADERO
const parq = (() => {
  const plc = new ParqPLC(), plant = new ParqPlanta();
  const inp = { P_ENTRAR: false, P_SACAR: false, DETENER: false };
  const log = makeLog($('#p-log'));
  const svg = $('#p-svg');
  let Y = {}, X = {}, prevEstado = 0, salida = 0;

  const FY = f => 472 - (f - 1) * 106;
  const CX = x => 320 + x * 140;
  const SPOT = l => (l === 0 ? 115 : 525);
  const LBL = ['IZQ', 'DER'];

  let st = `<defs><filter id="p-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  st += `<rect x="30" y="40" width="580" height="${FY(1) - 34}" rx="4" fill="none" stroke="#1f2540"/>`;
  st += `<line x1="268" y1="44" x2="268" y2="${FY(1)}" stroke="#2b3357" stroke-dasharray="4 4"/><line x1="372" y1="44" x2="372" y2="${FY(1)}" stroke="#2b3357" stroke-dasharray="4 4"/>`;
  for (let f = 1; f <= 4; f++) {
    const y = FY(f);
    st += `<rect x="34" y="${y}" width="200" height="5" fill="#141932"/><rect x="406" y="${y}" width="200" height="5" fill="#141932"/>`;
    for (const l of [0, 1]) {
      const pos = (f - 1) * 2 + l;
      st += `<text x="${SPOT(l)}" y="${y - 72}" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-size="10" fill="#4f5a80" letter-spacing="1">P${f}·${LBL[l]} <tspan fill="#2f3858">[${pos}]</tspan></text>
        <rect id="p-slot${pos}" x="${SPOT(l) - 62}" y="${y - 62}" width="124" height="60" rx="4" fill="none" stroke="#1f2540" stroke-dasharray="3 5"/>`;
    }
    st += `<circle id="p-fs${f}" cx="258" cy="${y - 10}" r="4" fill="#1d2238" stroke="#2d3555"/><text x="250" y="${y - 6}" text-anchor="end" font-family="JetBrains Mono, ui-monospace, monospace" font-size="9" fill="#4f5a80">X${f - 1}</text>`;
  }
  st += `<text x="320" y="${FY(1) + 30}" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-size="11" fill="#35f2a1" letter-spacing="2">▲ ENTRADA · 입구</text>`;
  st += `<g id="p-dyn"></g>`;
  st += `<g transform="translate(588 24)"><circle id="p-lamp" r="9" fill="#1d2238" stroke="#2d3555"/><text x="-16" y="4" text-anchor="end" font-family="JetBrains Mono, ui-monospace, monospace" font-size="9.5" fill="#4f5a80">Y6 ALARMA</text></g>`;
  svg.innerHTML = st;
  const dyn = $('#p-dyn');

  const car = (c, cx, yb, ghost = false) => {
    const col = `hsl(${c.hue} 100% 62%)`;
    return `<g opacity="${ghost ? .55 : 1}"><rect x="${cx - 40}" y="${yb - 22}" width="80" height="16" rx="5" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="1.5"/>
      <path d="M${cx - 22} ${yb - 22} L${cx - 14} ${yb - 33} H${cx + 14} L${cx + 22} ${yb - 22}" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="1.4"/>
      <circle cx="${cx - 24}" cy="${yb - 5}" r="5" fill="#06070d" stroke="${col}"/><circle cx="${cx + 24}" cy="${yb - 5}" r="5" fill="#06070d" stroke="${col}"/>
      <text x="${cx}" y="${yb - 11}" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-size="8.5" font-weight="700" fill="${col}">#${String(c.id).padStart(2, '0')}</text></g>`;
  };

  function render() {
    let s = '';
    plant.puestos.forEach((c, pos) => { if (c) s += car(c, SPOT(pos % 2), FY(Math.trunc(pos / 2) + 1) - 2); });
    const px = CX(plant.x), py = FY(plant.y);
    const side = plant.x < -0.5 ? -1 : plant.x > 0.5 ? 1 : 0;
    const fork = side * plant.ext * 65;
    s += `<line x1="${px}" y1="40" x2="${px}" y2="${py - 46}" stroke="#4f5a80" stroke-width="1.2"/>
      <g ${Y.SUBIR || Y.BAJAR || Y.MOV_DER || Y.MOV_IZQ ? 'filter="url(#p-glow)"' : ''}>
        <rect x="${px - 50}" y="${py - 2}" width="100" height="8" rx="2" fill="#121628" stroke="#ff2e88" stroke-width="1.6"/>
        <path d="M${px - 50} ${py - 2} V${py - 48} H${px + 50} V${py - 2}" fill="none" stroke="#ff2e88" stroke-opacity=".35"/>
      </g>
      <rect x="${px - 36 + fork}" y="${py - 5}" width="72" height="4" rx="1" fill="${plant.ext > 0.01 ? '#00e5ff' : '#2b3357'}"/>`;
    if (plant.carga) s += car(plant.carga, px + fork, py - 4);
    dyn.innerHTML = s;

    for (let f = 1; f <= 4; f++) { const c = $(`#p-fs${f}`); const on = X['PISO' + f]; c.setAttribute('fill', on ? '#35f2a1' : '#1d2238'); c.setAttribute('stroke', on ? '#35f2a1' : '#2d3555'); }
    const lamp = $('#p-lamp');
    lamp.setAttribute('fill', Y.ALARMA ? '#f7d046' : '#1d2238'); lamp.setAttribute('stroke', Y.ALARMA ? '#f7d046' : '#2d3555');
    lamp.setAttribute('filter', Y.ALARMA ? 'url(#p-glow)' : '');
    const v = plc.v;
    for (let i = 0; i < 8; i++) $(`#p-slot${i}`).setAttribute('stroke', v.ESTADO && v.ESTADO < 9 && v.POS === i ? '#00e5ff' : '#1f2540');

    setStates(v.ESTADO);
    const pill = $('#p-state-pill');
    pill.textContent = `E${v.ESTADO} · ${PARQ_ESTADOS[v.ESTADO]}`;
    pill.classList.toggle('alarm', v.ESTADO >= 9);
    $('#p-num').textContent = `${v.NUM_CARROS ?? 0} / 8`;
    $('#p-dest').textContent = v.ESTADO >= 1 && v.ESTADO <= 8 && v.OPER ? `[${v.POS}] P${v.PISO_OBJ}·${LBL[v.LADO_OBJ]}` : '–';
    $('#p-alarm').textContent = Y.ALARMA ? 'ON' : 'OFF';
    setIO({ ...X, ...inp, ...Y });
    setWatch(v);
    setBits(v.OCUPADO || []);
  }

  function step(dt) {
    X = { ...plant.sensores(), ...inp };
    Y = plc.scan(X, dt);
    plant.step(Y, dt);
    const v = plc.v, t = runner.t;
    if (plant.evento) {
      const e = plant.evento; plant.evento = null;
      log(t, e.tipo === 'deja' ? `Carro dejado en el puesto [${e.pos}]` : `Carro tomado del puesto [${e.pos}]`, 't-hot');
    }
    if (v.ESTADO === 0 && plant.carga && plant.carga.sale && X.PISO1 && X.SEN_CEN) {
      salida += dt;
      if (salida > 900) { log(t, `Carro #${String(plant.carga.id).padStart(2, '0')} entregado en la entrada`, 't-ok'); plant.carga = null; salida = 0; }
    } else salida = 0;
    if (v.ESTADO !== prevEstado) {
      if (v.ESTADO === 9 && prevEstado === 0) log(t, v.LLENO && !v.VACIO ? 'Sin cupo → alarma ×3' : 'Sin carros → alarma ×3', 't-warn');
      else if (v.ESTADO < 9 && prevEstado < 9) log(t, `E${prevEstado} → E${v.ESTADO} ${PARQ_ESTADOS[v.ESTADO]}`);
      prevEstado = v.ESTADO;
    }
  }

  const runner = new Runner(step, render);
  const setStates = buildStates($('#p-states'), PARQ_ESTADOS, [], [9, 10]);
  const setIO = buildIO($('#p-io'),
    [['X0', 'PISO1'], ['X1', 'PISO2'], ['X2', 'PISO3'], ['X3', 'PISO4'], ['X4', 'SEN_IZQ'], ['X5', 'SEN_CEN'], ['X6', 'SEN_DER'], ['X7', 'MEC_AFUERA'], ['X10', 'MEC_ADENTRO'], ['X20', 'P_ENTRAR'], ['X21', 'P_SACAR'], ['X22', 'DETENER']],
    [['Y0', 'MOV_DER'], ['Y1', 'MOV_IZQ'], ['Y2', 'SUBIR'], ['Y3', 'BAJAR'], ['Y4', 'ABRIR_MEC'], ['Y5', 'CERRAR_MEC'], ['Y6', 'ALARMA']]);
  const setWatch = buildWatch($('#p-watch'), [
    ['ESTADO', v => v.ESTADO], ['OPER', v => v.OPER], ['POS', v => v.POS], ['PISO_OBJ', v => v.PISO_OBJ], ['LADO_OBJ', v => v.LADO_OBJ],
    ['POS_LIBRE', v => v.POS_LIBRE], ['POS_OCUPADA', v => v.POS_OCUPADA], ['NUM_CARROS', v => v.NUM_CARROS], ['CONT', v => v.CONT], ['EN_CASA', v => B(v.EN_CASA)],
  ]);
  const bitsEl = $('#p-bits');
  bitsEl.innerHTML = Array.from({ length: 8 }, (_, i) => `<div class="bit">[${i}]<b>0</b></div>`).join('');
  const setBits = arr => [...bitsEl.children].forEach((d, i) => { const on = !!arr[i]; d.classList.toggle('on', on); d.lastChild.textContent = on ? '1' : '0'; });

  momentary($('#p-entrar'), on => {
    if (on && plc.v.ESTADO === 0 && !plant.carga && plant.piso() === 1 && Math.abs(plant.x) < 0.02 && plant.ext < 0.01) {
      plant.carga = plant.nuevoCarro();
      log(runner.t, `Carro #${String(plant.carga.id).padStart(2, '0')} en la entrada`, 't-ok');
    }
    inp.P_ENTRAR = on;
  });
  momentary($('#p-sacar'), on => { inp.P_SACAR = on; });
  momentary($('#p-detener'), on => { inp.DETENER = on; if (on) log(runner.t, 'DETENER oprimido', 't-warn'); });
  $('#p-lleno').addEventListener('click', () => { plc.v.OCUPADO = plc.v.OCUPADO.map(() => true); log(runner.t, 'Watch: OCUPADO[0..7] := 1 (forzado)', 't-warn'); });
  $('#p-sync').addEventListener('click', () => { plc.v.OCUPADO = plant.puestos.map(Boolean); log(runner.t, 'Watch: OCUPADO igualado a los carros de la planta', 't-ok'); });
  $('#p-reset').addEventListener('click', () => { plant.reset(); plc.powerOn(); prevEstado = 0; log(runner.t, 'Planta vacía y PLC STOP → RUN (M8002)', 't-warn'); });
  speedSeg($('#p-speed'), runner);
  log(0, 'PLC en RUN. Planta en casa: piso 1, centro, mecanismo adentro', 't-ok');
  return runner;
})();

// ============================================================ pestañas y código
const CODE = {
  grua: 'assets/Reto3_PuenteGrua_Codigo_ST.txt',
  parq: 'assets/Reto3_Parqueadero_Codigo_ST.txt',
};
const cache = {};
function highlight(src) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re = /(\(\*[\s\S]*?\*\))|\b(IF|THEN|ELSIF|ELSE|END_IF|CASE|OF|END_CASE|AND|OR|NOT|MOD|TRUE|FALSE)\b|(T#\w+|\b[XYM]\d+\b)|(\b\d+\b)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    const cls = m[1] ? 'c' : m[2] ? 'k' : m[3] ? 'd' : 'n';
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = re.lastIndex;
  }
  return out + esc(src.slice(last));
}
async function showCode(which) {
  const url = CODE[which];
  $('#code-file').textContent = url.split('/').pop();
  $('#code-dl').href = url;
  if (!cache[which]) {
    try { cache[which] = (await (await fetch(url)).text()).replace(/\r\n/g, '\n'); }
    catch { cache[which] = '(* No se pudo cargar el archivo *)'; }
  }
  $('#code-body').innerHTML = highlight(cache[which]);
}
$('#code-copy').addEventListener('click', async e => {
  try { await navigator.clipboard.writeText($('#code-body').textContent); e.target.textContent = 'copiado'; }
  catch { e.target.textContent = 'error'; }
  setTimeout(() => { e.target.textContent = 'copiar'; }, 1400);
});

const runners = { grua, parq };
function selectTab(which) {
  document.querySelectorAll('.tab').forEach(t => { const on = t.dataset.tab === which; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on); });
  document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== which; });
  document.querySelectorAll('[data-show]').forEach(p => { p.hidden = p.dataset.show !== which; });
  for (const [k, r] of Object.entries(runners)) { if (k === which) { if (!r.active) r.start(); } else r.stop(); }
  showCode(which);
  try { localStorage.setItem('reto3-tab', which); } catch {}
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => selectTab(t.dataset.tab)));
document.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => { $('#' + b.dataset.clear).innerHTML = ''; }));
let initial = 'grua';
try { initial = localStorage.getItem('reto3-tab') || 'grua'; } catch {}
selectTab(initial === 'parq' ? 'parq' : 'grua');

// ============================================================ galería GX Works2
(() => {
  const items = [...document.querySelectorAll('.gx-item')];
  const dlg = $('#lightbox'); if (!dlg || !items.length) return;
  let cur = 0;
  const show = i => {
    cur = (i + items.length) % items.length;
    const it = items[cur];
    $('#lb-img').src = it.dataset.full; $('#lb-img').alt = it.dataset.cap;
    $('#lb-cap').textContent = it.dataset.cap;
    $('#lb-n').textContent = `${cur + 1} / ${items.length}`;
  };
  items.forEach((it, i) => it.addEventListener('click', () => { show(i); dlg.showModal(); }));
  $('#lb-prev').addEventListener('click', () => show(cur - 1));
  $('#lb-next').addEventListener('click', () => show(cur + 1));
  $('#lb-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); });
})();
