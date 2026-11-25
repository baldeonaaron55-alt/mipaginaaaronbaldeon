const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server/index');

let server;
let baseUrl;

test.before(async () => {
  server = createServer({ dbPath: ':memory:' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  server.db.close();
});

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test('GET /api/health y archivos estáticos responden correctamente', async () => {
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.status, 'ok');

  const htmlRes = await fetch(`${baseUrl}/`);
  assert.equal(htmlRes.status, 200);
  const html = await htmlRes.text();
  assert.ok(html.includes('POWER<span>FIT</span>'));

  // Bloqueo de acceso a archivos internos del servidor
  const forbidden = await fetch(`${baseUrl}/server/index.js`);
  assert.equal(forbidden.status, 403);
});

test('Endpoints públicos devuelven planes, horarios, ejercicios y aceptan consultas', async () => {
  const planes = await api('/api/planes');
  assert.equal(planes.status, 200);
  assert.equal(planes.data.planes.length, 3);

  const horarios = await api('/api/horarios');
  assert.equal(horarios.status, 200);
  assert.ok(horarios.data.horarios.length >= 5);

  const ejercicios = await api('/api/ejercicios?grupo=Pecho');
  assert.equal(ejercicios.status, 200);
  assert.ok(ejercicios.data.ejercicios.every(e => e.grupo_muscular === 'Pecho'));

  const consulta = await api('/api/consultas', {
    method: 'POST',
    body: JSON.stringify({
      nombre: 'Luis Prueba',
      correo: 'luis@test.ec',
      telefono: '0990001111',
      interes: 'Precios y planes de membresía',
      comentario: 'Deseo empezar el lunes'
    })
  });
  assert.equal(consulta.status, 201);
  assert.ok(consulta.data.id > 0);
});

test('Carrito de membresías: cálculo por personas ($12 x 3 = $36), descuento grupal 10%, cupón e IVA 15%', async () => {
  // Caso exacto: Plan Semanal ($12) x 3 personas => Subtotal 36, Desc 10% (-3.60), Base 32.40, IVA 15% (+4.86), Total 37.26
  const guestOrder = await api('/api/pedidos', {
    method: 'POST',
    body: JSON.stringify({
      comprador_nombre: 'Grupo Amigos',
      comprador_correo: 'grupo@powerfit.ec',
      items: [{ plan_id: 1, cantidad_personas: 3, beneficiarios: 'Ana, Luis, Pedro' }]
    })
  });
  assert.equal(guestOrder.status, 201);
  assert.equal(guestOrder.data.pedido.total_personas, 3);
  assert.equal(guestOrder.data.pedido.subtotal, 36);
  assert.equal(guestOrder.data.pedido.descuento_porcentaje, 10);
  assert.equal(guestOrder.data.pedido.descuento_monto, 3.6);
  assert.equal(guestOrder.data.pedido.base_imponible, 32.4);
  assert.equal(guestOrder.data.pedido.iva_porcentaje, 15);
  assert.equal(guestOrder.data.pedido.iva_monto, 4.86);
  assert.equal(guestOrder.data.pedido.total, 37.26);

  // Caso con cliente autenticado: 5 personas Plan Semanal ($12 x 5 = $60) + cupón POWERFIT5 (15% + 5% = 20%) + IVA 15%
  const loginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ correo: 'aaron@powerfit.ec', password: 'Cliente123!' })
  });
  assert.equal(loginRes.status, 200);
  const token = loginRes.data.token;

  const authOrder = await api('/api/pedidos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      items: [{ plan_id: 1, cantidad_personas: 5, beneficiarios: 'Equipo Powerfit' }],
      cupon: 'POWERFIT5'
    })
  });
  assert.equal(authOrder.status, 201);
  assert.equal(authOrder.data.pedido.subtotal, 60);
  assert.equal(authOrder.data.pedido.descuento_porcentaje, 20);
  assert.equal(authOrder.data.pedido.descuento_monto, 12);
  assert.equal(authOrder.data.pedido.base_imponible, 48);
  assert.equal(authOrder.data.pedido.iva_monto, 7.2);
  assert.equal(authOrder.data.pedido.total, 55.2);
  assert.ok(authOrder.data.membresia);

  // Verificar historial de pedidos del cliente
  const misPedidos = await api('/api/pedidos/mios', {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(misPedidos.status, 200);
  assert.equal(misPedidos.data.pedidos.length, 1);
  assert.equal(misPedidos.data.pedidos[0].items.length, 1);

  // Verificar pedidos en panel admin
  const adminLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ correo: 'admin@powerfit.ec', password: 'Admin123!' })
  });
  const adminPedidos = await api('/api/admin/pedidos', {
    headers: { Authorization: `Bearer ${adminLogin.data.token}` }
  });
  assert.equal(adminPedidos.status, 200);
  assert.equal(adminPedidos.data.pedidos.length, 2);
});

