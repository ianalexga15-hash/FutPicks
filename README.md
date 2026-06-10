# ⚽ FutPicks AI — Motor de Predicción de Fútbol

Sistema de predicción de resultados de fútbol basado en el modelo estadístico **Dixon-Coles + Distribución de Poisson**, con interfaz web completa.

![FutPicks](https://img.shields.io/badge/Model-Dixon--Coles-blue) ![Node](https://img.shields.io/badge/Backend-Node.js-green) ![JS](https://img.shields.io/badge/Frontend-Vanilla%20JS-yellow)

---

## 🗂 Estructura del proyecto

```
FutPicks/
├── FutPicks_Backend/    ← API REST (Node.js + Express + MySQL)
└── FutPicks_Frontend/   ← SPA (HTML + CSS + JavaScript vanilla)
```

---

## 🚀 Cómo ejecutar

### Requisitos
- Node.js v18+
- MySQL 8.0
- Base de datos `FutPicks_DB` restaurada

### Backend
```bash
cd FutPicks_Backend
cp .env.example .env        # Edita con tus credenciales de MySQL
npm install
node index.js               # Servidor en http://localhost:3000
```

### Frontend
Abre `FutPicks_Frontend/index.html` en el navegador  
*(o usa Live Server en VS Code)*

---

## 🧠 Modelo predictivo

| Componente | Descripción |
|---|---|
| **Dixon-Coles** | Parámetros ataque/defensa por equipo, corregidos para scores bajos |
| **Poisson** | Distribución de probabilidades sobre marcadores 0-8 |
| **Ponderación histórica** | Temporada actual → peso 5×, históricas → peso decreciente |
| **Ventaja local** | `HOME_ADV = 1.12` calibrado históricamente |
| **Form modifier** | Ajuste según forma reciente (últimas 5 jornadas) |

---

## 📊 Funcionalidades

- **Predicción de partido** — probabilidades L/E/V + marcador más probable + mercados
- **Simulador de temporada** — simulación jornada a jornada con acumulación de estado
- **Monte Carlo** — N simulaciones para distribución de probabilidades de campeón/descenso
- **Validación del modelo** — backtest retrospectivo contra datos reales
- **Clasificaciones, partidos, equipos y jugadores** con estadísticas avanzadas

---

## 🏆 Ligas soportadas

LaLiga · Premier League · Bundesliga · Serie A · Ligue 1 · Liga MX · Brasileirão · MLS · más

---

## ⚙️ Variables de entorno

Ver `FutPicks_Backend/.env.example`

---

*Desarrollado como proyecto personal de análisis de datos deportivos.*
