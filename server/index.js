const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { createDatabase, formatDateISO, addDays } = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth');

const ROOT_DIR = path.resolve(__dirname, '..');
const MAX_BODY_BYTES = 1024 * 1024; // 1MB

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4'
};

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  });
  res.end(payload);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function getAuthUser(req, db) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload || !payload.id) return null;
  const user = db.prepare(
    'SELECT id, nombre, correo, telefono, edad, rol, activo FROM usuarios WHERE id = ?'
  ).get(payload.id);
  if (!user || !user.activo) return null;
  return user;
}

const IVA_PERCENT = 15; // IVA vigente en Ecuador (15%)
const VALID_COUPONS = {
  POWERFIT5: 5,
  POWER10: 10
};

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula subtotal, descuento por cantidad de personas + cupón opcional e IVA (15%).
 * Escala de descuento grupal:
 *  - 2 personas: 5%
 *  - 3 a 4 personas: 10%
 *  - 5 o más personas: 15%
 * Cupón acumulable hasta un tope de 25%.
 */
function calculateOrderTotals(resolvedItems, cuponRaw = '') {
  const totalPersonas = resolvedItems.reduce((acc, it) => acc + it.cantidad_personas, 0);
  const subtotal = round2(resolvedItems.reduce((acc, it) => acc + it.subtotal_item, 0));

  let descuentoGrupoPct = 0;
  if (totalPersonas >= 5) descuentoGrupoPct = 15;
  else if (totalPersonas >= 3) descuentoGrupoPct = 10;
  else if (totalPersonas >= 2) descuentoGrupoPct = 5;

  const cuponCode = String(cuponRaw || '').trim().toUpperCase();
  const descuentoCuponPct = VALID_COUPONS[cuponCode] || 0;
  const cuponAplicado = descuentoCuponPct > 0 ? cuponCode : '';

  const descuentoPorcentaje = Math.min(25, descuentoGrupoPct + descuentoCuponPct);
  const descuentoMonto = round2(subtotal * (descuentoPorcentaje / 100));
  const baseImponible = round2(subtotal - descuentoMonto);
  const ivaMonto = round2(baseImponible * (IVA_PERCENT / 100));
  const total = round2(baseImponible + ivaMonto);

  return {
    total_personas: totalPersonas,
    subtotal,
    descuento_grupo_pct: descuentoGrupoPct,
    descuento_cupon_pct: descuentoCuponPct,
    descuento_porcentaje: descuentoPorcentaje,
    descuento_monto: descuentoMonto,
    cupon: cuponAplicado,
    base_imponible: baseImponible,
    iva_porcentaje: IVA_PERCENT,
    iva_monto: ivaMonto,
    total
  };
}

function attachPedidoItems(db, pedidos) {
  const getItems = db.prepare('SELECT * FROM pedido_items WHERE pedido_id = ? ORDER BY id ASC');
  return pedidos.map(p => ({
    ...p,
    items: getItems.all(p.id)
  }));
}

function computeMembershipStatus(membresia) {
  if (!membresia) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fin = new Date(`${membresia.fecha_fin}T00:00:00`);
  const diffDays = Math.ceil((fin - today) / (1000 * 60 * 60 * 24));
  let estadoActual = membresia.estado;
  if (estadoActual === 'activa' && diffDays < 0) {
    estadoActual = 'vencida';
  }
  return {
    ...membresia,
    estado_actual: estadoActual,
    dias_restantes: diffDays
  };
}

