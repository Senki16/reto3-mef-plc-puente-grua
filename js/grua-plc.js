// Port 1:1 del programa ST del puente grúa (Reto3_PuenteGrua_Codigo_ST.txt).
// Cada llamada a scan() equivale a un ciclo de scan del PLC.
export const GRUA_ESTADOS = [
  'Reposo', 'Subir', 'Ir izq. a origen', 'Ir der. a origen', 'Bajar a recoger',
  'Energizar imán', 'Subir con pieza', 'Ir izq. a destino', 'Ir der. a destino',
  'Bajar con pieza', 'Soltar pieza'
];

class TON {
  constructor() { this.et = 0; this.Q = false; }
  call(IN, PT, dt) {
    if (IN) { this.et = Math.min(this.et + dt, PT); this.Q = this.et >= PT; }
    else { this.et = 0; this.Q = false; }
  }
}

export class GruaPLC {
  constructor() { this.v = {}; this.T_IMAN = new TON(); this.T_SOLTAR = new TON(); this.firstScan = true; }

  powerOn() { this.firstScan = true; this.T_IMAN = new TON(); this.T_SOLTAR = new TON(); }

  scan(X, dt) {
    const v = this.v;
    if (this.firstScan) { // M8002
      Object.assign(v, { ESTADO: 0, PASO: 0, PARAR: false, POS_ACT: 0, ULT_DIR: 0, CFG_DESC: false, CFG_P3: false,
        INI_ANT: false, N_MOV: 3, ORIGEN: 1, DESTINO: 2, FUENTE: 1, AUX: 3, OBJ: 1, DIR: 0, EN_OBJ: false });
      this.firstScan = false;
    }
    const { SEN_IZQ, SEN_CEN, SEN_DER, SEN_ARRIBA, SEN_ABAJO, SW1, SW2, P_INICIO, DETENER } = X;

    v.F_INICIO = P_INICIO && !v.INI_ANT;
    v.INI_ANT = P_INICIO;

    if (SEN_IZQ) v.POS_ACT = 1; else if (SEN_CEN) v.POS_ACT = 2; else if (SEN_DER) v.POS_ACT = 3;

    if (v.CFG_P3) { v.FUENTE = 3; v.AUX = 1; } else { v.FUENTE = 1; v.AUX = 3; }
    if (!v.CFG_DESC) { v.N_MOV = 3; v.ORIGEN = v.FUENTE; v.DESTINO = 2; }
    else {
      v.N_MOV = 5;
      if (v.PASO <= 1) { v.ORIGEN = v.FUENTE; v.DESTINO = v.AUX; }
      else if (v.PASO === 2) { v.ORIGEN = v.FUENTE; v.DESTINO = 2; }
      else { v.ORIGEN = v.AUX; v.DESTINO = 2; }
    }

    v.OBJ = v.ESTADO >= 6 ? v.DESTINO : v.ORIGEN;
    v.EN_OBJ = (v.OBJ === 1 && SEN_IZQ) || (v.OBJ === 2 && SEN_CEN) || (v.OBJ === 3 && SEN_DER);
    if (v.EN_OBJ) v.DIR = 0;
    else if (v.OBJ > v.POS_ACT) v.DIR = 1;
    else if (v.OBJ < v.POS_ACT) v.DIR = -1;
    else if (v.ULT_DIR === 1) v.DIR = -1;
    else v.DIR = 1;

    if (DETENER) {
      if (v.ESTADO >= 1 && v.ESTADO <= 4) v.ESTADO = 0;
      else if (v.ESTADO >= 5) v.PARAR = true;
    }

    const Y = { BAJAR: false, SUBIR: false, IMAN: false, MOV_IZQ: false, MOV_DER: false };
    switch (v.ESTADO) {
      case 0:
        if (v.F_INICIO) {
          if (v.PASO === 0 || v.PASO >= v.N_MOV) { v.PASO = 0; v.CFG_DESC = SW1; v.CFG_P3 = SW2; }
          v.PARAR = false; v.ESTADO = 1;
        }
        break;
      case 1:
        Y.SUBIR = true;
        if (SEN_ARRIBA) {
          if (v.PASO >= v.N_MOV) v.ESTADO = 0;
          else if (v.DIR === -1) v.ESTADO = 2;
          else if (v.DIR === 1) v.ESTADO = 3;
          else v.ESTADO = 4;
        }
        break;
      case 2: Y.MOV_IZQ = true; if (v.EN_OBJ) v.ESTADO = 4; else if (v.DIR === 1) v.ESTADO = 3; break;
      case 3: Y.MOV_DER = true; if (v.EN_OBJ) v.ESTADO = 4; else if (v.DIR === -1) v.ESTADO = 2; break;
      case 4: Y.BAJAR = true; if (SEN_ABAJO) v.ESTADO = 5; break;
      case 5: Y.IMAN = true; if (this.T_IMAN.Q) v.ESTADO = 6; break;
      case 6:
        Y.SUBIR = true; Y.IMAN = true;
        if (SEN_ARRIBA) v.ESTADO = v.DIR === -1 ? 7 : v.DIR === 1 ? 8 : 9;
        break;
      case 7: Y.IMAN = true; Y.MOV_IZQ = true; if (v.EN_OBJ) v.ESTADO = 9; else if (v.DIR === 1) v.ESTADO = 8; break;
      case 8: Y.IMAN = true; Y.MOV_DER = true; if (v.EN_OBJ) v.ESTADO = 9; else if (v.DIR === -1) v.ESTADO = 7; break;
      case 9: Y.BAJAR = true; Y.IMAN = true; if (SEN_ABAJO) v.ESTADO = 10; break;
      case 10:
        if (this.T_SOLTAR.Q) {
          v.PASO += 1;
          if (v.PARAR) { v.PARAR = false; v.ESTADO = 0; } else v.ESTADO = 1;
        }
        break;
    }

    this.T_IMAN.call(v.ESTADO === 5, 500, dt);
    this.T_SOLTAR.call(v.ESTADO === 10, 500, dt);

    Y.MOV_IZQ = Y.MOV_IZQ && SEN_ARRIBA && !SEN_IZQ;
    Y.MOV_DER = Y.MOV_DER && SEN_ARRIBA && !SEN_DER;
    Y.BAJAR = Y.BAJAR && !Y.SUBIR;

    if (Y.MOV_DER) v.ULT_DIR = 1; else if (Y.MOV_IZQ) v.ULT_DIR = -1;
    return Y;
  }
}

