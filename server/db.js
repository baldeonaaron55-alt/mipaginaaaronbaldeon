const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

function formatDateISO(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Inicializa la base de datos SQLite y crea el esquema + datos semilla si está vacía.
 */
function createDatabase(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, '..', 'database', 'powerfit.db');
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      correo TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      telefono TEXT DEFAULT '',
      edad INTEGER DEFAULT 18,
      rol TEXT NOT NULL DEFAULT 'cliente' CHECK (rol IN ('cliente', 'entrenador', 'admin')),
      activo INTEGER NOT NULL DEFAULT 1,
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS planes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      duracion_dias INTEGER NOT NULL,
      precio REAL NOT NULL,
      descripcion TEXT NOT NULL,
      beneficios TEXT NOT NULL,
      imagen_url TEXT NOT NULL,
      destacado INTEGER NOT NULL DEFAULT 0,
      activo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS membresias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      fecha_inicio TEXT NOT NULL,
      fecha_fin TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'vencida', 'cancelada')),
      creado_en TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES planes(id)
    );

    CREATE TABLE IF NOT EXISTS ejercicios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      grupo_muscular TEXT NOT NULL,
      nivel TEXT NOT NULL DEFAULT 'Intermedio',
      instrucciones TEXT NOT NULL,
      video_url TEXT DEFAULT '',
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rutinas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      entrenador_id INTEGER NOT NULL,
      ejercicio_id INTEGER NOT NULL,
      dia_semana TEXT NOT NULL,
      series INTEGER NOT NULL DEFAULT 3,
      repeticiones TEXT NOT NULL DEFAULT '12',
      descanso_seg INTEGER NOT NULL DEFAULT 60,
      notas TEXT DEFAULT '',
      completado_hoy INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (entrenador_id) REFERENCES usuarios(id),
      FOREIGN KEY (ejercicio_id) REFERENCES ejercicios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS horarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actividad TEXT NOT NULL,
      dia_semana TEXT NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fin TEXT NOT NULL,
      entrenador_nombre TEXT NOT NULL,
      sala TEXT NOT NULL DEFAULT 'Sala Principal',
      cupo INTEGER NOT NULL DEFAULT 20
    );

    CREATE TABLE IF NOT EXISTS progreso_fisico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      peso_kg REAL NOT NULL,
      cintura_cm REAL,
      entrenamientos_semana INTEGER DEFAULT 3,
      notas TEXT DEFAULT '',
      creado_en TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS consultas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      correo TEXT NOT NULL,
      telefono TEXT DEFAULT '',
      interes TEXT NOT NULL,
      comentario TEXT DEFAULT '',
      atendida INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      comprador_nombre TEXT NOT NULL,
      comprador_correo TEXT NOT NULL,
      total_personas INTEGER NOT NULL,
      subtotal REAL NOT NULL,
      descuento_porcentaje REAL NOT NULL DEFAULT 0,
      descuento_monto REAL NOT NULL DEFAULT 0,
      cupon TEXT DEFAULT '',
      base_imponible REAL NOT NULL,
      iva_porcentaje REAL NOT NULL DEFAULT 15,
      iva_monto REAL NOT NULL,
      total REAL NOT NULL,
      estado TEXT NOT NULL DEFAULT 'confirmado',
      creado_en TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS pedido_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      plan_nombre TEXT NOT NULL,
      precio_unitario REAL NOT NULL,
      cantidad_personas INTEGER NOT NULL,
      subtotal_item REAL NOT NULL,
      beneficiarios TEXT DEFAULT '',
      FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES planes(id)
    );
  `);

  seedIfEmpty(db);
  return db;
}

function seedIfEmpty(db) {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM usuarios').get().count;
  if (userCount > 0) return;

  const insertUser = db.prepare(`
    INSERT INTO usuarios (nombre, correo, password_hash, telefono, edad, rol)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const adminId = insertUser.run(
    'Administrador Powerfit',
    'admin@powerfit.ec',
    hashPassword('Admin123!'),
    '0991002000',
    30,
    'admin'
  ).lastInsertRowid;

  const coachId = insertUser.run(
    'Carlos Méndez (Coach)',
    'entrenador@powerfit.ec',
    hashPassword('Coach123!'),
    '0992003000',
    28,
    'entrenador'
  ).lastInsertRowid;

  const aaronId = insertUser.run(
    'Aaron Baldeon',
    'aaron@powerfit.ec',
    hashPassword('Cliente123!'),
    '0987654321',
    22,
    'cliente'
  ).lastInsertRowid;

  const mariaId = insertUser.run(
    'María Fernanda Torres',
    'maria@powerfit.ec',
    hashPassword('Cliente123!'),
    '0981112233',
    25,
    'cliente'
  ).lastInsertRowid;

  const insertPlan = db.prepare(`
    INSERT INTO planes (nombre, duracion_dias, precio, descripcion, beneficios, imagen_url, destacado)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const planSemanalId = insertPlan.run(
    'Plan Semanal',
    7,
    12.00,
    'Ideal para probar nuestras instalaciones o entrenar durante una semana intensa.',
    'Acceso a zona de musculación|Clases de bailoterapia incluidas|Rutina inicial de adaptación',
    'assets/img/plan-semanal.jpg',
    0
  ).lastInsertRowid;

  const planMensualId = insertPlan.run(
    'Plan Mensual',
    30,
    35.00,
    'Nuestro plan más popular para lograr constancia y resultados medibles mes a mes.',
    'Acceso ilimitado 6 días a la semana|Rutina personalizada por entrenador|Bailoterapia y zona funcional|Control mensual de progreso físico',
    'assets/img/plan-mensual.jpg',
    1
  ).lastInsertRowid;

  const planTrimestralId = insertPlan.run(
    'Plan Trimestral',
    90,
    90.00,
    'Ahorra $15 y comprométete con una transformación física real de 90 días.',
    'Todo lo del Plan Mensual|Evaluación física completa inicial y final|Ajuste quincenal de rutinas|Congelamiento hasta por 10 días',
    'assets/img/plan-trimestral.jpg',
    0
  ).lastInsertRowid;

  const today = new Date();
  const insertMembresia = db.prepare(`
    INSERT INTO membresias (usuario_id, plan_id, fecha_inicio, fecha_fin, estado)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertMembresia.run(
    aaronId,
    planMensualId,
    formatDateISO(addDays(today, -12)),
    formatDateISO(addDays(today, 18)),
    'activa'
  );

  insertMembresia.run(
    mariaId,
    planTrimestralId,
    formatDateISO(addDays(today, -85)),
    formatDateISO(addDays(today, 5)),
    'activa'
  );

  const insertEjercicio = db.prepare(`
    INSERT INTO ejercicios (nombre, grupo_muscular, nivel, instrucciones, video_url)
    VALUES (?, ?, ?, ?, ?)
  `);

  const ejerciciosSeed = [
    ['Calentamiento Articular 5 Min', 'Calentamiento', 'Principiante', 'Movilidad de hombros, cadera, rodillas y activación cardiovascular progresiva antes de levantar peso.', 'assets/video/calentamiento.mp4'],
    ['Press de Banca con Barra', 'Pecho', 'Intermedio', 'Acostado en banco plano, baja la barra de forma controlada al centro del pecho y empuja extendiendo codos.', ''],
    ['Aperturas con Mancuernas', 'Pecho', 'Principiante', 'En banco plano o inclinado, abre los brazos en arco ligero manteniendo tensión constante en pectorales.', ''],
    ['Jalón al Pecho en Polea', 'Espalda', 'Principiante', 'Agarre ligeramente más ancho que hombros, lleva la barra hacia la parte superior del pecho juntando escápulas.', ''],
    ['Remo con Barra', 'Espalda', 'Intermedio', 'Torso inclinado 45° con espalda recta, lleva la barra hacia el ombligo controlando la bajada.', ''],
    ['Sentadilla Libre', 'Piernas', 'Intermedio', 'Pies al ancho de los hombros, desciende manteniendo el pecho erguido y rodillas alineadas con las puntas.', ''],
    ['Prensa de Piernas 45°', 'Piernas', 'Principiante', 'Coloca los pies al ancho de cadera, flexiona hasta 90° sin despegar la zona lumbar y empuja con talones.', ''],
    ['Press Militar con Mancuernas', 'Hombros', 'Intermedio', 'Sentado con espalda apoyada, empuja las mancuernas sobre la cabeza sin bloquear bruscamente los codos.', ''],
    ['Curl de Bíceps con Mancuernas', 'Brazos', 'Principiante', 'Codos pegados al torso, eleva las mancuernas girando las palmas hacia arriba y baja en 2 segundos.', ''],
    ['Extensión de Tríceps en Polea', 'Brazos', 'Principiante', 'Codos fijos a los costados, extiende completamente la cuerda hacia abajo contrayendo el tríceps.', ''],
    ['Plancha Abdominal Isométrica', 'Abdomen', 'Principiante', 'Apoya antebrazos y puntas de pies manteniendo cuerpo alineado y abdomen contraído durante 45-60 seg.', ''],
    ['Sesión de Bailoterapia', 'Cardio', 'Principiante', 'Clase grupal aeróbica de alto ritmo para mejorar resistencia cardiovascular y quemar calorías.', '']
  ];

  const ejIds = ejerciciosSeed.map(e => insertEjercicio.run(...e).lastInsertRowid);

  const insertRutina = db.prepare(`
    INSERT INTO rutinas (cliente_id, entrenador_id, ejercicio_id, dia_semana, series, repeticiones, descanso_seg, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Rutina de ejemplo para Aaron
  insertRutina.run(aaronId, coachId, ejIds[0], 'Lunes', 1, '5 min', 30, 'Obligatorio antes de empezar pecho.');
  insertRutina.run(aaronId, coachId, ejIds[1], 'Lunes', 4, '10-12', 90, 'Aumentar peso progresivamente en la última serie.');
  insertRutina.run(aaronId, coachId, ejIds[2], 'Lunes', 3, '12-15', 60, 'Controlar el estiramiento 2 segundos.');
  insertRutina.run(aaronId, coachId, ejIds[9], 'Lunes', 3, '12', 60, 'Mantener codos estables.');
  insertRutina.run(aaronId, coachId, ejIds[3], 'Miércoles', 4, '10-12', 75, 'Enfocar retracción escapular.');
  insertRutina.run(aaronId, coachId, ejIds[4], 'Miércoles', 4, '10', 90, 'Espalda neutra en todo momento.');
  insertRutina.run(aaronId, coachId, ejIds[8], 'Miércoles', 3, '12', 60, 'Sin balanceo de espalda.');
  insertRutina.run(aaronId, coachId, ejIds[5], 'Viernes', 4, '8-10', 120, 'Priorizar técnica y profundidad.');
  insertRutina.run(aaronId, coachId, ejIds[6], 'Viernes', 4, '12', 90, 'No bloquear rodillas al subir.');
  insertRutina.run(aaronId, coachId, ejIds[10], 'Viernes', 3, '45 seg', 45, 'Respiración controlada.');

  // Rutina de ejemplo para María
  insertRutina.run(mariaId, coachId, ejIds[0], 'Martes', 1, '5 min', 30, 'Calentamiento articular completo.');
  insertRutina.run(mariaId, coachId, ejIds[5], 'Martes', 4, '12', 90, 'Peso moderado, foco en glúteos.');
  insertRutina.run(mariaId, coachId, ejIds[11], 'Jueves', 1, '45 min', 0, 'Clase grupal en Sala Cardio.');

  const insertHorario = db.prepare(`
    INSERT INTO horarios (actividad, dia_semana, hora_inicio, hora_fin, entrenador_nombre, sala, cupo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const horariosSeed = [
    ['Musculación Asistida', 'Lunes a Sábado', '06:00', '21:00', 'Carlos Méndez', 'Sala de Pesas', 35],
    ['Bailoterapia Energética', 'Lunes y Miércoles', '07:30', '08:30', 'Sofía Paredes', 'Sala Grupal', 25],
    ['Entrenamiento Funcional', 'Martes y Jueves', '18:00', '19:00', 'Carlos Méndez', 'Zona Funcional', 18],
    ['Bailoterapia Nocturna', 'Martes y Jueves', '19:15', '20:15', 'Sofía Paredes', 'Sala Grupal', 25],
    ['Full Body & Core', 'Viernes', '18:30', '19:30', 'Carlos Méndez', 'Zona Funcional', 20],
    ['Cardio Mix Sabatino', 'Sábado', '09:00', '10:30', 'Sofía Paredes', 'Sala Grupal', 30]
  ];
  horariosSeed.forEach(h => insertHorario.run(...h));

  const insertProgreso = db.prepare(`
    INSERT INTO progreso_fisico (cliente_id, fecha, peso_kg, cintura_cm, entrenamientos_semana, notas)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertProgreso.run(aaronId, formatDateISO(addDays(today, -28)), 76.5, 84.0, 3, 'Inicio de plan mensual, buena energía.');
  insertProgreso.run(aaronId, formatDateISO(addDays(today, -14)), 75.4, 82.8, 4, 'Mejor resistencia en press de banca y sentadilla.');
  insertProgreso.run(aaronId, formatDateISO(addDays(today, -2)), 74.6, 81.5, 4, 'Progreso constante, menos fatiga.');
  insertProgreso.run(mariaId, formatDateISO(addDays(today, -15)), 62.0, 71.0, 4, 'Excelente constancia en bailoterapia y pierna.');

  // Evitar variable sin uso
  void adminId;
  void planSemanalId;
}

module.exports = {
  createDatabase,
  formatDateISO,
  addDays
};
