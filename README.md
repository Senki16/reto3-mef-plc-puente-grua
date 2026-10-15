# Reto 03 · MEF con PLC

Simuladores web del **Reto 3** de *Lenguajes Técnicos de Programación* (Universidad EAFIT, 2026-2): control de plantas del laboratorio con una **máquina de estados finitos** programada en **texto estructurado (ST)** para un PLC Mitsubishi FX3G (GX Works2).

| Simulador | Estado |
|---|---|
| **Puente grúa pequeño** | Opción presentada. Ordena 3 piezas en P2 (grande arriba, pequeña abajo) con el mínimo de movimientos: 3 si la pila es ascendente, 5 si es descendente. |
| **Parqueadero lineal** | Trabajo previo. **El banco de pruebas del parqueadero está dañado**, por eso el reto se presenta con el puente grúa. |

Cada simulador ejecuta el mismo programa ST que se carga en el PLC, traducido línea por línea a JavaScript (`js/grua-plc.js`, `js/parq-plc.js`), con un ciclo de scan de 10 ms contra un modelo de la planta (sensores, actuadores, piezas y carros).

## Pruebas en el PLC real

El programa se compiló en GX Works2 1.605F (0 errores), se cargó en el FX3G (verificación *Match*, PLC en RUN sin errores) y cumplió las 6 pruebas del protocolo. Los videos están en `assets/video/` y en la sección **Pruebas** de la página.

## Archivos

- `assets/Reto3_PuenteGrua_Codigo_ST.txt` — programa ST del puente grúa (11 estados)
- `assets/Reto3_Parqueadero_Codigo_ST.txt` — programa ST del parqueadero (11 estados)
- `assets/MEF_*.png` — diagramas de las máquinas de estados

## Ejecutar localmente

Es un sitio estático, sin compilación:

```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```
