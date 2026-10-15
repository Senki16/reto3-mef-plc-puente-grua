// Port 1:1 del programa ST del parqueadero lineal (Reto3_Codigo_ST.txt, versión 2).
export const PARQ_ESTADOS = [
  'Reposo', 'Subir a piso', 'Ir izquierda', 'Ir derecha', 'Abrir mecanismo',
  'Cerrar mecanismo', 'Volver centro (der.)', 'Volver centro (izq.)', 'Bajar a piso 1',
  'Alarma ON', 'Alarma OFF'
];

class TON {
  constructor() { this.et = 0; this.Q = false; }
  call(IN, PT, dt) {
    if (IN) { this.et = Math.min(this.et + dt, PT); this.Q = this.et >= PT; }
    else { this.et = 0; this.Q = false; }
  }
}

export class ParqPLC {
  constructor() { this.v = {}; this.firstScan = true; this.TEMP_ON = new TON(); this.TEMP_OFF = new TON(); }
  powerOn() { this.firstScan = true; this.TEMP_ON = new TON(); this.TEMP_OFF = new TON(); }

  scan(X, dt) {
    const v = this.v;
    if (this.firstScan) {
      Object.assign(v, { ESTADO: 0, OPER: 0, CONT: 0, LADO_OBJ: 0, PISO_OBJ: 1, POS: 0,
        OCUPADO: [false, false, false, false, false, false, false, false], ENT_ANT: false, SAC_ANT: false });
      this.firstScan = false;
    }
    const { PISO1, PISO2, PISO3, PISO4, SEN_IZQ, SEN_CEN, SEN_DER, MEC_AFUERA, MEC_ADENTRO, P_ENTRAR, P_SACAR, DETENER } = X;

    v.F_ENTRAR = P_ENTRAR && !v.ENT_ANT;
    v.F_SACAR = P_SACAR && !v.SAC_ANT;
    v.ENT_ANT = P_ENTRAR; v.SAC_ANT = P_SACAR;

    v.EN_PISO = PISO1 || PISO2 || PISO3 || PISO4;
    v.EN_CASA = PISO1 && SEN_CEN && MEC_ADENTRO;
    v.LLEGO_PISO = (v.PISO_OBJ === 1 && PISO1) || (v.PISO_OBJ === 2 && PISO2) ||
                   (v.PISO_OBJ === 3 && PISO3) || (v.PISO_OBJ === 4 && PISO4);

    v.POS_LIBRE = v.OCUPADO.findIndex(o => !o);
    v.POS_OCUPADA = v.OCUPADO.findIndex(o => o);
    v.LLENO = v.POS_LIBRE < 0;
    v.VACIO = v.POS_OCUPADA < 0;

    if (DETENER) v.ESTADO = 0;

    const Y = { MOV_DER: false, MOV_IZQ: false, SUBIR: false, BAJAR: false, ABRIR_MEC: false, CERRAR_MEC: false, ALARMA: false };
    switch (v.ESTADO) {
      case 0:
        if ((v.F_ENTRAR || v.F_SACAR) && !v.EN_CASA) { v.OPER = 0; v.ESTADO = 5; }
        else if (v.F_ENTRAR && v.LLENO) { v.CONT = 0; v.ESTADO = 9; }
        else if (v.F_SACAR && v.VACIO) { v.CONT = 0; v.ESTADO = 9; }
        else if (v.F_ENTRAR) { v.OPER = 1; v.POS = v.POS_LIBRE; v.PISO_OBJ = Math.trunc(v.POS / 2) + 1; v.LADO_OBJ = v.POS % 2; v.ESTADO = 1; }
        else if (v.F_SACAR) { v.OPER = 2; v.POS = v.POS_OCUPADA; v.PISO_OBJ = Math.trunc(v.POS / 2) + 1; v.LADO_OBJ = v.POS % 2; v.ESTADO = 1; }
        break;
      case 1:
        Y.SUBIR = true;
        if (v.LLEGO_PISO && v.LADO_OBJ === 0) v.ESTADO = 2;
        else if (v.LLEGO_PISO && v.LADO_OBJ === 1) v.ESTADO = 3;
        break;
      case 2: Y.MOV_IZQ = true; if (SEN_IZQ) v.ESTADO = 4; break;
      case 3: Y.MOV_DER = true; if (SEN_DER) v.ESTADO = 4; break;
      case 4:
        Y.ABRIR_MEC = true;
        if (MEC_AFUERA) {
          if (v.OPER === 1 || v.OPER === 2) { v.OCUPADO[v.POS] = v.OPER === 1; v.OPER = 0; }
          v.ESTADO = 5;
        }
        break;
      case 5:
        Y.CERRAR_MEC = true;
        if (MEC_ADENTRO) {
          if (SEN_CEN) v.ESTADO = 8;
          else if (SEN_IZQ) v.ESTADO = 6;
          else if (SEN_DER) v.ESTADO = 7;
          else if (v.LADO_OBJ === 0) v.ESTADO = 6;
          else v.ESTADO = 7;
        }
        break;
      case 6: Y.MOV_DER = true; if (SEN_CEN) v.ESTADO = 8; break;
      case 7: Y.MOV_IZQ = true; if (SEN_CEN) v.ESTADO = 8; break;
      case 8: Y.BAJAR = true; if (PISO1) v.ESTADO = 0; break;
      case 9: Y.ALARMA = true; if (this.TEMP_ON.Q) { v.CONT += 1; v.ESTADO = 10; } break;
      case 10:
        if (this.TEMP_OFF.Q && v.CONT < 3) v.ESTADO = 9;
        else if (this.TEMP_OFF.Q && v.CONT >= 3) v.ESTADO = 0;
        break;
    }

    this.TEMP_ON.call(v.ESTADO === 9, 500, dt);
    this.TEMP_OFF.call(v.ESTADO === 10, 500, dt);

    Y.SUBIR = Y.SUBIR && SEN_CEN;
    Y.BAJAR = Y.BAJAR && SEN_CEN;
    Y.MOV_DER = Y.MOV_DER && v.EN_PISO;
    Y.MOV_IZQ = Y.MOV_IZQ && v.EN_PISO;

    v.NUM_CARROS = v.OCUPADO.filter(Boolean).length;
    return Y;
  }
}