function serveStaticFile(req, res, pathname) {
  let cleanPath = decodeURIComponent(pathname);
  if (cleanPath === '/' || cleanPath === '/proyecto.html') {
    cleanPath = '/index.html';
  }

  // Bloquear acceso a carpetas internas del servidor o base de datos
  const forbiddenPrefixes = ['/server', '/database', '/tests', '/.git', '/package'];
  if (forbiddenPrefixes.some(prefix => cleanPath.toLowerCase().startsWith(prefix))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acceso denegado');
    return;
  }

  const filePath = path.resolve(ROOT_DIR, `.${cleanPath}`);
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acceso denegado');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Recurso no encontrado');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Soporte HTTP Range para reproducción fluida de video MP4
    const range = req.headers.range;
    if (range && ext === '.mp4') {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      if (Number.isNaN(start) || start >= stats.size || end >= stats.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
        res.end();
        return;
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function createServer(options = {}) {
  const db = options.db || createDatabase(options.dbPath);

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const method = req.method.toUpperCase();

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      });
      res.end();
      return;
    }

    if (!pathname.startsWith('/api/')) {
      serveStaticFile(req, res, pathname);
      return;
    }

    try {
      // ================= HEALTH =================
      if (pathname === '/api/health' && method === 'GET') {
        return sendJson(res, 200, { status: 'ok', app: 'Powerfit API', engine: 'SQLite' });
      }

      // ================= PUBLICO =================
      if (pathname === '/api/planes' && method === 'GET') {
        const planes = db.prepare('SELECT * FROM planes WHERE activo = 1 ORDER BY precio ASC').all();
        return sendJson(res, 200, { planes });
      }

      if (pathname === '/api/horarios' && method === 'GET') {
        const horarios = db.prepare('SELECT * FROM horarios ORDER BY id ASC').all();
        return sendJson(res, 200, { horarios });
      }

      if (pathname === '/api/ejercicios' && method === 'GET') {
        const grupo = urlObj.searchParams.get('grupo');
        const ejercicios = grupo && grupo !== 'Todos'
          ? db.prepare('SELECT * FROM ejercicios WHERE grupo_muscular = ? ORDER BY nombre ASC').all(grupo)
          : db.prepare('SELECT * FROM ejercicios ORDER BY grupo_muscular ASC, nombre ASC').all();
        return sendJson(res, 200, { ejercicios });
      }

      if (pathname === '/api/consultas' && method === 'POST') {
        const body = await parseJsonBody(req);
        const nombre = String(body.nombre || '').trim();
        const correo = String(body.correo || '').trim().toLowerCase();
        const telefono = String(body.telefono || '').trim();
        const interes = String(body.interes || '').trim();
        const comentario = String(body.comentario || '').trim();

        if (!nombre || !correo || !interes) {
          return sendJson(res, 400, { error: 'Nombre, correo e interés son obligatorios.' });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(correo)) {
          return sendJson(res, 400, { error: 'Ingresa un correo electrónico válido.' });
        }

        const result = db.prepare(`
          INSERT INTO consultas (nombre, correo, telefono, interes, comentario)
          VALUES (?, ?, ?, ?, ?)
        `).run(nombre, correo, telefono, interes, comentario);

        return sendJson(res, 201, {
          message: '¡Consulta enviada! Nuestro equipo de Powerfit se pondrá en contacto contigo.',
          id: Number(result.lastInsertRowid)
        });
      }

      // ================= PEDIDOS / CARRITO DE MEMBRESIAS =================
      if (pathname === '/api/pedidos' && method === 'POST') {
        const body = await parseJsonBody(req);
        const authUser = getAuthUser(req, db);
        const rawItems = Array.isArray(body.items) ? body.items : [];

        if (!rawItems.length) {
          return sendJson(res, 400, { error: 'Tu carrito está vacío. Agrega al menos una membresía.' });
        }

        const compradorNombre = String(authUser ? authUser.nombre : (body.comprador_nombre || '')).trim();
        const compradorCorreo = String(authUser ? authUser.correo : (body.comprador_correo || '')).trim().toLowerCase();

        if (!compradorNombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(compradorCorreo)) {
          return sendJson(res, 400, { error: 'Ingresa un nombre y correo electrónico válidos para emitir tu orden.' });
        }

        const resolvedItems = [];
        for (const item of rawItems) {
          const planId = Number(item.plan_id);
          const cantidad = Math.floor(Number(item.cantidad_personas));
          if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > 50) {
            return sendJson(res, 400, { error: 'La cantidad de personas por membresía debe estar entre 1 y 50.' });
          }
          const plan = db.prepare('SELECT * FROM planes WHERE id = ? AND activo = 1').get(planId);
          if (!plan) {
            return sendJson(res, 404, { error: `El plan #${planId} no existe o está inactivo.` });
          }
          const precioUnitario = round2(plan.precio);
          resolvedItems.push({
            plan_id: plan.id,
            plan_nombre: plan.nombre,
            duracion_dias: plan.duracion_dias,
            precio_unitario: precioUnitario,
            cantidad_personas: cantidad,
            subtotal_item: round2(precioUnitario * cantidad),
            beneficiarios: String(item.beneficiarios || '').trim()
          });
        }

        const calc = calculateOrderTotals(resolvedItems, body.cupon || '');

        const orderRes = db.prepare(`
          INSERT INTO pedidos (
            usuario_id, comprador_nombre, comprador_correo, total_personas,
            subtotal, descuento_porcentaje, descuento_monto, cupon,
            base_imponible, iva_porcentaje, iva_monto, total, estado
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmado')
        `).run(
          authUser ? authUser.id : null,
          compradorNombre,
          compradorCorreo,
          calc.total_personas,
          calc.subtotal,
          calc.descuento_porcentaje,
          calc.descuento_monto,
          calc.cupon,
          calc.base_imponible,
          calc.iva_porcentaje,
          calc.iva_monto,
          calc.total
        );

        const pedidoId = Number(orderRes.lastInsertRowid);
        const insertItem = db.prepare(`
          INSERT INTO pedido_items (
            pedido_id, plan_id, plan_nombre, precio_unitario,
            cantidad_personas, subtotal_item, beneficiarios
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const it of resolvedItems) {
          insertItem.run(
            pedidoId,
            it.plan_id,
            it.plan_nombre,
            it.precio_unitario,
            it.cantidad_personas,
            it.subtotal_item,
            it.beneficiarios
          );
        }

        // Si el comprador tiene sesión iniciada, activamos automáticamente el plan principal adquirido
        let membresiaActivada = null;
        if (authUser) {
          const primaryPlan = resolvedItems[0];
          db.prepare("UPDATE membresias SET estado = 'cancelada' WHERE usuario_id = ? AND estado = 'activa'")
            .run(authUser.id);
          const inicio = new Date();
          const fin = addDays(inicio, primaryPlan.duracion_dias);
          const mRes = db.prepare(`
            INSERT INTO membresias (usuario_id, plan_id, fecha_inicio, fecha_fin, estado)
            VALUES (?, ?, ?, ?, 'activa')
          `).run(authUser.id, primaryPlan.plan_id, formatDateISO(inicio), formatDateISO(fin));
          const createdMem = db.prepare(`
            SELECT m.*, p.nombre AS plan_nombre, p.precio AS plan_precio, p.duracion_dias, p.beneficios
            FROM membresias m JOIN planes p ON p.id = m.plan_id WHERE m.id = ?
          `).get(mRes.lastInsertRowid);
          membresiaActivada = computeMembershipStatus(createdMem);
        }

        const pedidoRow = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
        const [pedido] = attachPedidoItems(db, [pedidoRow]);

        return sendJson(res, 201, {
          message: `¡Pedido #${pedidoId} confirmado por $${calc.total.toFixed(2)} (${calc.total_personas} persona${calc.total_personas > 1 ? 's' : ''})!`,
          pedido,
          membresia: membresiaActivada
        });
      }

      // ================= AUTENTICACION =================
      if (pathname === '/api/auth/register' && method === 'POST') {
        const body = await parseJsonBody(req);
        const nombre = String(body.nombre || '').trim();
        const correo = String(body.correo || '').trim().toLowerCase();
        const password = String(body.password || '');
        const telefono = String(body.telefono || '').trim();
        const edad = Number(body.edad);

        if (nombre.length < 2) {
          return sendJson(res, 400, { error: 'Ingresa tu nombre completo (mínimo 2 caracteres).' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
          return sendJson(res, 400, { error: 'El correo electrónico no es válido.' });
        }
        if (password.length < 6) {
          return sendJson(res, 400, { error: 'La contraseña debe tener al menos 6 caracteres.' });
        }
        if (!Number.isFinite(edad) || edad < 14 || edad > 95) {
          return sendJson(res, 400, { error: 'Ingresa una edad válida entre 14 y 95 años.' });
        }

        const exists = db.prepare('SELECT id FROM usuarios WHERE correo = ?').get(correo);
        if (exists) {
          return sendJson(res, 409, { error: 'Ya existe una cuenta registrada con este correo.' });
        }

        const result = db.prepare(`
          INSERT INTO usuarios (nombre, correo, password_hash, telefono, edad, rol)
          VALUES (?, ?, ?, ?, ?, 'cliente')
        `).run(nombre, correo, hashPassword(password), telefono, Math.floor(edad));

        const user = db.prepare(
          'SELECT id, nombre, correo, telefono, edad, rol FROM usuarios WHERE id = ?'
        ).get(result.lastInsertRowid);

        const token = signToken({ id: user.id, rol: user.rol, correo: user.correo });
        return sendJson(res, 201, { user, token });
      }

      if (pathname === '/api/auth/login' && method === 'POST') {
        const body = await parseJsonBody(req);
        const correo = String(body.correo || '').trim().toLowerCase();
        const password = String(body.password || '');

        if (!correo || !password) {
          return sendJson(res, 400, { error: 'Ingresa tu correo y contraseña.' });
        }

        const userRow = db.prepare('SELECT * FROM usuarios WHERE correo = ?').get(correo);
        if (!userRow || !verifyPassword(password, userRow.password_hash)) {
          return sendJson(res, 401, { error: 'Correo o contraseña incorrectos.' });
        }
        if (!userRow.activo) {
          return sendJson(res, 403, { error: 'Tu cuenta se encuentra desactivada. Contacta al administrador.' });
        }

        const user = {
          id: userRow.id,
          nombre: userRow.nombre,
          correo: userRow.correo,
          telefono: userRow.telefono,
          edad: userRow.edad,
          rol: userRow.rol
        };
        const token = signToken({ id: user.id, rol: user.rol, correo: user.correo });
        return sendJson(res, 200, { user, token });
      }

      // ================= RUTAS AUTENTICADAS =================
      const currentUser = getAuthUser(req, db);
      if (!currentUser) {
        return sendJson(res, 401, { error: 'Sesión requerida. Inicia sesión para continuar.' });
      }

      if (pathname === '/api/auth/me' && method === 'GET') {
        return sendJson(res, 200, { user: currentUser });
      }

      // --- MEMBRESIAS ---
      if (pathname === '/api/membresias/mia' && method === 'GET') {
        const row = db.prepare(`
          SELECT m.*, p.nombre AS plan_nombre, p.precio AS plan_precio, p.duracion_dias, p.beneficios
          FROM membresias m
          JOIN planes p ON p.id = m.plan_id
          WHERE m.usuario_id = ?
          ORDER BY m.id DESC
          LIMIT 1
        `).get(currentUser.id);
        return sendJson(res, 200, { membresia: computeMembershipStatus(row) });
      }

      if (pathname === '/api/membresias' && method === 'POST') {
        const body = await parseJsonBody(req);
        const planId = Number(body.plan_id);
        let targetUserId = currentUser.id;
        if (body.usuario_id && currentUser.rol === 'admin') {
          targetUserId = Number(body.usuario_id);
        }

        const plan = db.prepare('SELECT * FROM planes WHERE id = ? AND activo = 1').get(planId);
        if (!plan) {
          return sendJson(res, 404, { error: 'Plan de membresía no encontrado.' });
        }
        const targetUser = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(targetUserId);
        if (!targetUser) {
          return sendJson(res, 404, { error: 'Usuario no encontrado.' });
        }

        // Cerrar membresías activas anteriores del usuario
        db.prepare("UPDATE membresias SET estado = 'cancelada' WHERE usuario_id = ? AND estado = 'activa'")
          .run(targetUserId);

        const inicio = new Date();
        const fin = addDays(inicio, plan.duracion_dias);
        const result = db.prepare(`
          INSERT INTO membresias (usuario_id, plan_id, fecha_inicio, fecha_fin, estado)
          VALUES (?, ?, ?, ?, 'activa')
        `).run(targetUserId, plan.id, formatDateISO(inicio), formatDateISO(fin));

        const created = db.prepare(`
          SELECT m.*, p.nombre AS plan_nombre, p.precio AS plan_precio, p.duracion_dias, p.beneficios
          FROM membresias m
          JOIN planes p ON p.id = m.plan_id
          WHERE m.id = ?
        `).get(result.lastInsertRowid);

        return sendJson(res, 201, {
          message: `Membresía "${plan.nombre}" activada hasta el ${created.fecha_fin}.`,
          membresia: computeMembershipStatus(created)
        });
      }

      // --- RUTINAS ---
      if (pathname === '/api/rutinas' && method === 'GET') {
        let clienteId = currentUser.id;
        const queryClienteId = urlObj.searchParams.get('cliente_id');
        if (queryClienteId && (currentUser.rol === 'entrenador' || currentUser.rol === 'admin')) {
          clienteId = Number(queryClienteId);
        }

        const rutinas = db.prepare(`
          SELECT r.*,
                 e.nombre AS ejercicio_nombre,
                 e.grupo_muscular,
                 e.nivel,
                 e.instrucciones,
                 e.video_url,
                 u.nombre AS entrenador_nombre
          FROM rutinas r
          JOIN ejercicios e ON e.id = r.ejercicio_id
          JOIN usuarios u ON u.id = r.entrenador_id
          WHERE r.cliente_id = ?
          ORDER BY
            CASE r.dia_semana
              WHEN 'Lunes' THEN 1
              WHEN 'Martes' THEN 2
              WHEN 'Miércoles' THEN 3
              WHEN 'Jueves' THEN 4
              WHEN 'Viernes' THEN 5
              WHEN 'Sábado' THEN 6
              ELSE 7
            END,
            r.id ASC
        `).all(clienteId);

        return sendJson(res, 200, { rutinas });
      }

      if (pathname === '/api/rutinas' && method === 'POST') {
        if (currentUser.rol !== 'entrenador' && currentUser.rol !== 'admin') {
          return sendJson(res, 403, { error: 'Solo entrenadores o administradores pueden asignar rutinas.' });
        }
        const body = await parseJsonBody(req);
        const clienteId = Number(body.cliente_id);
        const ejercicioId = Number(body.ejercicio_id);
        const diaSemana = String(body.dia_semana || '').trim();
        const series = Number(body.series || 3);
        const repeticiones = String(body.repeticiones || '12').trim();
        const descansoSeg = Number(body.descanso_seg ?? 60);
        const notas = String(body.notas || '').trim();

        const diasValidos = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        if (!clienteId || !ejercicioId || !diasValidos.includes(diaSemana)) {
          return sendJson(res, 400, { error: 'Selecciona cliente, ejercicio y un día válido (Lunes a Sábado).' });
        }

        const result = db.prepare(`
          INSERT INTO rutinas (cliente_id, entrenador_id, ejercicio_id, dia_semana, series, repeticiones, descanso_seg, notas)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(clienteId, currentUser.id, ejercicioId, diaSemana, series, repeticiones, descansoSeg, notas);

        return sendJson(res, 201, {
          message: 'Ejercicio asignado a la rutina del cliente.',
          id: Number(result.lastInsertRowid)
        });
      }

      const rutinaToggleMatch = pathname.match(/^\/api\/rutinas\/(\d+)\/toggle$/);
      if (rutinaToggleMatch && method === 'PATCH') {
        const rutinaId = Number(rutinaToggleMatch[1]);
        const row = db.prepare('SELECT * FROM rutinas WHERE id = ?').get(rutinaId);
        if (!row) return sendJson(res, 404, { error: 'Rutina no encontrada.' });
        if (row.cliente_id !== currentUser.id && currentUser.rol === 'cliente') {
          return sendJson(res, 403, { error: 'No autorizado.' });
        }
        const nextVal = row.completado_hoy ? 0 : 1;
        db.prepare('UPDATE rutinas SET completado_hoy = ? WHERE id = ?').run(nextVal, rutinaId);
        return sendJson(res, 200, { id: rutinaId, completado_hoy: nextVal });
      }

      const rutinaDeleteMatch = pathname.match(/^\/api\/rutinas\/(\d+)$/);
      if (rutinaDeleteMatch && method === 'DELETE') {
        if (currentUser.rol !== 'entrenador' && currentUser.rol !== 'admin') {
          return sendJson(res, 403, { error: 'Solo entrenadores o administradores pueden eliminar ejercicios de rutinas.' });
        }
        const rutinaId = Number(rutinaDeleteMatch[1]);
        db.prepare('DELETE FROM rutinas WHERE id = ?').run(rutinaId);
        return sendJson(res, 200, { message: 'Ejercicio removido de la rutina.' });
      }

      // --- PROGRESO FISICO ---
      if (pathname === '/api/progreso' && method === 'GET') {
        let clienteId = currentUser.id;
        const queryClienteId = urlObj.searchParams.get('cliente_id');
        if (queryClienteId && (currentUser.rol === 'entrenador' || currentUser.rol === 'admin')) {
          clienteId = Number(queryClienteId);
        }
        const progreso = db.prepare(
          'SELECT * FROM progreso_fisico WHERE cliente_id = ? ORDER BY fecha ASC, id ASC'
        ).all(clienteId);
        return sendJson(res, 200, { progreso });
      }

      if (pathname === '/api/progreso' && method === 'POST') {
        const body = await parseJsonBody(req);
        const pesoKg = Number(body.peso_kg);
        const cinturaCm = body.cintura_cm !== '' && body.cintura_cm !== undefined && body.cintura_cm !== null
          ? Number(body.cintura_cm)
          : null;
        const entrenamientosSemana = Number(body.entrenamientos_semana || 3);
        const fecha = String(body.fecha || formatDateISO(new Date())).trim();
        const notas = String(body.notas || '').trim();

        if (!Number.isFinite(pesoKg) || pesoKg < 25 || pesoKg > 250) {
          return sendJson(res, 400, { error: 'Ingresa un peso corporal válido en kg (25 - 250).' });
        }

        const result = db.prepare(`
          INSERT INTO progreso_fisico (cliente_id, fecha, peso_kg, cintura_cm, entrenamientos_semana, notas)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(currentUser.id, fecha, pesoKg, cinturaCm, entrenamientosSemana, notas);

        return sendJson(res, 201, {
          message: 'Registro de progreso físico guardado.',
          id: Number(result.lastInsertRowid)
        });
      }

      // --- EJERCICIOS (Entrenador / Admin) ---
      if (pathname === '/api/ejercicios' && method === 'POST') {
        if (currentUser.rol !== 'entrenador' && currentUser.rol !== 'admin') {
          return sendJson(res, 403, { error: 'No autorizado para crear ejercicios.' });
        }
        const body = await parseJsonBody(req);
        const nombre = String(body.nombre || '').trim();
        const grupo = String(body.grupo_muscular || '').trim();
        const nivel = String(body.nivel || 'Intermedio').trim();
        const instrucciones = String(body.instrucciones || '').trim();
        const videoUrl = String(body.video_url || '').trim();

        if (!nombre || !grupo || !instrucciones) {
          return sendJson(res, 400, { error: 'Nombre, grupo muscular e instrucciones son obligatorios.' });
        }

        const result = db.prepare(`
          INSERT INTO ejercicios (nombre, grupo_muscular, nivel, instrucciones, video_url)
          VALUES (?, ?, ?, ?, ?)
        `).run(nombre, grupo, nivel, instrucciones, videoUrl);

        return sendJson(res, 201, {
          message: 'Ejercicio agregado al catálogo.',
          id: Number(result.lastInsertRowid)
        });
      }

      // --- CLIENTES PARA ENTRENADOR / ADMIN ---
      if (pathname === '/api/clientes' && method === 'GET') {
        if (currentUser.rol !== 'entrenador' && currentUser.rol !== 'admin') {
          return sendJson(res, 403, { error: 'Acceso restringido a entrenadores y administradores.' });
        }
        const clientes = db.prepare(`
          SELECT u.id, u.nombre, u.correo, u.telefono, u.edad, u.activo,
                 (SELECT p.nombre FROM membresias m JOIN planes p ON p.id = m.plan_id
                  WHERE m.usuario_id = u.id ORDER BY m.id DESC LIMIT 1) AS plan_nombre,
                 (SELECT m.fecha_fin FROM membresias m
                  WHERE m.usuario_id = u.id ORDER BY m.id DESC LIMIT 1) AS fecha_fin,
                 (SELECT COUNT(*) FROM rutinas r WHERE r.cliente_id = u.id) AS total_rutinas
          FROM usuarios u
          WHERE u.rol = 'cliente'
          ORDER BY u.nombre ASC
        `).all();
        return sendJson(res, 200, { clientes });
      }

      // --- MIS PEDIDOS ---
      if (pathname === '/api/pedidos/mios' && method === 'GET') {
        const rows = db.prepare('SELECT * FROM pedidos WHERE usuario_id = ? ORDER BY id DESC').all(currentUser.id);
        return sendJson(res, 200, { pedidos: attachPedidoItems(db, rows) });
      }

      // ================= RUTAS EXCLUSIVAS DE ADMIN =================
      if (pathname.startsWith('/api/admin/')) {
        if (currentUser.rol !== 'admin') {
          return sendJson(res, 403, { error: 'Acceso exclusivo para administradores.' });
        }

        if (pathname === '/api/admin/resumen' && method === 'GET') {
          const totalClientes = db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'cliente' AND activo = 1").get().c;
          const totalEntrenadores = db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'entrenador' AND activo = 1").get().c;
          const consultasPendientes = db.prepare('SELECT COUNT(*) AS c FROM consultas WHERE atendida = 0').get().c;
          const pedidosStats = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS sum_total FROM pedidos').get();
          const membresiasActivas = db.prepare(`
            SELECT m.fecha_fin, p.precio
            FROM membresias m
            JOIN planes p ON p.id = m.plan_id
            WHERE m.estado = 'activa'
          `).all();

          const today = new Date();
          today.setHours(0, 0, 0, 0);
          let vigentes = 0;
          let porVencer = 0;
          let ingresosEstimados = 0;

          for (const m of membresiasActivas) {
            const fin = new Date(`${m.fecha_fin}T00:00:00`);
            const diffDays = Math.ceil((fin - today) / (1000 * 60 * 60 * 24));
            if (diffDays >= 0) {
              vigentes++;
              ingresosEstimados += Number(m.precio || 0);
              if (diffDays <= 7) porVencer++;
            }
          }

          return sendJson(res, 200, {
            resumen: {
              totalClientes,
              totalEntrenadores,
              membresiasVigentes: vigentes,
              membresiasPorVencer: porVencer,
              ingresosEstimados: Number(ingresosEstimados.toFixed(2)),
              consultasPendientes,
              totalPedidos: pedidosStats.c,
              ingresosPedidos: round2(pedidosStats.sum_total)
            }
          });
        }

        if (pathname === '/api/admin/pedidos' && method === 'GET') {
          const rows = db.prepare('SELECT * FROM pedidos ORDER BY id DESC').all();
          return sendJson(res, 200, { pedidos: attachPedidoItems(db, rows) });
        }

        if (pathname === '/api/admin/usuarios' && method === 'GET') {
          const usuarios = db.prepare(`
            SELECT u.id, u.nombre, u.correo, u.telefono, u.edad, u.rol, u.activo, u.creado_en,
                   (SELECT p.nombre FROM membresias m JOIN planes p ON p.id = m.plan_id
                    WHERE m.usuario_id = u.id ORDER BY m.id DESC LIMIT 1) AS plan_nombre,
                   (SELECT m.fecha_fin FROM membresias m
                    WHERE m.usuario_id = u.id ORDER BY m.id DESC LIMIT 1) AS fecha_fin
            FROM usuarios u
            ORDER BY u.id DESC
          `).all();
          return sendJson(res, 200, { usuarios });
        }

        if (pathname === '/api/admin/usuarios' && method === 'POST') {
          const body = await parseJsonBody(req);
          const nombre = String(body.nombre || '').trim();
          const correo = String(body.correo || '').trim().toLowerCase();
          const password = String(body.password || '');
          const telefono = String(body.telefono || '').trim();
          const edad = Number(body.edad || 20);
          const rol = ['cliente', 'entrenador', 'admin'].includes(body.rol) ? body.rol : 'cliente';

          if (!nombre || !correo || password.length < 6) {
            return sendJson(res, 400, { error: 'Nombre, correo y contraseña (mín. 6 caracteres) son obligatorios.' });
          }
          const exists = db.prepare('SELECT id FROM usuarios WHERE correo = ?').get(correo);
          if (exists) {
            return sendJson(res, 409, { error: 'Ya existe un usuario con ese correo.' });
          }

          const result = db.prepare(`
            INSERT INTO usuarios (nombre, correo, password_hash, telefono, edad, rol)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(nombre, correo, hashPassword(password), telefono, edad, rol);

          return sendJson(res, 201, { message: 'Usuario creado correctamente.', id: Number(result.lastInsertRowid) });
        }

        const userPatchMatch = pathname.match(/^\/api\/admin\/usuarios\/(\d+)$/);
        if (userPatchMatch && method === 'PATCH') {
          const targetId = Number(userPatchMatch[1]);
          const body = await parseJsonBody(req);
          const existing = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(targetId);
          if (!existing) return sendJson(res, 404, { error: 'Usuario no encontrado.' });

          const nextRol = ['cliente', 'entrenador', 'admin'].includes(body.rol) ? body.rol : existing.rol;
          const nextActivo = body.activo !== undefined ? (body.activo ? 1 : 0) : existing.activo;
          if (targetId === currentUser.id && (!nextActivo || nextRol !== 'admin')) {
            return sendJson(res, 400, { error: 'No puedes desactivar ni quitar privilegios a tu propia cuenta.' });
          }

          db.prepare('UPDATE usuarios SET rol = ?, activo = ? WHERE id = ?')
            .run(nextRol, nextActivo, targetId);
          return sendJson(res, 200, { message: 'Usuario actualizado.' });
        }

        const planPutMatch = pathname.match(/^\/api\/admin\/planes\/(\d+)$/);
        if (planPutMatch && method === 'PUT') {
          const planId = Number(planPutMatch[1]);
          const body = await parseJsonBody(req);
          const precio = Number(body.precio);
          const duracionDias = Number(body.duracion_dias);
          const descripcion = String(body.descripcion || '').trim();

          if (!Number.isFinite(precio) || precio <= 0 || !Number.isFinite(duracionDias) || duracionDias <= 0) {
            return sendJson(res, 400, { error: 'Precio y duración deben ser valores positivos.' });
          }

          db.prepare('UPDATE planes SET precio = ?, duracion_dias = ?, descripcion = ? WHERE id = ?')
            .run(precio, Math.floor(duracionDias), descripcion, planId);
          return sendJson(res, 200, { message: 'Plan actualizado correctamente.' });
        }

        if (pathname === '/api/admin/horarios' && method === 'POST') {
          const body = await parseJsonBody(req);
          const actividad = String(body.actividad || '').trim();
          const diaSemana = String(body.dia_semana || '').trim();
          const horaInicio = String(body.hora_inicio || '').trim();
          const horaFin = String(body.hora_fin || '').trim();
          const entrenadorNombre = String(body.entrenador_nombre || '').trim();
          const sala = String(body.sala || 'Sala Principal').trim();
          const cupo = Number(body.cupo || 20);

          if (!actividad || !diaSemana || !horaInicio || !horaFin || !entrenadorNombre) {
            return sendJson(res, 400, { error: 'Completa todos los campos del horario.' });
          }

          const result = db.prepare(`
            INSERT INTO horarios (actividad, dia_semana, hora_inicio, hora_fin, entrenador_nombre, sala, cupo)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(actividad, diaSemana, horaInicio, horaFin, entrenadorNombre, sala, cupo);

          return sendJson(res, 201, { message: 'Horario agregado.', id: Number(result.lastInsertRowid) });
        }

        const horarioDelMatch = pathname.match(/^\/api\/admin\/horarios\/(\d+)$/);
        if (horarioDelMatch && method === 'DELETE') {
          db.prepare('DELETE FROM horarios WHERE id = ?').run(Number(horarioDelMatch[1]));
          return sendJson(res, 200, { message: 'Horario eliminado.' });
        }

        if (pathname === '/api/admin/consultas' && method === 'GET') {
          const consultas = db.prepare('SELECT * FROM consultas ORDER BY atendida ASC, id DESC').all();
          return sendJson(res, 200, { consultas });
        }

        const consultaPatchMatch = pathname.match(/^\/api\/admin\/consultas\/(\d+)$/);
        if (consultaPatchMatch && method === 'PATCH') {
          const id = Number(consultaPatchMatch[1]);
          db.prepare('UPDATE consultas SET atendida = 1 WHERE id = ?').run(id);
          return sendJson(res, 200, { message: 'Consulta marcada como atendida.' });
        }
      }

      return sendJson(res, 404, { error: 'Endpoint no encontrado.' });
    } catch (err) {
      if (err.message === 'INVALID_JSON') {
        return sendJson(res, 400, { error: 'El cuerpo de la petición no es un JSON válido.' });
      }
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return sendJson(res, 413, { error: 'La petición excede el tamaño máximo permitido.' });
      }
      console.error('[Powerfit API Error]', err);
      return sendJson(res, 500, { error: 'Error interno del servidor.' });
    }
  });

  server.db = db;
  return server;
}

if (require.main === module) {
  const PORT = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Powerfit Full-Stack corriendo en http://localhost:${PORT}`);
    console.log('Base de datos SQLite lista en database/powerfit.db');
  });
}

module.exports = { createServer };