// ----------------------------------------------------------------------------
// Modelo de la planta: puente grúa con 3 puntos y piezas apiladas.
export const PIEZA_ALTO = 0.14;
export class GruaPlanta {
  constructor() { this.reset(false, false); }

  reset(desc, enP3) {
    this.x = 1;          // 0 = P1, 1 = P2, 2 = P3
    this.z = 0;          // 0 = arriba, 1 = piso
    this.carga = null;   // pieza en el electroimán
    this.pilas = { 1: [], 2: [], 3: [] }; // de abajo hacia arriba
    const pila = desc ? ['P', 'M', 'G'] : ['G', 'M', 'P'];
    this.pilas[enP3 ? 3 : 1] = pila;
    this.movs = 0;
    this.vx = 0.55; this.vz = 0.8;
  }

  punto() {
    for (const p of [1, 2, 3]) if (Math.abs(this.x - (p - 1)) < 0.012) return p;
    return 0;
  }
  superficie() {
    const p = this.punto();
    return p ? 1 - PIEZA_ALTO * this.pilas[p].length : 1;
  }
  sensores() {
    const p = this.punto();
    const fondo = this.z + (this.carga ? PIEZA_ALTO : 0);
    return {
      SEN_IZQ: p === 1, SEN_CEN: p === 2, SEN_DER: p === 3,
      SEN_ARRIBA: this.z <= 0.002,
      SEN_ABAJO: fondo >= this.superficie() - 0.003,
    };
  }

  step(Y, dt) {
    const s = dt / 1000;
    if (Y.MOV_DER) this.x = Math.min(2, this.x + this.vx * s);
    if (Y.MOV_IZQ) this.x = Math.max(0, this.x - this.vx * s);
    const lim = this.superficie() - (this.carga ? PIEZA_ALTO : 0);
    if (Y.BAJAR) this.z = Math.min(lim, this.z + this.vz * s);
    if (Y.SUBIR) this.z = Math.max(0, this.z - this.vz * s);
    const p = this.punto();
    const S = this.sensores();
    if (Y.IMAN && !this.carga && S.SEN_ABAJO && p && this.pilas[p].length) {
      this.carga = this.pilas[p].pop();
    }
    if (!Y.IMAN && this.carga) {
      if (p) { this.pilas[p].push(this.carga); this.movs += 1; }
      this.carga = null; // fuera de un punto la pieza se perdería; no ocurre con los enclavamientos
    }
  }
}
