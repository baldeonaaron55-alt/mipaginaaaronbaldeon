# Powerfit — Plataforma Integral de Gestión para Gimnasio

Aplicación web **Full-Stack** diseñada para centralizar la operación de un gimnasio: rutinas personalizadas por entrenador, gestión de membresías con fechas de vencimiento, horarios de clases y control de progreso físico.

## Arquitectura y Tecnologías
- **Frontend:** HTML5 semántico, CSS3 moderno responsivo (*mobile-first*, identidad visual Powerfit) y JavaScript ES6+ modular sin dependencias externas.
- **Backend:** Servidor HTTP y REST API en **Node.js** (`server/index.js`) con autenticación JWT (HS256), hashing seguro de contraseñas (`crypto.scryptSync`) y control de acceso por roles (**RBAC**).
- **Base de Datos:** **SQLite** relacional (`database/powerfit.db`) usando el módulo nativo `node:sqlite` con 8 tablas (`usuarios`, `planes`, `membresias`, `ejercicios`, `rutinas`, `horarios`, `progreso_fisico`, `consultas`).
- **Modo Dual:** Si se abre `index.html` directamente sin ejecutar Node.js, la app detecta la ausencia de servidor y activa automáticamente un motor local con `localStorage`.

## Estructura del Proyecto
```text
proyecto_airon/
├── index.html          # Punto de entrada SPA (Landing + Paneles por rol)
├── css/
│   └── styles.css      # Sistema de diseño responsivo Powerfit
├── js/
│   ├── api.js          # Cliente API dual (REST SQLite / fallback LocalStorage)
│   └── app.js          # Controlador de interfaz y paneles por rol
├── server/
│   ├── index.js        # Servidor HTTP, archivos estáticos, streaming MP4 y REST API
│   ├── db.js           # Esquema SQLite y carga inicial (seed)
│   └── auth.js         # Hashing scrypt y tokens JWT
├── assets/
│   ├── img/            # Logo e imágenes de planes y disciplinas
│   └── video/          # Video de calentamiento preventivo
├── database/           # Base de datos SQLite generada automáticamente
└── tests/
    └── api.test.js     # Pruebas automatizadas end-to-end
```

## Cómo Ejecutar
Requiere **Node.js >= 22.5** (sin necesidad de instalar paquetes externos).

1. Iniciar el servidor Full-Stack:
   ```bash
   npm start
   ```
2. Abrir en el navegador: `http://localhost:3000`
3. Ejecutar pruebas automatizadas:
   ```bash
   npm test
   ```

## Cuentas de Prueba (Pre-cargadas)
| Rol | Correo | Contraseña |
| :--- | :--- | :--- |
| **Cliente** | `aaron@powerfit.ec` | `Cliente123!` |
| **Entrenador** | `entrenador@powerfit.ec` | `Coach123!` |
| **Administrador** | `admin@powerfit.ec` | `Admin123!` |

---
Proyecto desarrollado por **Aaron Baldeon** — Fundamentos de Programación I (ISP ADE).