test('Flujo completo E2E: Registro -> Membresía -> RBAC -> Rutina Entrenador -> Progreso -> Admin', async () => {
  // 1. Registro de nuevo cliente
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      nombre: 'Diego Morales',
      correo: 'diego@powerfit.ec',
      edad: 24,
      telefono: '0998887776',
      password: 'Password123!'
    })
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.rol, 'cliente');
  const clienteToken = reg.data.token;
  const clienteId = reg.data.user.id;

  // Duplicado debe fallar con 409
  const dup = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      nombre: 'Diego Duplicado',
      correo: 'diego@powerfit.ec',
      edad: 24,
      password: 'Password123!'
    })
  });
  assert.equal(dup.status, 409);

  // 2. RBAC: cliente NO puede acceder a admin ni asignar rutinas
  const forbiddenAdmin = await api('/api/admin/resumen', {
    headers: { Authorization: `Bearer ${clienteToken}` }
  });
  assert.equal(forbiddenAdmin.status, 403);

  const forbiddenRutina = await api('/api/rutinas', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clienteToken}` },
    body: JSON.stringify({ cliente_id: clienteId, ejercicio_id: 2, dia_semana: 'Lunes' })
  });
  assert.equal(forbiddenRutina.status, 403);

  // 3. Cliente activa Plan Mensual (id 2)
  const mem = await api('/api/membresias', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clienteToken}` },
    body: JSON.stringify({ plan_id: 2 })
  });
  assert.equal(mem.status, 201);
  assert.equal(mem.data.membresia.estado_actual, 'activa');
  assert.ok(mem.data.membresia.dias_restantes >= 29);

  // 4. Entrenador inicia sesión y asigna rutina a Diego
  const coachLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ correo: 'entrenador@powerfit.ec', password: 'Coach123!' })
  });
  assert.equal(coachLogin.status, 200);
  const coachToken = coachLogin.data.token;

  const assign = await api('/api/rutinas', {
    method: 'POST',
    headers: { Authorization: `Bearer ${coachToken}` },
    body: JSON.stringify({
      cliente_id: clienteId,
      ejercicio_id: 2,
      dia_semana: 'Lunes',
      series: 4,
      repeticiones: '10',
      descanso_seg: 90,
      notas: 'Controlar técnica'
    })
  });
  assert.equal(assign.status, 201);

  // 5. Cliente consulta su rutina, la marca completada y registra progreso
  const misRutinas = await api('/api/rutinas', {
    headers: { Authorization: `Bearer ${clienteToken}` }
  });
  assert.equal(misRutinas.status, 200);
  assert.equal(misRutinas.data.rutinas.length, 1);

  const toggle = await api(`/api/rutinas/${misRutinas.data.rutinas[0].id}/toggle`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${clienteToken}` }
  });
  assert.equal(toggle.status, 200);
  assert.equal(toggle.data.completado_hoy, 1);

  const prog = await api('/api/progreso', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clienteToken}` },
    body: JSON.stringify({ peso_kg: 72.4, cintura_cm: 80.5, entrenamientos_semana: 4, notas: 'Primera semana' })
  });
  assert.equal(prog.status, 201);

  // 6. Admin inicia sesión, consulta resumen KPIs y actualiza precio de plan
  const adminLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ correo: 'admin@powerfit.ec', password: 'Admin123!' })
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.data.token;

  const resumen = await api('/api/admin/resumen', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(resumen.status, 200);
  assert.ok(resumen.data.resumen.totalClientes >= 3);
  assert.ok(resumen.data.resumen.consultasPendientes >= 1);

  const updatePlan = await api('/api/admin/planes/1', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ precio: 14.5, duracion_dias: 7, descripcion: 'Plan semanal actualizado' })
  });
  assert.equal(updatePlan.status, 200);
});