// ----------------------------------------------------------------------------
// Planta: torre de 4 pisos, 2 puestos por piso, elevador central con carro lateral.
let carId = 0;
export class ParqPlanta {
  constructor() { this.reset(); }
  reset() {
    this.y = 1;           // piso continuo 1..4
    this.x = 0;           // -1 izquierda, 0 centro, 1 derecha
    this.ext = 0;         // mecanismo 0 adentro .. 1 afuera
    this.carga = null;    // carro sobre el elevador
    this.puestos = Array(8).fill(null);
    this.vy = 0.55; this.vx = 0.9; this.vm = 0.9;
    this.prevAfuera = false;
  }
  nuevoCarro() { carId += 1; return { id: carId, hue: [190, 320, 52, 140, 270, 20][carId % 6] }; }
  piso() { for (const f of [1, 2, 3, 4]) if (Math.abs(this.y - f) < 0.012) return f; return 0; }
  sensores() {
    const f = this.piso();
    return {
      PISO1: f === 1, PISO2: f === 2, PISO3: f === 3, PISO4: f === 4,
      SEN_IZQ: this.x <= -0.985, SEN_CEN: Math.abs(this.x) < 0.015, SEN_DER: this.x >= 0.985,
      MEC_AFUERA: this.ext >= 0.999, MEC_ADENTRO: this.ext <= 0.001,
    };
  }
  step(Y, dt) {
    const s = dt / 1000;
    if (Y.SUBIR) this.y = Math.min(4, this.y + this.vy * s);
    if (Y.BAJAR) this.y = Math.max(1, this.y - this.vy * s);
    if (Y.MOV_DER) this.x = Math.min(1, this.x + this.vx * s);
    if (Y.MOV_IZQ) this.x = Math.max(-1, this.x - this.vx * s);
    if (Y.ABRIR_MEC) this.ext = Math.min(1, this.ext + this.vm * s);
    if (Y.CERRAR_MEC) this.ext = Math.max(0, this.ext - this.vm * s);
    const S = this.sensores();
    if (S.MEC_AFUERA && !this.prevAfuera) {
      const f = this.piso();
      const lado = S.SEN_IZQ ? 0 : S.SEN_DER ? 1 : -1;
      if (f && lado >= 0) {
        const pos = (f - 1) * 2 + lado;
        if (this.carga && !this.puestos[pos]) { this.puestos[pos] = this.carga; this.carga = null; this.evento = { tipo: 'deja', pos }; }
        else if (!this.carga && this.puestos[pos]) { this.carga = this.puestos[pos]; this.puestos[pos] = null; this.carga.sale = true; this.evento = { tipo: 'toma', pos }; }
      }
    }
    this.prevAfuera = S.MEC_AFUERA;
  }
}
