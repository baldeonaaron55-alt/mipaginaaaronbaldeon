/**
 * Powerfit API Client (Modo Dual: Backend Node.js+SQLite o LocalStorage offline).
 * Si la aplicación corre bajo el servidor Node.js, todas las operaciones persisten en SQLite.
 * Si se abre index.html directamente sin servidor, cambia automáticamente a LocalStorage.
 */
(function (global) {
  const TOKEN_KEY = 'powerfit_jwt_token';
  const LOCAL_DB_KEY = 'powerfit_local_db_v1';
  const LOCAL_USER_KEY = 'powerfit_local_user_id';

  let mode = 'remote'; // 'remote' | 'local'

  function todayISO(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function computeMembership(m, planes) {
    if (!m) return null;
    const plan = planes.find(p => p.id === m.plan_id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fin = new Date(`${m.fecha_fin}T00:00:00`);
    const diffDays = Math.ceil((fin - today) / (1000 * 60 * 60 * 24));
    let estadoActual = m.estado;
    if (estadoActual === 'activa' && diffDays < 0) estadoActual = 'vencida';
    return {
      ...m,
      plan_nombre: plan ? plan.nombre : 'Plan',
      plan_precio: plan ? plan.precio : 0,
      duracion_dias: plan ? plan.duracion_dias : 30,
      beneficios: plan ? plan.beneficios : '',
      estado_actual: estadoActual,
      dias_restantes: diffDays
    };
  }

  function createInitialLocalDb() {
    return {
      seq: 100,
      usuarios: [
        { id: 1, nombre: 'Administrador Powerfit', correo: 'admin@powerfit.ec', password: 'Admin123!', telefono: '0991002000', edad: 30, rol: 'admin', activo: 1, creado_en: todayISO(-40) },
        { id: 2, nombre: 'Carlos Méndez (Coach)', correo: 'entrenador@powerfit.ec', password: 'Coach123!', telefono: '0992003000', edad: 28, rol: 'entrenador', activo: 1, creado_en: todayISO(-35) },
        { id: 3, nombre: 'Aaron Baldeon', correo: 'aaron@powerfit.ec', password: 'Cliente123!', telefono: '0987654321', edad: 22, rol: 'cliente', activo: 1, creado_en: todayISO(-25) },
        { id: 4, nombre: 'María Fernanda Torres', correo: 'maria@powerfit.ec', password: 'Cliente123!', telefono: '0981112233', edad: 25, rol: 'cliente', activo: 1, creado_en: todayISO(-20) }
      ],
      planes: [
        {
          id: 1, nombre: 'Plan Semanal', duracion_dias: 7, precio: 12.0,
          descripcion: 'Ideal para probar nuestras instalaciones o entrenar durante una semana intensa.',
          beneficios: 'Acceso a zona de musculación|Clases de bailoterapia incluidas|Rutina inicial de adaptación',
          imagen_url: 'assets/img/plan-semanal.jpg', destacado: 0, activo: 1
        },
        {
          id: 2, nombre: 'Plan Mensual', duracion_dias: 30, precio: 35.0,
          descripcion: 'Nuestro plan más popular para lograr constancia y resultados medibles mes a mes.',
          beneficios: 'Acceso ilimitado 6 días a la semana|Rutina personalizada por entrenador|Bailoterapia y zona funcional|Control mensual de progreso físico',
          imagen_url: 'assets/img/plan-mensual.jpg', destacado: 1, activo: 1
        },
        {
          id: 3, nombre: 'Plan Trimestral', duracion_dias: 90, precio: 90.0,
          descripcion: 'Ahorra $15 y comprométete con una transformación física real de 90 días.',
          beneficios: 'Todo lo del Plan Mensual|Evaluación física completa inicial y final|Ajuste quincenal de rutinas|Congelamiento hasta por 10 días',
          imagen_url: 'assets/img/plan-trimestral.jpg', destacado: 0, activo: 1
        }
      ],
      membresias: [
        { id: 1, usuario_id: 3, plan_id: 2, fecha_inicio: todayISO(-12), fecha_fin: todayISO(18), estado: 'activa' },
        { id: 2, usuario_id: 4, plan_id: 3, fecha_inicio: todayISO(-85), fecha_fin: todayISO(5), estado: 'activa' }
      ],
      ejercicios: [
        { id: 1, nombre: 'Calentamiento Articular 5 Min', grupo_muscular: 'Calentamiento', nivel: 'Principiante', instrucciones: 'Movilidad de hombros, cadera, rodillas y activación cardiovascular progresiva antes de levantar peso.', video_url: 'assets/video/calentamiento.mp4' },
        { id: 2, nombre: 'Press de Banca con Barra', grupo_muscular: 'Pecho', nivel: 'Intermedio', instrucciones: 'Acostado en banco plano, baja la barra de forma controlada al centro del pecho y empuja extendiendo codos.', video_url: '' },
        { id: 3, nombre: 'Aperturas con Mancuernas', grupo_muscular: 'Pecho', nivel: 'Principiante', instrucciones: 'En banco plano o inclinado, abre los brazos en arco ligero manteniendo tensión constante en pectorales.', video_url: '' },
        { id: 4, nombre: 'Jalón al Pecho en Polea', grupo_muscular: 'Espalda', nivel: 'Principiante', instrucciones: 'Agarre ligeramente más ancho que hombros, lleva la barra hacia la parte superior del pecho juntando escápulas.', video_url: '' },
        { id: 5, nombre: 'Remo con Barra', grupo_muscular: 'Espalda', nivel: 'Intermedio', instrucciones: 'Torso inclinado 45° con espalda recta, lleva la barra hacia el ombligo controlando la bajada.', video_url: '' },
        { id: 6, nombre: 'Sentadilla Libre', grupo_muscular: 'Piernas', nivel: 'Intermedio', instrucciones: 'Pies al ancho de los hombros, desciende manteniendo el pecho erguido y rodillas alineadas con las puntas.', video_url: '' },
        { id: 7, nombre: 'Prensa de Piernas 45°', grupo_muscular: 'Piernas', nivel: 'Principiante', instrucciones: 'Coloca los pies al ancho de cadera, flexiona hasta 90° sin despegar la zona lumbar y empuja con talones.', video_url: '' },
        { id: 8, nombre: 'Press Militar con Mancuernas', grupo_muscular: 'Hombros', nivel: 'Intermedio', instrucciones: 'Sentado con espalda apoyada, empuja las mancuernas sobre la cabeza sin bloquear bruscamente los codos.', video_url: '' },
        { id: 9, nombre: 'Curl de Bíceps con Mancuernas', grupo_muscular: 'Brazos', nivel: 'Principiante', instrucciones: 'Codos pegados al torso, eleva las mancuernas girando las palmas hacia arriba y baja en 2 segundos.', video_url: '' },
        { id: 10, nombre: 'Extensión de Tríceps en Polea', grupo_muscular: 'Brazos', nivel: 'Principiante', instrucciones: 'Codos fijos a los costados, extiende completamente la cuerda hacia abajo contrayendo el tríceps.', video_url: '' },
        { id: 11, nombre: 'Plancha Abdominal Isométrica', grupo_muscular: 'Abdomen', nivel: 'Principiante', instrucciones: 'Apoya antebrazos y puntas de pies manteniendo cuerpo alineado y abdomen contraído durante 45-60 seg.', video_url: '' },
        { id: 12, nombre: 'Sesión de Bailoterapia', grupo_muscular: 'Cardio', nivel: 'Principiante', instrucciones: 'Clase grupal aeróbica de alto ritmo para mejorar resistencia cardiovascular y quemar calorías.', video_url: '' }
      ],
      rutinas: [
        { id: 1, cliente_id: 3, entrenador_id: 2, ejercicio_id: 1, dia_semana: 'Lunes', series: 1, repeticiones: '5 min', descanso_seg: 30, notas: 'Obligatorio antes de empezar pecho.', completado_hoy: 0 },
        { id: 2, cliente_id: 3, entrenador_id: 2, ejercicio_id: 2, dia_semana: 'Lunes', series: 4, repeticiones: '10-12', descanso_seg: 90, notas: 'Aumentar peso progresivamente.', completado_hoy: 0 },
        { id: 3, cliente_id: 3, entrenador_id: 2, ejercicio_id: 4, dia_semana: 'Miércoles', series: 4, repeticiones: '10-12', descanso_seg: 75, notas: 'Enfocar retracción escapular.', completado_hoy: 0 },
        { id: 4, cliente_id: 3, entrenador_id: 2, ejercicio_id: 6, dia_semana: 'Viernes', series: 4, repeticiones: '8-10', descanso_seg: 120, notas: 'Priorizar técnica y profundidad.', completado_hoy: 0 },
        { id: 5, cliente_id: 4, entrenador_id: 2, ejercicio_id: 12, dia_semana: 'Jueves', series: 1, repeticiones: '45 min', descanso_seg: 0, notas: 'Clase grupal en Sala Cardio.', completado_hoy: 0 }
      ],
      horarios: [
        { id: 1, actividad: 'Musculación Asistida', dia_semana: 'Lunes a Sábado', hora_inicio: '06:00', hora_fin: '21:00', entrenador_nombre: 'Carlos Méndez', sala: 'Sala de Pesas', cupo: 35 },
        { id: 2, actividad: 'Bailoterapia Energética', dia_semana: 'Lunes y Miércoles', hora_inicio: '07:30', hora_fin: '08:30', entrenador_nombre: 'Sofía Paredes', sala: 'Sala Grupal', cupo: 25 },
        { id: 3, actividad: 'Entrenamiento Funcional', dia_semana: 'Martes y Jueves', hora_inicio: '18:00', hora_fin: '19:00', entrenador_nombre: 'Carlos Méndez', sala: 'Zona Funcional', cupo: 18 },
        { id: 4, actividad: 'Bailoterapia Nocturna', dia_semana: 'Martes y Jueves', hora_inicio: '19:15', hora_fin: '20:15', entrenador_nombre: 'Sofía Paredes', sala: 'Sala Grupal', cupo: 25 },
        { id: 5, actividad: 'Full Body & Core', dia_semana: 'Viernes', hora_inicio: '18:30', hora_fin: '19:30', entrenador_nombre: 'Carlos Méndez', sala: 'Zona Funcional', cupo: 20 },
        { id: 6, actividad: 'Cardio Mix Sabatino', dia_semana: 'Sábado', hora_inicio: '09:00', hora_fin: '10:30', entrenador_nombre: 'Sofía Paredes', sala: 'Sala Grupal', cupo: 30 }
      ],
      progreso_fisico: [
        { id: 1, cliente_id: 3, fecha: todayISO(-28), peso_kg: 76.5, cintura_cm: 84.0, entrenamientos_semana: 3, notas: 'Inicio de plan mensual.' },
        { id: 2, cliente_id: 3, fecha: todayISO(-14), peso_kg: 75.4, cintura_cm: 82.8, entrenamientos_semana: 4, notas: 'Mejor resistencia en press y sentadilla.' },
        { id: 3, cliente_id: 3, fecha: todayISO(-2), peso_kg: 74.6, cintura_cm: 81.5, entrenamientos_semana: 4, notas: 'Progreso constante.' },
        { id: 4, cliente_id: 4, fecha: todayISO(-15), peso_kg: 62.0, cintura_cm: 71.0, entrenamientos_semana: 4, notas: 'Excelente constancia.' }
      ],
      consultas: []
    };
  }

  function loadLocalDb() {
    const raw = localStorage.getItem(LOCAL_DB_KEY);
    if (!raw) {
      const seed = createInitialLocalDb();
      localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw);
  }

  function saveLocalDb(db) {
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
  }

  function getLocalCurrentUser(db) {
    const id = Number(localStorage.getItem(LOCAL_USER_KEY));
    if (!id) return null;
    const u = db.usuarios.find(x => x.id === id && x.activo);
    if (!u) return null;
    return { id: u.id, nombre: u.nombre, correo: u.correo, telefono: u.telefono, edad: u.edad, rol: u.rol };
  }

  async function remoteFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Error ${res.status}`);
    }
    return data;
  }

  async function init() {
    if (window.location.protocol === 'file:') {
      mode = 'local';
      loadLocalDb();
      return mode;
    }
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        mode = 'remote';
        return mode;
      }
    } catch {
      // Fallback a modo local
    }
    mode = 'local';
    loadLocalDb();
    return mode;
  }

  function getMode() {
    return mode;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LOCAL_USER_KEY);
  }

  // ==================== METODOS PUBLICOS ====================
  async function getPlanes() {
    if (mode === 'remote') return remoteFetch('/api/planes');
    const db = loadLocalDb();
    return { planes: db.planes.filter(p => p.activo).sort((a, b) => a.precio - b.precio) };
  }

  async function getHorarios() {
    if (mode === 'remote') return remoteFetch('/api/horarios');
    return { horarios: loadLocalDb().horarios };
  }

  async function getEjercicios(grupo = 'Todos') {
    if (mode === 'remote') {
      const qs = grupo && grupo !== 'Todos' ? `?grupo=${encodeURIComponent(grupo)}` : '';
      return remoteFetch(`/api/ejercicios${qs}`);
    }
    const list = loadLocalDb().ejercicios;
    return { ejercicios: grupo && grupo !== 'Todos' ? list.filter(e => e.grupo_muscular === grupo) : list };
  }

  async function sendConsulta(payload) {
    if (mode === 'remote') {
      return remoteFetch('/api/consultas', { method: 'POST', body: JSON.stringify(payload) });
    }
    const db = loadLocalDb();
    const id = ++db.seq;
    db.consultas.unshift({ id, ...payload, atendida: 0, creado_en: new Date().toISOString() });
    saveLocalDb(db);
    return { message: '¡Consulta enviada! Nuestro equipo de Powerfit se pondrá en contacto contigo.', id };
  }

  // ==================== AUTENTICACION ====================
  async function login(correo, password) {
    if (mode === 'remote') {
      const data = await remoteFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ correo, password })
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      return data;
    }
    const db = loadLocalDb();
    const u = db.usuarios.find(x => x.correo.toLowerCase() === correo.trim().toLowerCase() && x.password === password);
    if (!u) throw new Error('Correo o contraseña incorrectos.');
    if (!u.activo) throw new Error('Tu cuenta está desactivada.');
    localStorage.setItem(LOCAL_USER_KEY, String(u.id));
    return { user: { id: u.id, nombre: u.nombre, correo: u.correo, telefono: u.telefono, edad: u.edad, rol: u.rol } };
  }

  async function register(payload) {
    if (mode === 'remote') {
      const data = await remoteFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      return data;
    }
    const db = loadLocalDb();
    const correo = payload.correo.trim().toLowerCase();
    if (db.usuarios.some(u => u.correo === correo)) {
      throw new Error('Ya existe una cuenta registrada con este correo.');
    }
    const id = ++db.seq;
    const newUser = {
      id,
      nombre: payload.nombre.trim(),
      correo,
      password: payload.password,
      telefono: (payload.telefono || '').trim(),
      edad: Number(payload.edad),
      rol: 'cliente',
      activo: 1,
      creado_en: todayISO()
    };
    db.usuarios.push(newUser);
    saveLocalDb(db);
    localStorage.setItem(LOCAL_USER_KEY, String(id));
    return { user: { id, nombre: newUser.nombre, correo, telefono: newUser.telefono, edad: newUser.edad, rol: 'cliente' } };
  }

  async function getMe() {
    if (mode === 'remote') {
      if (!localStorage.getItem(TOKEN_KEY)) return { user: null };
      try {
        return await remoteFetch('/api/auth/me');
      } catch {
        logout();
        return { user: null };
      }
    }
    const db = loadLocalDb();
    return { user: getLocalCurrentUser(db) };
  }

  // ==================== CLIENTE / ENTRENADOR ====================
  async function getMiMembresia() {
    if (mode === 'remote') return remoteFetch('/api/membresias/mia');
    const db = loadLocalDb();
    const u = getLocalCurrentUser(db);
    const list = db.membresias.filter(m => m.usuario_id === u.id);
    const latest = list[list.length - 1];
    return { membresia: computeMembership(latest, db.planes) };
  }

  async function activarMembresia(planId, usuarioId) {
    if (mode === 'remote') {
      return remoteFetch('/api/membresias', {
        method: 'POST',
        body: JSON.stringify({ plan_id: planId, usuario_id: usuarioId })
      });
    }
    const db = loadLocalDb();
    const u = getLocalCurrentUser(db);
    const targetId = usuarioId && u.rol === 'admin' ? Number(usuarioId) : u.id;
    const plan = db.planes.find(p => p.id === Number(planId));
    if (!plan) throw new Error('Plan no encontrado.');
    db.membresias.forEach(m => {
      if (m.usuario_id === targetId && m.estado === 'activa') m.estado = 'cancelada';
    });
    const nueva = {
      id: ++db.seq,
      usuario_id: targetId,
      plan_id: plan.id,
      fecha_inicio: todayISO(0),
      fecha_fin: todayISO(plan.duracion_dias),
      estado: 'activa'
    };
    db.membresias.push(nueva);
    saveLocalDb(db);
    return {
      message: `Membresía "${plan.nombre}" activada hasta el ${nueva.fecha_fin}.`,
      membresia: computeMembership(nueva, db.planes)
    };
  }

  async function getRutinas(clienteId) {
    if (mode === 'remote') {
      const qs = clienteId ? `?cliente_id=${encodeURIComponent(clienteId)}` : '';
      return remoteFetch(`/api/rutinas${qs}`);
    }
    const db = loadLocalDb();
    const u = getLocalCurrentUser(db);
    const targetId = clienteId && u.rol !== 'cliente' ? Number(clienteId) : u.id;
    const order = { Lunes: 1, Martes: 2, Miércoles: 3, Jueves: 4, Viernes: 5, Sábado: 6 };
    const rutinas = db.rutinas
      .filter(r => r.cliente_id === targetId)
      .map(r => {
        const ej = db.ejercicios.find(e => e.id === r.ejercicio_id) || {};
        const coach = db.usuarios.find(x => x.id === r.entrenador_id) || {};
        return {
          ...r,
          ejercicio_nombre: ej.nombre || 'Ejercicio',
          grupo_muscular: ej.grupo_muscular || '',
          nivel: ej.nivel || '',
          instrucciones: ej.instrucciones || '',
          video_url: ej.video_url || '',
          entrenador_nombre: coach.nombre || 'Entrenador'
        };
      })
      .sort((a, b) => (order[a.dia_semana] || 9) - (order[b.dia_semana] || 9));
    return { rutinas };
  }

  async function toggleRutina(id) {
    if (mode === 'remote') return remoteFetch(`/api/rutinas/${id}/toggle`, { method: 'PATCH' });
    const db = loadLocalDb();
    const item = db.rutinas.find(r => r.id === Number(id));
    if (item) item.completado_hoy = item.completado_hoy ? 0 : 1;
    saveLocalDb(db);
    return { id, completado_hoy: item ? item.completado_hoy : 0 };
  }

  async function assignRutina(payload) {
    if (mode === 'remote') return remoteFetch('/api/rutinas', { method: 'POST', body: JSON.stringify(payload) });
    const db = loadLocalDb();
    const u = getLocalCurrentUser(db);
    const id = ++db.seq;
    db.rutinas.push({
      id,
      cliente_id: Number(payload.cliente_id),
      entrenador_id: u.id,
      ejercicio_id: Number(payload.ejercicio_id),
      dia_semana: payload.dia_semana,
      series: Number(payload.series),
      repeticiones: String(payload.repeticiones),
      descanso_seg: Number(payload.descanso_seg),
      notas: payload.notas || '',
      completado_hoy: 0
    });
    saveLocalDb(db);
    return { message: 'Ejercicio asignado a la rutina del cliente.', id };
  }

  async function deleteRutina(id) {
    if (mode === 'remote') return remoteFetch(`/api/rutinas/${id}`, { method: 'DELETE' });
    const db = loadLocalDb();
    db.rutinas = db.rutinas.filter(r => r.id !== Number(id));
    saveLocalDb(db);
    return { message: 'Ejercicio removido de la rutina.' };
  }

  async function getProgreso(clienteId) {
    if (mode === 'remote') {
      const qs = clienteId ? `?cliente_id=${encodeURIComponent(clienteId)}` : '';
      return remoteFetch(`/api/progreso${qs}`);
    }
    const db = loadLocalDb();
    const u = getLocalCurrentUser(db);
    const targetId = clienteId && u.rol !== 'cliente' ? Number(clienteId) : u.id;
    return { progreso: db.progreso_fisico.filter(p => p.cliente_id === targetId) };
  }

  async function addProgreso(payload) {
    if (mode === 'remote') return remoteFetch('/api/progreso', { method: 'POST', body: JSON.stringify(payload) });
    const db = loadLocalDb();
    const u = getLocalCurrentUser(db);
    const id = ++db.seq;
    db.progreso_fisico.push({
      id,
      cliente_id: u.id,
      fecha: payload.fecha || todayISO(),
      peso_kg: Number(payload.peso_kg),
      cintura_cm: payload.cintura_cm ? Number(payload.cintura_cm) : null,
      entrenamientos_semana: Number(payload.entrenamientos_semana || 3),
      notas: payload.notas || ''
    });
    saveLocalDb(db);
    return { message: 'Registro de progreso físico guardado.', id };
  }

  async function createEjercicio(payload) {
    if (mode === 'remote') return remoteFetch('/api/ejercicios', { method: 'POST', body: JSON.stringify(payload) });
    const db = loadLocalDb();
    const id = ++db.seq;
    db.ejercicios.push({ id, ...payload });
    saveLocalDb(db);
    return { message: 'Ejercicio agregado al catálogo.', id };
  }

  async function getClientes() {
    if (mode === 'remote') return remoteFetch('/api/clientes');
    const db = loadLocalDb();
    const clientes = db.usuarios
      .filter(u => u.rol === 'cliente')
      .map(u => {
        const ms = db.membresias.filter(m => m.usuario_id === u.id);
        const latest = ms[ms.length - 1];
        const plan = latest ? db.planes.find(p => p.id === latest.plan_id) : null;
        return {
          id: u.id, nombre: u.nombre, correo: u.correo, telefono: u.telefono, edad: u.edad, activo: u.activo,
          plan_nombre: plan ? plan.nombre : null,
          fecha_fin: latest ? latest.fecha_fin : null,
          total_rutinas: db.rutinas.filter(r => r.cliente_id === u.id).length
        };
      });
    return { clientes };
  }

  const IVA_PERCENT = 15;
  const VALID_COUPONS = { POWERFIT5: 5, POWER10: 10 };

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function calculateCartTotals(items, cuponRaw = '') {
    const totalPersonas = items.reduce((acc, it) => acc + Number(it.cantidad_personas || 0), 0);
    const subtotal = round2(items.reduce((acc, it) => acc + round2(Number(it.precio_unitario || 0) * Number(it.cantidad_personas || 0)), 0));

    let descuentoGrupoPct = 0;
    let nivelDescuento = 'Individual (sin descuento grupal)';
    let siguienteNivel = 'Agrega 1 persona más para obtener 5% de descuento grupal';

    if (totalPersonas >= 5) {
      descuentoGrupoPct = 15;
      nivelDescuento = 'Equipo / Corporativo (5+ personas)';
      siguienteNivel = '¡Alcanzaste el descuento grupal máximo (15%)!';
    } else if (totalPersonas >= 3) {
      descuentoGrupoPct = 10;
      nivelDescuento = 'Grupo Fit (3-4 personas)';
      siguienteNivel = `Agrega ${5 - totalPersonas} persona(s) más para subir al 15% de descuento`;
    } else if (totalPersonas >= 2) {
      descuentoGrupoPct = 5;
      nivelDescuento = 'Dúo Powerfit (2 personas)';
      siguienteNivel = 'Agrega 1 persona más para subir al 10% de descuento';
    } else if (totalPersonas === 0) {
      siguienteNivel = 'Agrega planes al carrito para calcular descuentos e IVA';
    }

    const cuponCode = String(cuponRaw || '').trim().toUpperCase();
    const descuentoCuponPct = VALID_COUPONS[cuponCode] || 0;
    const cuponAplicado = descuentoCuponPct > 0 ? cuponCode : '';
    const cuponInvalido = Boolean(cuponCode) && descuentoCuponPct === 0;

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
      nivel_descuento: nivelDescuento,
      siguiente_nivel: siguienteNivel,
      cupon: cuponAplicado,
      cupon_invalido: cuponInvalido,
      base_imponible: baseImponible,
      iva_porcentaje: IVA_PERCENT,
      iva_monto: ivaMonto,
      total
    };
  }

  async function createPedido(payload) {
    if (mode === 'remote') {
      return remoteFetch('/api/pedidos', { method: 'POST', body: JSON.stringify(payload) });
    }
    const db = loadLocalDb();
    if (!Array.isArray(db.pedidos)) db.pedidos = [];
    const u = getLocalCurrentUser(db);
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    if (!rawItems.length) throw new Error('Tu carrito está vacío.');

    const resolvedItems = rawItems.map(it => {
      const plan = db.planes.find(p => p.id === Number(it.plan_id));
      if (!plan) throw new Error('Plan no encontrado.');
      const cantidad = Math.floor(Number(it.cantidad_personas));
      const precioUnitario = round2(plan.precio);
      return {
        plan_id: plan.id,
        plan_nombre: plan.nombre,
        duracion_dias: plan.duracion_dias,
        precio_unitario: precioUnitario,
        cantidad_personas: cantidad,
        subtotal_item: round2(precioUnitario * cantidad),
        beneficiarios: String(it.beneficiarios || '').trim()
      };
    });

    const calc = calculateCartTotals(resolvedItems, payload.cupon || '');
    const pedido = {
      id: ++db.seq,
      usuario_id: u ? u.id : null,
      comprador_nombre: u ? u.nombre : String(payload.comprador_nombre || '').trim(),
      comprador_correo: u ? u.correo : String(payload.comprador_correo || '').trim().toLowerCase(),
      ...calc,
      estado: 'confirmado',
      creado_en: new Date().toISOString(),
      items: resolvedItems
    };
    db.pedidos.unshift(pedido);

    let membresia = null;
    if (u && resolvedItems[0]) {
      db.membresias.forEach(m => {
        if (m.usuario_id === u.id && m.estado === 'activa') m.estado = 'cancelada';
      });
      const nueva = {
        id: ++db.seq,
        usuario_id: u.id,
        plan_id: resolvedItems[0].plan_id,
        fecha_inicio: todayISO(0),
        fecha_fin: todayISO(resolvedItems[0].duracion_dias),
        estado: 'activa'
      };
      db.membresias.push(nueva);
      membresia = computeMembership(nueva, db.planes);
    }
    saveLocalDb(db);
    return {
      message: `¡Pedido #${pedido.id} confirmado por $${calc.total.toFixed(2)} (${calc.total_personas} persona${calc.total_personas > 1 ? 's' : ''})!`,
      pedido,
      membresia
    };
  }

  async function getMisPedidos() {
    if (mode === 'remote') return remoteFetch('/api/pedidos/mios');
    const db = loadLocalDb();
    const u = getLocalCurrentUser(db);
    return { pedidos: (db.pedidos || []).filter(p => p.usuario_id === u.id) };
  }

  async function getAdminPedidos() {
    if (mode === 'remote') return remoteFetch('/api/admin/pedidos');
    const db = loadLocalDb();
    return { pedidos: db.pedidos || [] };
  }

  // ==================== ADMIN ====================
  async function getAdminResumen() {
    if (mode === 'remote') return remoteFetch('/api/admin/resumen');
    const db = loadLocalDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let vigentes = 0;
    let porVencer = 0;
    let ingresos = 0;
    db.membresias.filter(m => m.estado === 'activa').forEach(m => {
      const fin = new Date(`${m.fecha_fin}T00:00:00`);
      const diff = Math.ceil((fin - today) / (1000 * 60 * 60 * 24));
      const p = db.planes.find(x => x.id === m.plan_id);
      if (diff >= 0) {
        vigentes++;
        ingresos += p ? Number(p.precio) : 0;
        if (diff <= 7) porVencer++;
      }
    });
    const pedidos = db.pedidos || [];
    const ingresosPedidos = round2(pedidos.reduce((acc, p) => acc + Number(p.total || 0), 0));
    return {
      resumen: {
        totalClientes: db.usuarios.filter(u => u.rol === 'cliente' && u.activo).length,
        totalEntrenadores: db.usuarios.filter(u => u.rol === 'entrenador' && u.activo).length,
        membresiasVigentes: vigentes,
        membresiasPorVencer: porVencer,
        ingresosEstimados: Number(ingresos.toFixed(2)),
        consultasPendientes: db.consultas.filter(c => !c.atendida).length,
        totalPedidos: pedidos.length,
        ingresosPedidos
      }
    };
  }

  async function getAdminUsuarios() {
    if (mode === 'remote') return remoteFetch('/api/admin/usuarios');
    const db = loadLocalDb();
    return {
      usuarios: db.usuarios.map(u => {
        const ms = db.membresias.filter(m => m.usuario_id === u.id);
        const latest = ms[ms.length - 1];
        const plan = latest ? db.planes.find(p => p.id === latest.plan_id) : null;
        return {
          id: u.id, nombre: u.nombre, correo: u.correo, telefono: u.telefono,
          edad: u.edad, rol: u.rol, activo: u.activo,
          plan_nombre: plan ? plan.nombre : null, fecha_fin: latest ? latest.fecha_fin : null
        };
      })
    };
  }

  async function createAdminUsuario(payload) {
    if (mode === 'remote') return remoteFetch('/api/admin/usuarios', { method: 'POST', body: JSON.stringify(payload) });
    const db = loadLocalDb();
    const correo = payload.correo.trim().toLowerCase();
    if (db.usuarios.some(u => u.correo === correo)) throw new Error('Ya existe un usuario con ese correo.');
    const id = ++db.seq;
    db.usuarios.push({ id, ...payload, correo, activo: 1, creado_en: todayISO() });
    saveLocalDb(db);
    return { message: 'Usuario creado correctamente.', id };
  }

  async function updateAdminUsuario(id, payload) {
    if (mode === 'remote') return remoteFetch(`/api/admin/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    const db = loadLocalDb();
    const u = db.usuarios.find(x => x.id === Number(id));
    if (u) {
      if (payload.rol) u.rol = payload.rol;
      if (payload.activo !== undefined) u.activo = payload.activo ? 1 : 0;
      saveLocalDb(db);
    }
    return { message: 'Usuario actualizado.' };
  }

  async function updateAdminPlan(id, payload) {
    if (mode === 'remote') return remoteFetch(`/api/admin/planes/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    const db = loadLocalDb();
    const p = db.planes.find(x => x.id === Number(id));
    if (p) {
      p.precio = Number(payload.precio);
      p.duracion_dias = Number(payload.duracion_dias);
      p.descripcion = payload.descripcion;
      saveLocalDb(db);
    }
    return { message: 'Plan actualizado correctamente.' };
  }

  async function createAdminHorario(payload) {
    if (mode === 'remote') return remoteFetch('/api/admin/horarios', { method: 'POST', body: JSON.stringify(payload) });
    const db = loadLocalDb();
    const id = ++db.seq;
    db.horarios.push({ id, ...payload, cupo: Number(payload.cupo || 20) });
    saveLocalDb(db);
    return { message: 'Horario agregado.', id };
  }

  async function deleteAdminHorario(id) {
    if (mode === 'remote') return remoteFetch(`/api/admin/horarios/${id}`, { method: 'DELETE' });
    const db = loadLocalDb();
    db.horarios = db.horarios.filter(h => h.id !== Number(id));
    saveLocalDb(db);
    return { message: 'Horario eliminado.' };
  }

  async function getAdminConsultas() {
    if (mode === 'remote') return remoteFetch('/api/admin/consultas');
    return { consultas: loadLocalDb().consultas };
  }

  async function atenderConsulta(id) {
    if (mode === 'remote') return remoteFetch(`/api/admin/consultas/${id}`, { method: 'PATCH' });
    const db = loadLocalDb();
    const c = db.consultas.find(x => x.id === Number(id));
    if (c) c.atendida = 1;
    saveLocalDb(db);
    return { message: 'Consulta marcada como atendida.' };
  }

  global.PowerfitAPI = {
    init,
    getMode,
    logout,
    getPlanes,
    getHorarios,
    getEjercicios,
    sendConsulta,
    login,
    register,
    getMe,
    getMiMembresia,
    activarMembresia,
    getRutinas,
    toggleRutina,
    assignRutina,
    deleteRutina,
    getProgreso,
    addProgreso,
    createEjercicio,
    getClientes,
    getAdminResumen,
    getAdminUsuarios,
    createAdminUsuario,
    updateAdminUsuario,
    updateAdminPlan,
    createAdminHorario,
    deleteAdminHorario,
    getAdminConsultas,
    atenderConsulta,
    calculateCartTotals,
    createPedido,
    getMisPedidos,
    getAdminPedidos
  };
})(window);
