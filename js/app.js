/**
 * Powerfit Frontend Controller
 * Gestiona la vista pública, autenticación y paneles por rol (Cliente, Entrenador, Administrador).
 */
(function () {
  const api = window.PowerfitAPI;

  const CART_KEY = 'powerfit_cart_v1';

  const state = {
    user: null,
    view: 'public', // 'public' | 'dashboard'
    activeTab: null,
    planes: [],
    horarios: [],
    ejercicios: [],
    selectedGrupo: 'Todos',
    selectedClienteId: null,
    cart: [], // [{ plan_id, cantidad_personas, beneficiarios }]
    cartCupon: '',
    lastReceipt: null
  };

  const DEMO_ACCOUNTS = {
    cliente: { correo: 'aaron@powerfit.ec', password: 'Cliente123!' },
    entrenador: { correo: 'entrenador@powerfit.ec', password: 'Coach123!' },
    admin: { correo: 'admin@powerfit.ec', password: 'Admin123!' }
  };

  const GRUPOS_MUSCULARES = ['Todos', 'Calentamiento', 'Pecho', 'Espalda', 'Piernas', 'Hombros', 'Brazos', 'Abdomen', 'Cardio'];
  const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  // ================= UTILIDADES =================
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  function formatMoney(amount) {
    return `$${Number(amount || 0).toFixed(2)}`;
  }

  function roleLabel(rol) {
    if (rol === 'admin') return 'Administrador';
    if (rol === 'entrenador') return 'Entrenador';
    return 'Cliente';
  }

  function membershipBadge(m) {
    if (!m) return '<span class="badge badge-neutral">Sin membresía</span>';
    if (m.estado_actual === 'vencida' || m.dias_restantes < 0) {
      return '<span class="badge badge-red">Vencida</span>';
    }
    if (m.dias_restantes <= 7) {
      return `<span class="badge badge-yellow">Por vencer (${m.dias_restantes} días)</span>`;
    }
    return `<span class="badge badge-green">Activa (${m.dias_restantes} días)</span>`;
  }

  // ================= CARRITO & CALCULADORA =================
  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      state.cart = Array.isArray(saved) ? saved : [];
    } catch {
      state.cart = [];
    }
    updateCartBadge();
  }

  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    updateCartBadge();
  }

  function updateCartBadge() {
    const totalPersonas = state.cart.reduce((acc, item) => acc + Number(item.cantidad_personas || 0), 0);
    const badge = document.getElementById('cartCountBadge');
    if (badge) badge.textContent = String(totalPersonas);
  }

  function openCartDrawer() {
    document.getElementById('cartDrawerBackdrop').classList.remove('hidden');
    renderCartDrawer();
  }

  function closeCartDrawer() {
    document.getElementById('cartDrawerBackdrop').classList.add('hidden');
  }

  function addToCart(planId, personas = 1, openDrawer = true) {
    const qty = Math.max(1, Math.min(50, Math.floor(Number(personas) || 1)));
    const plan = state.planes.find(p => p.id === Number(planId));
    if (!plan) {
      showToast('No se pudo encontrar el plan seleccionado.', 'error');
      return;
    }
    state.lastReceipt = null;
    const existing = state.cart.find(it => it.plan_id === plan.id);
    if (existing) {
      existing.cantidad_personas = Math.min(50, Number(existing.cantidad_personas) + qty);
    } else {
      state.cart.push({
        plan_id: plan.id,
        cantidad_personas: qty,
        beneficiarios: ''
      });
    }
    saveCart();
    showToast(`Agregado: ${plan.nombre} (${qty} persona${qty > 1 ? 's' : ''}) al carrito.`, 'success');
    if (openDrawer) openCartDrawer();
  }

  function getResolvedCartItems() {
    return state.cart
      .map(item => {
        const plan = state.planes.find(p => p.id === Number(item.plan_id));
        if (!plan) return null;
        const cantidad = Math.max(1, Math.min(50, Math.floor(Number(item.cantidad_personas) || 1)));
        const precioUnitario = Number(plan.precio);
        return {
          plan_id: plan.id,
          plan_nombre: plan.nombre,
          duracion_dias: plan.duracion_dias,
          precio_unitario: precioUnitario,
          cantidad_personas: cantidad,
          subtotal_item: Number((precioUnitario * cantidad).toFixed(2)),
          beneficiarios: item.beneficiarios || ''
        };
      })
      .filter(Boolean);
  }

  function renderCartDrawer() {
    const body = document.getElementById('cartDrawerBody');
    const items = getResolvedCartItems();

    if (state.lastReceipt && !items.length) {
      const p = state.lastReceipt;
      body.innerHTML = `
        <div class="receipt-box">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span class="badge badge-green">Pedido #${esc(p.id)} Confirmado</span>
            <small style="color:var(--text-secondary);">${esc(p.total_personas)} persona(s)</small>
          </div>
          <h3 style="margin-bottom:8px;">¡Gracias, ${esc(p.comprador_nombre)}!</h3>
          <p style="margin:0 0 12px; font-size:0.88rem; color:var(--text-secondary);">
            Comprobante enviado a <strong>${esc(p.comprador_correo)}</strong>.
          </p>
          <div style="margin-bottom:12px;">
            ${(p.items || []).map(it => `
              <div style="display:flex; justify-content:space-between; font-size:0.88rem; padding:4px 0;">
                <span>${esc(it.plan_nombre)} × ${esc(it.cantidad_personas)} pers. (${formatMoney(it.precio_unitario)} c/u)</span>
                <strong>${formatMoney(it.subtotal_item)}</strong>
              </div>
            `).join('')}
          </div>
          <div class="calc-box">
            <div class="calc-row"><span>Subtotal</span><span>${formatMoney(p.subtotal)}</span></div>
            <div class="calc-row discount">
              <span>Descuento (${esc(p.descuento_porcentaje)}%${p.cupon ? ` • Cupón ${esc(p.cupon)}` : ''})</span>
              <span>-${formatMoney(p.descuento_monto)}</span>
            </div>
            <div class="calc-row"><span>Base imponible</span><span>${formatMoney(p.base_imponible)}</span></div>
            <div class="calc-row"><span>IVA (${esc(p.iva_porcentaje)}%)</span><span>+${formatMoney(p.iva_monto)}</span></div>
            <div class="calc-row total"><span>Total Pagado</span><span>${formatMoney(p.total)}</span></div>
          </div>
          <div style="display:flex; gap:10px; margin-top:14px;">
            ${state.user ? '<button type="button" class="btn btn-primary btn-block" id="btnReceiptGoPanel">Ver en Mi Panel</button>' : ''}
            <button type="button" class="btn btn-secondary btn-block" id="btnReceiptNew">Seguir comprando</button>
          </div>
        </div>
      `;

      const goBtn = document.getElementById('btnReceiptGoPanel');
      if (goBtn) {
        goBtn.addEventListener('click', () => {
          closeCartDrawer();
          state.activeTab = state.user.rol === 'admin' ? 'pedidos_admin' : 'membresia';
          setView('dashboard');
        });
      }
      document.getElementById('btnReceiptNew').addEventListener('click', () => {
        state.lastReceipt = null;
        renderCartDrawer();
      });
      return;
    }

    if (!items.length) {
      body.innerHTML = `
        <div class="empty-state">
          <p style="font-size:1.05rem; color:var(--text-primary); margin:0 0 8px;">Tu carrito está vacío</p>
          <p style="margin:0 0 16px;">Agrega una o varias membresías por persona para calcular automáticamente tus descuentos grupales e IVA (15%).</p>
          ${state.planes.length ? `
            <div style="display:flex; flex-direction:column; gap:8px; text-align:left;">
              ${state.planes.map(p => `
                <button type="button" class="btn btn-secondary btn-sm btn-block" data-quick-add="${p.id}">
                  + Agregar ${esc(p.nombre)} (${formatMoney(p.precio)} / persona)
                </button>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
      body.querySelectorAll('[data-quick-add]').forEach(btn => {
        btn.addEventListener('click', () => addToCart(Number(btn.dataset.quickAdd), 1, true));
      });
      return;
    }

    const calc = api.calculateCartTotals(items, state.cartCupon);

    body.innerHTML = `
      <div>
        <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:8px;">
          Escala de descuentos por personas
        </div>
        <div class="discount-tiers">
          <div class="tier-pill ${calc.total_personas >= 2 && calc.total_personas < 3 ? 'active' : ''}">
            <strong>5% OFF</strong>2 personas
          </div>
          <div class="tier-pill ${calc.total_personas >= 3 && calc.total_personas < 5 ? 'active' : ''}">
            <strong>10% OFF</strong>3–4 personas
          </div>
          <div class="tier-pill ${calc.total_personas >= 5 ? 'active' : ''}">
            <strong>15% OFF</strong>5+ personas
          </div>
        </div>
        <p style="margin:8px 0 0; font-size:0.82rem; color:var(--text-secondary);">
          ${esc(calc.siguiente_nivel)}
        </p>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px;">
        ${items.map(it => `
          <div class="cart-item">
            <div class="cart-item-top">
              <div>
                <strong>${esc(it.plan_nombre)}</strong>
                <div style="font-size:0.83rem; color:var(--text-secondary);">
                  ${formatMoney(it.precio_unitario)} / persona • ${esc(it.duracion_dias)} días
                </div>
              </div>
              <button type="button" class="btn btn-danger btn-sm" data-cart-remove="${it.plan_id}" aria-label="Quitar">✕</button>
            </div>

            <div class="cart-item-controls">
              <div class="qty-stepper">
                <span style="font-size:0.83rem; color:var(--text-secondary); margin-right:4px;">Personas:</span>
                <button type="button" data-cart-dec="${it.plan_id}">−</button>
                <input type="number" min="1" max="50" value="${esc(it.cantidad_personas)}" data-cart-qty="${it.plan_id}">
                <button type="button" data-cart-inc="${it.plan_id}">+</button>
              </div>
              <strong style="font-size:1.02rem;">${formatMoney(it.subtotal_item)}</strong>
            </div>

            <input
              type="text"
              placeholder="Nombres de beneficiarios (opcional, ej: Aaron, María, Luis)"
              value="${esc(it.beneficiarios)}"
              data-cart-benef="${it.plan_id}"
              style="padding:8px 10px; font-size:0.84rem;"
            >
          </div>
        `).join('')}
      </div>

      ${state.planes.length > items.length ? `
        <div style="display:flex; gap:8px;">
          <select id="cartAddPlanSelect" style="padding:8px 10px; font-size:0.86rem;">
            ${state.planes
              .filter(p => !items.some(it => it.plan_id === p.id))
              .map(p => `<option value="${p.id}">${esc(p.nombre)} (${formatMoney(p.precio)}/pers.)</option>`)
              .join('')}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" id="btnCartAddAnother">+ Plan</button>
        </div>
      ` : ''}

      <div>
        <label for="cartCouponInput" style="font-size:0.82rem;">Cupón promocional (prueba: <code>POWERFIT5</code> o <code>POWER10</code>)</label>
        <div class="coupon-row" style="margin-top:6px;">
          <input type="text" id="cartCouponInput" placeholder="Ej: POWERFIT5" value="${esc(state.cartCupon)}" style="padding:8px 10px;">
          <button type="button" class="btn btn-secondary btn-sm" id="btnApplyCoupon">Aplicar</button>
        </div>
        ${calc.cupon ? `<small style="color:var(--success);">Cupón <strong>${esc(calc.cupon)}</strong> aplicado (+${esc(calc.descuento_cupon_pct)}% extra, tope 25%).</small>` : ''}
        ${calc.cupon_invalido ? '<small style="color:var(--danger);">Cupón no válido. Usa POWERFIT5 o POWER10.</small>' : ''}
      </div>

      <div class="calc-box">
        <div class="calc-row">
          <span>Total personas en carrito</span>
          <strong>${esc(calc.total_personas)} persona${calc.total_personas > 1 ? 's' : ''}</strong>
        </div>
        <div class="calc-row">
          <span>Subtotal (${esc(calc.total_personas)} membresía${calc.total_personas > 1 ? 's' : ''})</span>
          <span>${formatMoney(calc.subtotal)}</span>
        </div>
        <div class="calc-row discount">
          <span>
            Descuento (${esc(calc.descuento_porcentaje)}%)
            <small style="display:block; font-weight:400; color:var(--text-secondary);">
              ${esc(calc.nivel_descuento)}${calc.cupon ? ` + Cupón ${esc(calc.cupon)}` : ''}
            </small>
          </span>
          <span>-${formatMoney(calc.descuento_monto)}</span>
        </div>
        <div class="calc-row">
          <span>Base imponible (Subtotal − Descuento)</span>
          <span>${formatMoney(calc.base_imponible)}</span>
        </div>
        <div class="calc-row">
          <span>IVA (${esc(calc.iva_porcentaje)}%)</span>
          <span>+${formatMoney(calc.iva_monto)}</span>
        </div>
        <div class="calc-row total">
          <span>Total a Pagar</span>
          <span>${formatMoney(calc.total)}</span>
        </div>
      </div>

      <form id="cartCheckoutForm">
        ${state.user ? `
          <p style="margin:0 0 10px; font-size:0.84rem; color:var(--text-secondary);">
            Comprador: <strong>${esc(state.user.nombre)}</strong> (${esc(state.user.correo)}). Tu plan principal se activará automáticamente.
          </p>
        ` : `
          <div class="form-grid" style="margin-bottom:4px;">
            <div class="form-group" style="margin-bottom:10px;">
              <label for="chkNombre">Nombre del titular *</label>
              <input type="text" id="chkNombre" placeholder="Ej: Aaron Baldeon" required>
            </div>
            <div class="form-group" style="margin-bottom:10px;">
              <label for="chkCorreo">Correo para comprobante *</label>
              <input type="email" id="chkCorreo" placeholder="correo@ejemplo.com" required>
            </div>
          </div>
        `}
        <div style="display:flex; gap:10px;">
          <button type="button" class="btn btn-ghost btn-sm" id="btnClearCart">Vaciar</button>
          <button type="submit" class="btn btn-primary btn-block">Confirmar compra (${formatMoney(calc.total)})</button>
        </div>
      </form>
    `;

    // Bind stepper, remove, beneficiaries, coupon, checkout
    body.querySelectorAll('[data-cart-dec]').forEach(btn => {
      btn.addEventListener('click', () => {
        const it = state.cart.find(x => x.plan_id === Number(btn.dataset.cartDec));
        if (it && it.cantidad_personas > 1) {
          it.cantidad_personas -= 1;
          saveCart();
          renderCartDrawer();
        }
      });
    });

    body.querySelectorAll('[data-cart-inc]').forEach(btn => {
      btn.addEventListener('click', () => {
        const it = state.cart.find(x => x.plan_id === Number(btn.dataset.cartInc));
        if (it && it.cantidad_personas < 50) {
          it.cantidad_personas += 1;
          saveCart();
          renderCartDrawer();
        }
      });
    });

    body.querySelectorAll('[data-cart-qty]').forEach(input => {
      input.addEventListener('change', () => {
        const it = state.cart.find(x => x.plan_id === Number(input.dataset.cartQty));
        if (it) {
          it.cantidad_personas = Math.max(1, Math.min(50, Math.floor(Number(input.value) || 1)));
          saveCart();
          renderCartDrawer();
        }
      });
    });

    body.querySelectorAll('[data-cart-benef]').forEach(input => {
      input.addEventListener('input', () => {
        const it = state.cart.find(x => x.plan_id === Number(input.dataset.cartBenef));
        if (it) {
          it.beneficiarios = input.value;
          saveCart();
        }
      });
    });

    body.querySelectorAll('[data-cart-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.cart = state.cart.filter(x => x.plan_id !== Number(btn.dataset.cartRemove));
        saveCart();
        renderCartDrawer();
      });
    });

    const addAnotherBtn = document.getElementById('btnCartAddAnother');
    if (addAnotherBtn) {
      addAnotherBtn.addEventListener('click', () => {
        const sel = document.getElementById('cartAddPlanSelect');
        if (sel) addToCart(Number(sel.value), 1, true);
      });
    }

    document.getElementById('btnApplyCoupon').addEventListener('click', () => {
      state.cartCupon = document.getElementById('cartCouponInput').value.trim();
      renderCartDrawer();
    });

    document.getElementById('btnClearCart').addEventListener('click', () => {
      state.cart = [];
      state.cartCupon = '';
      saveCart();
      renderCartDrawer();
    });

    document.getElementById('cartCheckoutForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const payload = {
          items: items.map(it => ({
            plan_id: it.plan_id,
            cantidad_personas: it.cantidad_personas,
            beneficiarios: it.beneficiarios
          })),
          cupon: state.cartCupon
        };
        if (!state.user) {
          payload.comprador_nombre = document.getElementById('chkNombre').value.trim();
          payload.comprador_correo = document.getElementById('chkCorreo').value.trim();
        }
        const res = await api.createPedido(payload);
        state.lastReceipt = res.pedido;
        state.cart = [];
        state.cartCupon = '';
        saveCart();
        showToast(res.message, 'success');
        renderCartDrawer();
        if (state.view === 'dashboard') renderDashboard();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ================= MODAL AUTH =================
  function openAuthModal(tab = 'login') {
    const modal = document.getElementById('authModal');
    modal.classList.remove('hidden');
    switchAuthTab(tab);
  }

  function closeAuthModal() {
    document.getElementById('authModal').classList.add('hidden');
  }

  function switchAuthTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabLogin = document.getElementById('tabAuthLogin');
    const tabRegister = document.getElementById('tabAuthRegister');
    const title = document.getElementById('authModalTitle');

    if (tab === 'register') {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
      tabLogin.classList.remove('active');
      tabRegister.classList.add('active');
      title.textContent = 'Crear cuenta en Powerfit';
    } else {
      registerForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
      tabRegister.classList.remove('active');
      tabLogin.classList.add('active');
      title.textContent = 'Iniciar sesión en Powerfit';
    }
  }

  // ================= NAVEGACION & VISTAS =================
  function updateNavbar() {
    const guestBox = document.getElementById('authGuestActions');
    const userBox = document.getElementById('authUserActions');
    const roleBadge = document.getElementById('navUserRole');
    const toggleBtn = document.getElementById('btnToggleView');

    if (state.user) {
      guestBox.classList.add('hidden');
      userBox.classList.remove('hidden');
      roleBadge.textContent = roleLabel(state.user.rol);
      toggleBtn.textContent = state.view === 'dashboard' ? 'Sitio Público' : 'Mi Panel';
    } else {
      guestBox.classList.remove('hidden');
      userBox.classList.add('hidden');
    }
  }

  function setView(nextView) {
    state.view = nextView === 'dashboard' && state.user ? 'dashboard' : 'public';
    document.getElementById('publicView').classList.toggle('hidden', state.view !== 'public');
    document.getElementById('dashboardView').classList.toggle('hidden', state.view !== 'dashboard');
    updateNavbar();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (state.view === 'dashboard') {
      renderDashboard();
    } else {
      loadPublicData();
    }
  }

  // ================= VISTA PUBLICA =================
  async function loadPublicData() {
    try {
      const [planesRes, horariosRes, ejerciciosRes] = await Promise.all([
        api.getPlanes(),
        api.getHorarios(),
        api.getEjercicios('Todos')
      ]);
      state.planes = planesRes.planes || [];
      state.horarios = horariosRes.horarios || [];
      state.ejercicios = ejerciciosRes.ejercicios || [];
      renderPublicPlanes();
      renderPublicHorarios();
      renderPublicExercises();
    } catch (err) {
      showToast(`Error cargando datos: ${err.message}`, 'error');
    }
  }

  function renderPublicPlanes() {
    const grid = document.getElementById('publicPlanesGrid');
    grid.innerHTML = state.planes.map(plan => {
      const benefits = String(plan.beneficios || '').split('|').filter(Boolean);
      return `
        <article class="card ${plan.destacado ? 'card-featured' : ''}" data-plan-card="${plan.id}">
          <img src="${esc(plan.imagen_url)}" alt="${esc(plan.nombre)}" class="plan-img">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <h3 style="margin:0;">${esc(plan.nombre)}</h3>
            ${plan.destacado ? '<span class="badge badge-red">Popular</span>' : ''}
          </div>
          <div class="plan-price">${formatMoney(plan.precio)} <span>/ persona · ${esc(plan.duracion_dias)} días</span></div>
          <p style="color:var(--text-secondary); font-size:0.92rem; margin:6px 0 0;">${esc(plan.descripcion)}</p>
          <ul class="benefit-list">
            ${benefits.map(b => `<li>${esc(b)}</li>`).join('')}
          </ul>
          <div class="plan-qty-row">
            <span>Personas:</span>
            <div class="qty-stepper">
              <button type="button" data-plan-dec="${plan.id}" aria-label="Disminuir personas">−</button>
              <input type="number" min="1" max="50" value="1" data-plan-qty="${plan.id}" aria-label="Cantidad de personas">
              <button type="button" data-plan-inc="${plan.id}" aria-label="Aumentar personas">+</button>
            </div>
          </div>
          <div style="font-size:0.83rem; color:var(--text-secondary); margin-bottom:10px; text-align:right;" data-plan-preview="${plan.id}">
            Subtotal: <strong>${formatMoney(plan.precio)}</strong> (+ IVA en carrito)
          </div>
          <button class="btn ${plan.destacado ? 'btn-primary' : 'btn-secondary'} btn-block" data-add-cart="${plan.id}">
            🛒 Agregar al carrito
          </button>
        </article>
      `;
    }).join('');

    function updatePreview(planId) {
      const plan = state.planes.find(p => p.id === planId);
      const input = grid.querySelector(`[data-plan-qty="${planId}"]`);
      const preview = grid.querySelector(`[data-plan-preview="${planId}"]`);
      if (!plan || !input || !preview) return;
      const qty = Math.max(1, Math.min(50, Math.floor(Number(input.value) || 1)));
      input.value = String(qty);
      const calc = api.calculateCartTotals([{ precio_unitario: plan.precio, cantidad_personas: qty }]);
      preview.innerHTML = qty > 1
        ? `${qty} pers: <strong>${formatMoney(calc.subtotal)}</strong> • Desc. ${calc.descuento_porcentaje}% + IVA → <strong>${formatMoney(calc.total)}</strong>`
        : `Subtotal: <strong>${formatMoney(calc.subtotal)}</strong> • Total c/IVA: <strong>${formatMoney(calc.total)}</strong>`;
    }

    grid.querySelectorAll('[data-plan-dec]').forEach(btn => {
      btn.addEventListener('click', () => {
        const planId = Number(btn.dataset.planDec);
        const input = grid.querySelector(`[data-plan-qty="${planId}"]`);
        if (input && Number(input.value) > 1) {
          input.value = String(Number(input.value) - 1);
          updatePreview(planId);
        }
      });
    });

    grid.querySelectorAll('[data-plan-inc]').forEach(btn => {
      btn.addEventListener('click', () => {
        const planId = Number(btn.dataset.planInc);
        const input = grid.querySelector(`[data-plan-qty="${planId}"]`);
        if (input && Number(input.value) < 50) {
          input.value = String(Number(input.value) + 1);
          updatePreview(planId);
        }
      });
    });

    grid.querySelectorAll('[data-plan-qty]').forEach(input => {
      input.addEventListener('input', () => updatePreview(Number(input.dataset.planQty)));
    });

    grid.querySelectorAll('[data-add-cart]').forEach(btn => {
      btn.addEventListener('click', () => {
        const planId = Number(btn.dataset.addCart);
        const input = grid.querySelector(`[data-plan-qty="${planId}"]`);
        const qty = input ? Number(input.value) : 1;
        addToCart(planId, qty, true);
      });
    });
  }

  function renderPublicHorarios() {
    const body = document.getElementById('publicHorariosBody');
    if (!state.horarios.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No hay horarios registrados.</td></tr>';
      return;
    }
    body.innerHTML = state.horarios.map(h => `
      <tr>
        <td><strong>${esc(h.actividad)}</strong></td>
        <td>${esc(h.dia_semana)}</td>
        <td>${esc(h.hora_inicio)} – ${esc(h.hora_fin)}</td>
        <td>${esc(h.entrenador_nombre)}</td>
        <td>${esc(h.sala)}</td>
        <td><span class="badge badge-neutral">${esc(h.cupo)} cupos</span></td>
      </tr>
    `).join('');
  }

  function renderPublicExercises() {
    const filterBar = document.getElementById('publicExerciseFilters');
    filterBar.innerHTML = GRUPOS_MUSCULARES.map(g => `
      <button type="button" class="chip ${state.selectedGrupo === g ? 'active' : ''}" data-grupo="${esc(g)}">${esc(g)}</button>
    `).join('');

    filterBar.querySelectorAll('[data-grupo]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedGrupo = btn.dataset.grupo;
        renderPublicExercises();
      });
    });

    const filtered = state.selectedGrupo === 'Todos'
      ? state.ejercicios
      : state.ejercicios.filter(e => e.grupo_muscular === state.selectedGrupo);

    const grid = document.getElementById('publicExercisesGrid');
    if (!filtered.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No hay ejercicios para este grupo muscular.</div>';
      return;
    }

    grid.innerHTML = filtered.map(e => `
      <article class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
          <span class="badge badge-red">${esc(e.grupo_muscular)}</span>
          <span class="badge badge-neutral">${esc(e.nivel)}</span>
        </div>
        <h3 style="margin-bottom:8px;">${esc(e.nombre)}</h3>
        <p style="color:var(--text-secondary); font-size:0.9rem; margin:0 0 12px; flex:1;">${esc(e.instrucciones)}</p>
        ${e.video_url ? `<video src="${esc(e.video_url)}" controls preload="metadata" style="border-radius:8px; max-height:170px; width:100%; background:#000;"></video>` : ''}
      </article>
    `).join('');
  }

  // ================= DASHBOARD POR ROL =================
  async function renderDashboard() {
    if (!state.user) return;
    document.getElementById('dashRoleBadge').textContent = `Portal ${roleLabel(state.user.rol)}`;
    document.getElementById('dashGreeting').textContent = `Hola, ${state.user.nombre}`;

    const subtitles = {
      cliente: 'Consulta tu rutina personalizada, controla tu membresía y registra tu progreso físico.',
      entrenador: 'Asigna rutinas personalizadas a tus clientes, gestiona el catálogo de ejercicios y revisa su avance.',
      admin: 'Administra usuarios, membresías, planes, horarios e indicadores clave de Powerfit.'
    };
    document.getElementById('dashSubtitle').textContent = subtitles[state.user.rol] || '';

    const tabsByRole = {
      cliente: [
        { id: 'rutina', label: 'Mi Rutina' },
        { id: 'progreso', label: 'Mi Progreso' },
        { id: 'membresia', label: 'Mi Membresía' },
        { id: 'horarios', label: 'Horarios' },
        { id: 'ejercicios', label: 'Ejercicios' }
      ],
      entrenador: [
        { id: 'asignar', label: 'Asignar Rutinas' },
        { id: 'clientes', label: 'Mis Clientes' },
        { id: 'ejercicios_coach', label: 'Catálogo Ejercicios' }
      ],
      admin: [
        { id: 'usuarios', label: 'Usuarios' },
        { id: 'planes_admin', label: 'Planes y Membresías' },
        { id: 'pedidos_admin', label: 'Pedidos / Ventas' },
        { id: 'horarios_admin', label: 'Horarios' },
        { id: 'consultas', label: 'Consultas' }
      ]
    };

    const tabs = tabsByRole[state.user.rol] || [];
    if (!tabs.some(t => t.id === state.activeTab)) {
      state.activeTab = tabs[0].id;
    }

    const tabsEl = document.getElementById('dashTabs');
    tabsEl.innerHTML = tabs.map(t => `
      <button type="button" class="tab-btn ${state.activeTab === t.id ? 'active' : ''}" data-dash-tab="${t.id}">
        ${esc(t.label)}
      </button>
    `).join('');

    tabsEl.querySelectorAll('[data-dash-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.dataset.dashTab;
        renderDashboard();
      });
    });

    if (state.user.rol === 'cliente') await renderClienteDashboard();
    else if (state.user.rol === 'entrenador') await renderEntrenadorDashboard();
    else if (state.user.rol === 'admin') await renderAdminDashboard();
  }

  // ----------------- PORTAL CLIENTE -----------------
  async function renderClienteDashboard() {
    const [memRes, rutRes, progRes, horRes, ejRes, planRes, pedRes] = await Promise.all([
      api.getMiMembresia(),
      api.getRutinas(),
      api.getProgreso(),
      api.getHorarios(),
      api.getEjercicios('Todos'),
      api.getPlanes(),
      api.getMisPedidos()
    ]);

    state.planes = planRes.planes || state.planes;
    const membresia = memRes.membresia;
    const rutinas = rutRes.rutinas || [];
    const progreso = progRes.progreso || [];
    const misPedidos = pedRes.pedidos || [];
    const completados = rutinas.filter(r => r.completado_hoy).length;
    const ultimoPeso = progreso.length ? `${progreso[progreso.length - 1].peso_kg} kg` : 'Sin datos';

    document.getElementById('dashKpis').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Membresía</div>
        <div class="kpi-value">${membresia ? esc(membresia.plan_nombre) : 'Sin plan'}</div>
        <div class="kpi-sub">${membershipBadge(membresia)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Vencimiento</div>
        <div class="kpi-value">${membresia ? esc(membresia.fecha_fin) : '—'}</div>
        <div class="kpi-sub">${membresia ? `Plan de ${membresia.duracion_dias} días` : 'Activa un plan en tu panel'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Ejercicios Asignados</div>
        <div class="kpi-value">${rutinas.length}</div>
        <div class="kpi-sub">${completados} completados hoy</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Último Peso</div>
        <div class="kpi-value">${esc(ultimoPeso)}</div>
        <div class="kpi-sub">${progreso.length} registros guardados</div>
      </div>
    `;

    const content = document.getElementById('dashContent');

    if (state.activeTab === 'rutina') {
      if (!rutinas.length) {
        content.innerHTML = '<div class="empty-state">Aún no tienes una rutina asignada. Un entrenador de Powerfit la cargará pronto en tu cuenta.</div>';
        return;
      }

      const grouped = {};
      rutinas.forEach(r => {
        if (!grouped[r.dia_semana]) grouped[r.dia_semana] = [];
        grouped[r.dia_semana].push(r);
      });

      content.innerHTML = Object.entries(grouped).map(([dia, items]) => `
        <div class="routine-day">
          <h3><span class="badge badge-red">${esc(dia)}</span> ${items.length} ejercicio(s)</h3>
          ${items.map(r => `
            <div class="routine-item ${r.completado_hoy ? 'done' : ''}">
              <div style="flex:1; min-width:240px;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <strong>${esc(r.ejercicio_nombre)}</strong>
                  <span class="badge badge-neutral">${esc(r.grupo_muscular)}</span>
                </div>
                <div class="routine-meta">
                  <span><strong>Series:</strong> ${esc(r.series)}</span>
                  <span><strong>Reps:</strong> ${esc(r.repeticiones)}</span>
                  <span><strong>Descanso:</strong> ${esc(r.descanso_seg)}s</span>
                  <span><strong>Coach:</strong> ${esc(r.entrenador_nombre)}</span>
                </div>
                ${r.notas ? `<p style="margin:6px 0 0; font-size:0.86rem; color:var(--text-secondary);">Nota: ${esc(r.notas)}</p>` : ''}
                ${r.video_url ? `<video src="${esc(r.video_url)}" controls preload="metadata" style="margin-top:10px; border-radius:8px; max-width:340px; width:100%;"></video>` : ''}
              </div>
              <button class="btn ${r.completado_hoy ? 'btn-success' : 'btn-secondary'} btn-sm" data-toggle-rutina="${r.id}">
                ${r.completado_hoy ? '✓ Completado' : 'Marcar hecho'}
              </button>
            </div>
          `).join('')}
        </div>
      `).join('');

      content.querySelectorAll('[data-toggle-rutina]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await api.toggleRutina(Number(btn.dataset.toggleRutina));
            renderClienteDashboard();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } else if (state.activeTab === 'progreso') {
      content.innerHTML = `
        <div class="grid-2" style="align-items:start;">
          <div>
            <div class="chart-box">
              <h3 style="margin-bottom:10px;">Evolución de Peso Corporal (kg)</h3>
              ${renderWeightChartSvg(progreso)}
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Fecha</th><th>Peso (kg)</th><th>Cintura (cm)</th><th>Entrenos/sem</th><th>Notas</th></tr>
                </thead>
                <tbody>
                  ${progreso.length ? [...progreso].reverse().map(p => `
                    <tr>
                      <td>${esc(p.fecha)}</td>
                      <td><strong>${esc(p.peso_kg)} kg</strong></td>
                      <td>${p.cintura_cm ? `${esc(p.cintura_cm)} cm` : '—'}</td>
                      <td>${esc(p.entrenamientos_semana)}</td>
                      <td>${esc(p.notas || '—')}</td>
                    </tr>
                  `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Sin registros aún.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

          <form class="card" id="progresoForm">
            <h3>Registrar nuevo avance</h3>
            <div class="form-grid">
              <div class="form-group">
                <label for="progFecha">Fecha</label>
                <input type="date" id="progFecha" value="${new Date().toISOString().slice(0, 10)}" required>
              </div>
              <div class="form-group">
                <label for="progPeso">Peso (kg) *</label>
                <input type="number" step="0.1" min="25" max="250" id="progPeso" placeholder="74.5" required>
              </div>
              <div class="form-group">
                <label for="progCintura">Cintura (cm)</label>
                <input type="number" step="0.1" min="40" max="200" id="progCintura" placeholder="81.0">
              </div>
              <div class="form-group">
                <label for="progEntrenos">Entrenos / semana</label>
                <input type="number" min="0" max="14" id="progEntrenos" value="4">
              </div>
              <div class="form-group full">
                <label for="progNotas">Observaciones</label>
                <textarea id="progNotas" rows="3" placeholder="Ej: Subí peso en sentadilla, mejor resistencia..."></textarea>
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Guardar progreso</button>
          </form>
        </div>
      `;

      document.getElementById('progresoForm').addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const res = await api.addProgreso({
            fecha: document.getElementById('progFecha').value,
            peso_kg: document.getElementById('progPeso').value,
            cintura_cm: document.getElementById('progCintura').value,
            entrenamientos_semana: document.getElementById('progEntrenos').value,
            notas: document.getElementById('progNotas').value
          });
          showToast(res.message, 'success');
          renderClienteDashboard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    } else if (state.activeTab === 'membresia') {
      const planes = planRes.planes || [];
      content.innerHTML = `
        <div class="card" style="margin-bottom:22px;">
          <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:12px; align-items:center;">
            <div>
              <h3 style="margin-bottom:4px;">Estado actual de tu membresía</h3>
              <p style="margin:0; color:var(--text-secondary);">
                ${membresia
                  ? `Plan <strong>${esc(membresia.plan_nombre)}</strong> • Vigente desde ${esc(membresia.fecha_inicio)} hasta <strong>${esc(membresia.fecha_fin)}</strong>.`
                  : 'Actualmente no cuentas con una membresía activa. Agrega un plan al carrito para calcular descuentos + IVA.'}
              </p>
            </div>
            ${membershipBadge(membresia)}
          </div>
        </div>

        <h3 style="margin-bottom:14px;">Agregar membresías al carrito (individual o grupal)</h3>
        <div class="grid-3" style="margin-bottom:28px;">
          ${planes.map(p => `
            <div class="card ${p.destacado ? 'card-featured' : ''}">
              <h4>${esc(p.nombre)}</h4>
              <div class="plan-price">${formatMoney(p.precio)} <span>/ pers · ${esc(p.duracion_dias)} días</span></div>
              <p style="color:var(--text-secondary); font-size:0.88rem; flex:1;">${esc(p.descripcion)}</p>
              <div class="plan-qty-row">
                <span>Personas:</span>
                <div class="qty-stepper">
                  <button type="button" data-dash-dec="${p.id}">−</button>
                  <input type="number" min="1" max="50" value="1" data-dash-qty="${p.id}">
                  <button type="button" data-dash-inc="${p.id}">+</button>
                </div>
              </div>
              <button class="btn btn-primary btn-sm btn-block" data-dash-add-cart="${p.id}">🛒 Agregar al carrito</button>
            </div>
          `).join('')}
        </div>

        <h3 style="margin-bottom:12px;">Mis pedidos y comprobantes</h3>
        ${misPedidos.length ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Pedido</th><th>Detalle</th><th>Personas</th><th>Subtotal</th><th>Descuento</th><th>IVA (15%)</th><th>Total</th></tr>
              </thead>
              <tbody>
                ${misPedidos.map(o => `
                  <tr>
                    <td><strong>#${esc(o.id)}</strong><br><small style="color:var(--text-muted);">${esc(String(o.creado_en || '').slice(0, 10))}</small></td>
                    <td>${(o.items || []).map(it => `${esc(it.plan_nombre)} (×${esc(it.cantidad_personas)})`).join(', ')}</td>
                    <td><span class="badge badge-blue">${esc(o.total_personas)}</span></td>
                    <td>${formatMoney(o.subtotal)}</td>
                    <td style="color:var(--success);">-${formatMoney(o.descuento_monto)} (${esc(o.descuento_porcentaje)}%)</td>
                    <td>+${formatMoney(o.iva_monto)}</td>
                    <td><strong>${formatMoney(o.total)}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="empty-state">Aún no has realizado pedidos desde el carrito.</div>'}
      `;

      content.querySelectorAll('[data-dash-dec]').forEach(btn => {
        btn.addEventListener('click', () => {
          const inp = content.querySelector(`[data-dash-qty="${btn.dataset.dashDec}"]`);
          if (inp && Number(inp.value) > 1) inp.value = String(Number(inp.value) - 1);
        });
      });

      content.querySelectorAll('[data-dash-inc]').forEach(btn => {
        btn.addEventListener('click', () => {
          const inp = content.querySelector(`[data-dash-qty="${btn.dataset.dashInc}"]`);
          if (inp && Number(inp.value) < 50) inp.value = String(Number(inp.value) + 1);
        });
      });

      content.querySelectorAll('[data-dash-add-cart]').forEach(btn => {
        btn.addEventListener('click', () => {
          const planId = Number(btn.dataset.dashAddCart);
          const inp = content.querySelector(`[data-dash-qty="${planId}"]`);
          addToCart(planId, inp ? Number(inp.value) : 1, true);
        });
      });
    } else if (state.activeTab === 'horarios') {
      const horarios = horRes.horarios || [];
      content.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Actividad</th><th>Días</th><th>Horario</th><th>Entrenador</th><th>Sala</th><th>Cupo</th></tr>
            </thead>
            <tbody>
              ${horarios.map(h => `
                <tr>
                  <td><strong>${esc(h.actividad)}</strong></td>
                  <td>${esc(h.dia_semana)}</td>
                  <td>${esc(h.hora_inicio)} – ${esc(h.hora_fin)}</td>
                  <td>${esc(h.entrenador_nombre)}</td>
                  <td>${esc(h.sala)}</td>
                  <td><span class="badge badge-neutral">${esc(h.cupo)}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (state.activeTab === 'ejercicios') {
      const ejercicios = ejRes.ejercicios || [];
      content.innerHTML = `
        <div class="grid-3">
          ${ejercicios.map(e => `
            <article class="card">
              <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:8px;">
                <span class="badge badge-red">${esc(e.grupo_muscular)}</span>
                <span class="badge badge-neutral">${esc(e.nivel)}</span>
              </div>
              <h4>${esc(e.nombre)}</h4>
              <p style="color:var(--text-secondary); font-size:0.88rem; margin:0;">${esc(e.instrucciones)}</p>
              ${e.video_url ? `<video src="${esc(e.video_url)}" controls preload="metadata" style="margin-top:10px; border-radius:8px;"></video>` : ''}
            </article>
          `).join('')}
        </div>
      `;
    }
  }

  function renderWeightChartSvg(progreso) {
    if (!progreso || progreso.length < 2) {
      return '<p style="color:var(--text-muted); margin:0;">Registra al menos 2 mediciones de peso para visualizar la gráfica de tendencia.</p>';
    }
    const w = 520;
    const h = 160;
    const pad = 28;
    const weights = progreso.map(p => Number(p.peso_kg));
    const minW = Math.min(...weights) - 1;
    const maxW = Math.max(...weights) + 1;
    const range = maxW - minW || 1;

    const points = progreso.map((p, idx) => {
      const x = pad + (idx / (progreso.length - 1)) * (w - pad * 2);
      const y = h - pad - ((Number(p.peso_kg) - minW) / range) * (h - pad * 2);
      return { x, y, peso: p.peso_kg, fecha: p.fecha };
    });

    const polyline = points.map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
    return `
      <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; display:block;" role="img" aria-label="Gráfica de evolución de peso">
        <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="rgba(255,255,255,0.15)" />
        <polyline fill="none" stroke="#e50914" stroke-width="3" points="${polyline}" />
        ${points.map(pt => `
          <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="5" fill="#fff" stroke="#e50914" stroke-width="2.5" />
          <text x="${pt.x.toFixed(1)}" y="${(pt.y - 10).toFixed(1)}" text-anchor="middle" fill="#f5f5f7" font-size="11">${esc(pt.peso)}kg</text>
          <text x="${pt.x.toFixed(1)}" y="${h - 8}" text-anchor="middle" fill="#7f7f90" font-size="10">${esc(pt.fecha.slice(5))}</text>
        `).join('')}
      </svg>
    `;
  }

  // ----------------- PANEL ENTRENADOR -----------------
  async function renderEntrenadorDashboard() {
    const [cliRes, ejRes, horRes] = await Promise.all([
      api.getClientes(),
      api.getEjercicios('Todos'),
      api.getHorarios()
    ]);

    const clientes = cliRes.clientes || [];
    const ejercicios = ejRes.ejercicios || [];
    const horarios = horRes.horarios || [];

    if (!state.selectedClienteId && clientes.length) {
      state.selectedClienteId = clientes[0].id;
    }

    const totalRutinas = clientes.reduce((acc, c) => acc + Number(c.total_rutinas || 0), 0);

    document.getElementById('dashKpis').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Clientes Activos</div>
        <div class="kpi-value">${clientes.length}</div>
        <div class="kpi-sub">Disponibles para asignar rutina</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Ejercicios Asignados</div>
        <div class="kpi-value">${totalRutinas}</div>
        <div class="kpi-sub">Entre todos los alumnos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Catálogo Ejercicios</div>
        <div class="kpi-value">${ejercicios.length}</div>
        <div class="kpi-sub">Por grupo muscular</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Clases en Horario</div>
        <div class="kpi-value">${horarios.length}</div>
        <div class="kpi-sub">Sesiones semanales</div>
      </div>
    `;

    const content = document.getElementById('dashContent');

    if (state.activeTab === 'asignar') {
      const rutRes = state.selectedClienteId ? await api.getRutinas(state.selectedClienteId) : { rutinas: [] };
      const rutinasCliente = rutRes.rutinas || [];

      content.innerHTML = `
        <div class="grid-2" style="align-items:start;">
          <form class="card" id="assignRutinaForm">
            <h3>Asignar ejercicio a rutina</h3>
            <div class="form-group">
              <label for="arCliente">Cliente *</label>
              <select id="arCliente" required>
                ${clientes.map(c => `<option value="${c.id}" ${c.id === state.selectedClienteId ? 'selected' : ''}>${esc(c.nombre)} (${esc(c.plan_nombre || 'Sin plan')})</option>`).join('')}
              </select>
            </div>
            <div class="form-grid">
              <div class="form-group">
                <label for="arDia">Día de entrenamiento *</label>
                <select id="arDia" required>
                  ${DIAS_SEMANA.map(d => `<option value="${d}">${d}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label for="arEjercicio">Ejercicio *</label>
                <select id="arEjercicio" required>
                  ${ejercicios.map(e => `<option value="${e.id}">[${esc(e.grupo_muscular)}] ${esc(e.nombre)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label for="arSeries">Series *</label>
                <input type="number" id="arSeries" min="1" max="10" value="4" required>
              </div>
              <div class="form-group">
                <label for="arReps">Repeticiones / Tiempo *</label>
                <input type="text" id="arReps" value="10-12" required>
              </div>
              <div class="form-group full">
                <label for="arDescanso">Descanso (segundos)</label>
                <input type="number" id="arDescanso" min="0" max="300" value="60">
              </div>
              <div class="form-group full">
                <label for="arNotas">Indicaciones técnicas</label>
                <textarea id="arNotas" rows="2" placeholder="Ej: Mantener espalda recta, controlar bajada 2s..."></textarea>
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Agregar a rutina del cliente</button>
          </form>

          <div class="card">
            <h3>Rutina actual del cliente seleccionado</h3>
            ${rutinasCliente.length ? rutinasCliente.map(r => `
              <div class="routine-item">
                <div>
                  <span class="badge badge-red">${esc(r.dia_semana)}</span>
                  <strong style="margin-left:6px;">${esc(r.ejercicio_nombre)}</strong>
                  <div class="routine-meta">
                    <span>${esc(r.series)}x${esc(r.repeticiones)}</span>
                    <span>Descanso: ${esc(r.descanso_seg)}s</span>
                  </div>
                  ${r.notas ? `<div style="font-size:0.84rem;color:var(--text-secondary);margin-top:4px;">${esc(r.notas)}</div>` : ''}
                </div>
                <button class="btn btn-danger btn-sm" data-del-rutina="${r.id}">Quitar</button>
              </div>
            `).join('') : '<div class="empty-state">Este cliente aún no tiene ejercicios asignados.</div>'}
          </div>
        </div>
      `;

      document.getElementById('arCliente').addEventListener('change', e => {
        state.selectedClienteId = Number(e.target.value);
        renderEntrenadorDashboard();
      });

      document.getElementById('assignRutinaForm').addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const res = await api.assignRutina({
            cliente_id: Number(document.getElementById('arCliente').value),
            dia_semana: document.getElementById('arDia').value,
            ejercicio_id: Number(document.getElementById('arEjercicio').value),
            series: Number(document.getElementById('arSeries').value),
            repeticiones: document.getElementById('arReps').value,
            descanso_seg: Number(document.getElementById('arDescanso').value),
            notas: document.getElementById('arNotas').value
          });
          showToast(res.message, 'success');
          renderEntrenadorDashboard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });

      content.querySelectorAll('[data-del-rutina]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            const res = await api.deleteRutina(Number(btn.dataset.delRutina));
            showToast(res.message, 'info');
            renderEntrenadorDashboard();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } else if (state.activeTab === 'clientes') {
      content.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Cliente</th><th>Correo / Teléfono</th><th>Plan</th><th>Vence</th><th>Ejercicios</th><th>Acción</th></tr>
            </thead>
            <tbody>
              ${clientes.map(c => `
                <tr>
                  <td><strong>${esc(c.nombre)}</strong> (${esc(c.edad)} años)</td>
                  <td>${esc(c.correo)}<br><small style="color:var(--text-muted);">${esc(c.telefono || '—')}</small></td>
                  <td>${esc(c.plan_nombre || 'Sin plan')}</td>
                  <td>${esc(c.fecha_fin || '—')}</td>
                  <td><span class="badge badge-blue">${esc(c.total_rutinas)}</span></td>
                  <td>
                    <button class="btn btn-secondary btn-sm" data-manage-cliente="${c.id}">Gestionar rutina</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      content.querySelectorAll('[data-manage-cliente]').forEach(btn => {
        btn.addEventListener('click', () => {
          state.selectedClienteId = Number(btn.dataset.manageCliente);
          state.activeTab = 'asignar';
          renderDashboard();
        });
      });
    } else if (state.activeTab === 'ejercicios_coach') {
      content.innerHTML = `
        <div class="grid-2" style="align-items:start;">
          <form class="card" id="newEjercicioForm">
            <h3>Agregar ejercicio al catálogo</h3>
            <div class="form-group">
              <label for="ejNombre">Nombre del ejercicio *</label>
              <input type="text" id="ejNombre" placeholder="Ej: Peso Muerto Rumano" required>
            </div>
            <div class="form-grid">
              <div class="form-group">
                <label for="ejGrupo">Grupo muscular *</label>
                <select id="ejGrupo" required>
                  ${GRUPOS_MUSCULARES.filter(g => g !== 'Todos').map(g => `<option value="${g}">${g}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label for="ejNivel">Nivel</label>
                <select id="ejNivel">
                  <option value="Principiante">Principiante</option>
                  <option value="Intermedio" selected>Intermedio</option>
                  <option value="Avanzado">Avanzado</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label for="ejInstrucciones">Instrucciones de técnica *</label>
              <textarea id="ejInstrucciones" rows="3" required placeholder="Describe postura, recorrido y respiración..."></textarea>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Guardar ejercicio</button>
          </form>

          <div class="card">
            <h3>Ejercicios registrados (${ejercicios.length})</h3>
            <div style="display:flex; flex-direction:column; gap:10px; max-height:480px; overflow-y:auto;">
              ${ejercicios.map(e => `
                <div style="padding:12px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-surface-2);">
                  <div style="display:flex; justify-content:space-between; gap:8px;">
                    <strong>${esc(e.nombre)}</strong>
                    <span class="badge badge-red">${esc(e.grupo_muscular)}</span>
                  </div>
                  <p style="margin:6px 0 0; font-size:0.86rem; color:var(--text-secondary);">${esc(e.instrucciones)}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;

      document.getElementById('newEjercicioForm').addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const res = await api.createEjercicio({
            nombre: document.getElementById('ejNombre').value,
            grupo_muscular: document.getElementById('ejGrupo').value,
            nivel: document.getElementById('ejNivel').value,
            instrucciones: document.getElementById('ejInstrucciones').value
          });
          showToast(res.message, 'success');
          renderEntrenadorDashboard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }
  }

  // ----------------- PANEL ADMINISTRADOR -----------------
  async function renderAdminDashboard() {
    const [resumenRes, usersRes, planesRes, horRes, consRes, pedRes] = await Promise.all([
      api.getAdminResumen(),
      api.getAdminUsuarios(),
      api.getPlanes(),
      api.getHorarios(),
      api.getAdminConsultas(),
      api.getAdminPedidos()
    ]);

    state.planes = planesRes.planes || state.planes;
    const r = resumenRes.resumen;
    const usuarios = usersRes.usuarios || [];
    const planes = planesRes.planes || [];
    const horarios = horRes.horarios || [];
    const consultas = consRes.consultas || [];
    const pedidos = pedRes.pedidos || [];

    document.getElementById('dashKpis').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Clientes Activos</div>
        <div class="kpi-value">${r.totalClientes}</div>
        <div class="kpi-sub">${r.totalEntrenadores} entrenador(es)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Membresías Vigentes</div>
        <div class="kpi-value">${r.membresiasVigentes}</div>
        <div class="kpi-sub">${r.membresiasPorVencer} por vencer (≤ 7 días)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Ventas Carrito (c/IVA)</div>
        <div class="kpi-value">${formatMoney(r.ingresosPedidos || 0)}</div>
        <div class="kpi-sub">${r.totalPedidos || 0} pedido(s) • Planes activos: ${formatMoney(r.ingresosEstimados)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Consultas Pendientes</div>
        <div class="kpi-value">${r.consultasPendientes}</div>
        <div class="kpi-sub">${consultas.length} mensajes totales</div>
      </div>
    `;

    const content = document.getElementById('dashContent');

    if (state.activeTab === 'usuarios') {
      content.innerHTML = `
        <div class="grid-2" style="align-items:start; grid-template-columns: 1.5fr 1fr;">
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Usuario</th><th>Rol</th><th>Membresía</th><th>Estado</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                ${usuarios.map(u => `
                  <tr>
                    <td>
                      <strong>${esc(u.nombre)}</strong><br>
                      <small style="color:var(--text-muted);">${esc(u.correo)}</small>
                    </td>
                    <td>
                      <select data-user-role="${u.id}" style="padding:6px 8px; width:auto;" ${u.id === state.user.id ? 'disabled' : ''}>
                        <option value="cliente" ${u.rol === 'cliente' ? 'selected' : ''}>Cliente</option>
                        <option value="entrenador" ${u.rol === 'entrenador' ? 'selected' : ''}>Entrenador</option>
                        <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Admin</option>
                      </select>
                    </td>
                    <td>${u.plan_nombre ? `${esc(u.plan_nombre)}<br><small style="color:var(--text-muted);">Vence: ${esc(u.fecha_fin)}</small>` : '—'}</td>
                    <td><span class="badge ${u.activo ? 'badge-green' : 'badge-red'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td>
                      ${u.id !== state.user.id ? `
                        <button class="btn ${u.activo ? 'btn-danger' : 'btn-success'} btn-sm" data-toggle-active="${u.id}" data-next-active="${u.activo ? 0 : 1}">
                          ${u.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      ` : '<span style="color:var(--text-muted);font-size:0.82rem;">Tú</span>'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <form class="card" id="adminNewUserForm">
            <h3>Crear usuario / staff</h3>
            <div class="form-group">
              <label for="auNombre">Nombre completo *</label>
              <input type="text" id="auNombre" required>
            </div>
            <div class="form-group">
              <label for="auCorreo">Correo *</label>
              <input type="email" id="auCorreo" required>
            </div>
            <div class="form-grid">
              <div class="form-group">
                <label for="auRol">Rol *</label>
                <select id="auRol">
                  <option value="cliente">Cliente</option>
                  <option value="entrenador">Entrenador</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <div class="form-group">
                <label for="auTelefono">Teléfono</label>
                <input type="tel" id="auTelefono">
              </div>
            </div>
            <div class="form-group">
              <label for="auPassword">Contraseña inicial *</label>
              <input type="password" id="auPassword" minlength="6" required>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Registrar usuario</button>
          </form>
        </div>
      `;

      content.querySelectorAll('[data-user-role]').forEach(sel => {
        sel.addEventListener('change', async () => {
          try {
            await api.updateAdminUsuario(Number(sel.dataset.userRole), { rol: sel.value });
            showToast('Rol actualizado.', 'success');
            renderAdminDashboard();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });

      content.querySelectorAll('[data-toggle-active]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await api.updateAdminUsuario(Number(btn.dataset.toggleActive), { activo: Number(btn.dataset.nextActive) === 1 });
            showToast('Estado de cuenta actualizado.', 'info');
            renderAdminDashboard();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });

      document.getElementById('adminNewUserForm').addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const res = await api.createAdminUsuario({
            nombre: document.getElementById('auNombre').value,
            correo: document.getElementById('auCorreo').value,
            rol: document.getElementById('auRol').value,
            telefono: document.getElementById('auTelefono').value,
            password: document.getElementById('auPassword').value
          });
          showToast(res.message, 'success');
          renderAdminDashboard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    } else if (state.activeTab === 'planes_admin') {
      const clientes = usuarios.filter(u => u.rol === 'cliente');
      content.innerHTML = `
        <div class="card" style="margin-bottom:22px;">
          <h3>Asignar o renovar membresía a un cliente</h3>
          <form id="adminAssignMemForm" style="display:grid; grid-template-columns:1fr 1fr auto; gap:12px; align-items:end;">
            <div class="form-group" style="margin:0;">
              <label for="amCliente">Cliente</label>
              <select id="amCliente" required>
                ${clientes.map(c => `<option value="${c.id}">${esc(c.nombre)} (${esc(c.plan_nombre || 'Sin plan')})</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin:0;">
              <label for="amPlan">Plan</label>
              <select id="amPlan" required>
                ${planes.map(p => `<option value="${p.id}">${esc(p.nombre)} - ${formatMoney(p.precio)}</option>`).join('')}
              </select>
            </div>
            <button type="submit" class="btn btn-primary">Activar / Renovar</button>
          </form>
        </div>

        <h3 style="margin-bottom:14px;">Editar precios y condiciones de planes</h3>
        <div class="grid-3">
          ${planes.map(p => `
            <form class="card" data-edit-plan="${p.id}">
              <h4>${esc(p.nombre)}</h4>
              <div class="form-group">
                <label>Precio (USD)</label>
                <input type="number" step="0.50" name="precio" value="${esc(p.precio)}" required>
              </div>
              <div class="form-group">
                <label>Duración (días)</label>
                <input type="number" name="duracion_dias" value="${esc(p.duracion_dias)}" required>
              </div>
              <div class="form-group">
                <label>Descripción</label>
                <textarea name="descripcion" rows="3" required>${esc(p.descripcion)}</textarea>
              </div>
              <button type="submit" class="btn btn-secondary btn-block">Guardar cambios</button>
            </form>
          `).join('')}
        </div>
      `;

      document.getElementById('adminAssignMemForm').addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const res = await api.activarMembresia(
            Number(document.getElementById('amPlan').value),
            Number(document.getElementById('amCliente').value)
          );
          showToast(res.message, 'success');
          renderAdminDashboard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });

      content.querySelectorAll('[data-edit-plan]').forEach(form => {
        form.addEventListener('submit', async e => {
          e.preventDefault();
          const fd = new FormData(form);
          try {
            const res = await api.updateAdminPlan(Number(form.dataset.editPlan), {
              precio: Number(fd.get('precio')),
              duracion_dias: Number(fd.get('duracion_dias')),
              descripcion: String(fd.get('descripcion'))
            });
            showToast(res.message, 'success');
            renderAdminDashboard();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } else if (state.activeTab === 'horarios_admin') {
      content.innerHTML = `
        <div class="grid-2" style="align-items:start; grid-template-columns: 1.5fr 1fr;">
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Actividad</th><th>Días</th><th>Horario</th><th>Entrenador</th><th>Acción</th></tr>
              </thead>
              <tbody>
                ${horarios.map(h => `
                  <tr>
                    <td><strong>${esc(h.actividad)}</strong><br><small style="color:var(--text-muted);">${esc(h.sala)} (${esc(h.cupo)} cupos)</small></td>
                    <td>${esc(h.dia_semana)}</td>
                    <td>${esc(h.hora_inicio)} – ${esc(h.hora_fin)}</td>
                    <td>${esc(h.entrenador_nombre)}</td>
                    <td><button class="btn btn-danger btn-sm" data-del-horario="${h.id}">Eliminar</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <form class="card" id="adminHorarioForm">
            <h3>Nuevo horario / clase</h3>
            <div class="form-group">
              <label for="ahActividad">Actividad *</label>
              <input type="text" id="ahActividad" placeholder="Ej: Cross Training" required>
            </div>
            <div class="form-group">
              <label for="ahDias">Días *</label>
              <input type="text" id="ahDias" placeholder="Ej: Lunes, Miércoles y Viernes" required>
            </div>
            <div class="form-grid">
              <div class="form-group">
                <label for="ahInicio">Hora inicio *</label>
                <input type="time" id="ahInicio" value="08:00" required>
              </div>
              <div class="form-group">
                <label for="ahFin">Hora fin *</label>
                <input type="time" id="ahFin" value="09:00" required>
              </div>
              <div class="form-group">
                <label for="ahCoach">Entrenador *</label>
                <input type="text" id="ahCoach" value="Carlos Méndez" required>
              </div>
              <div class="form-group">
                <label for="ahCupo">Cupo</label>
                <input type="number" id="ahCupo" value="20" min="1">
              </div>
            </div>
            <div class="form-group">
              <label for="ahSala">Sala</label>
              <input type="text" id="ahSala" value="Sala Principal">
            </div>
            <button type="submit" class="btn btn-primary btn-block">Agregar horario</button>
          </form>
        </div>
      `;

      document.getElementById('adminHorarioForm').addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const res = await api.createAdminHorario({
            actividad: document.getElementById('ahActividad').value,
            dia_semana: document.getElementById('ahDias').value,
            hora_inicio: document.getElementById('ahInicio').value,
            hora_fin: document.getElementById('ahFin').value,
            entrenador_nombre: document.getElementById('ahCoach').value,
            sala: document.getElementById('ahSala').value,
            cupo: Number(document.getElementById('ahCupo').value)
          });
          showToast(res.message, 'success');
          renderAdminDashboard();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });

      content.querySelectorAll('[data-del-horario]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await api.deleteAdminHorario(Number(btn.dataset.delHorario));
            showToast('Horario eliminado.', 'info');
            renderAdminDashboard();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } else if (state.activeTab === 'pedidos_admin') {
      content.innerHTML = pedidos.length ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Pedido</th><th>Comprador</th><th>Membresías</th><th>Personas</th><th>Subtotal</th><th>Descuento</th><th>IVA (15%)</th><th>Total</th></tr>
            </thead>
            <tbody>
              ${pedidos.map(o => `
                <tr>
                  <td><strong>#${esc(o.id)}</strong><br><small style="color:var(--text-muted);">${esc(String(o.creado_en || '').slice(0, 10))}</small></td>
                  <td><strong>${esc(o.comprador_nombre)}</strong><br><small style="color:var(--text-muted);">${esc(o.comprador_correo)}</small></td>
                  <td>
                    ${(o.items || []).map(it => `
                      <div>${esc(it.plan_nombre)} × ${esc(it.cantidad_personas)} (${formatMoney(it.precio_unitario)})${it.beneficiarios ? `<br><small style="color:var(--text-muted);">Benef.: ${esc(it.beneficiarios)}</small>` : ''}</div>
                    `).join('')}
                  </td>
                  <td><span class="badge badge-blue">${esc(o.total_personas)}</span></td>
                  <td>${formatMoney(o.subtotal)}</td>
                  <td style="color:var(--success);">-${formatMoney(o.descuento_monto)} (${esc(o.descuento_porcentaje)}%${o.cupon ? ` • ${esc(o.cupon)}` : ''})</td>
                  <td>+${formatMoney(o.iva_monto)}</td>
                  <td><strong>${formatMoney(o.total)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty-state">Todavía no se han registrado ventas desde el carrito de membresías.</div>';
    } else if (state.activeTab === 'consultas') {
      content.innerHTML = consultas.length ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Interesado</th><th>Interés</th><th>Comentario</th><th>Estado</th><th>Acción</th></tr>
            </thead>
            <tbody>
              ${consultas.map(c => `
                <tr>
                  <td>
                    <strong>${esc(c.nombre)}</strong><br>
                    <small style="color:var(--text-muted);">${esc(c.correo)} ${c.telefono ? `• ${esc(c.telefono)}` : ''}</small>
                  </td>
                  <td>${esc(c.interes)}</td>
                  <td>${esc(c.comentario || '—')}</td>
                  <td><span class="badge ${c.atendida ? 'badge-green' : 'badge-yellow'}">${c.atendida ? 'Atendida' : 'Pendiente'}</span></td>
                  <td>
                    ${!c.atendida ? `<button class="btn btn-success btn-sm" data-atender="${c.id}">Marcar atendida</button>` : '✓'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty-state">No hay solicitudes de contacto registradas todavía.</div>';

      content.querySelectorAll('[data-atender]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await api.atenderConsulta(Number(btn.dataset.atender));
            showToast('Consulta marcada como atendida.', 'success');
            renderAdminDashboard();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    }
  }

  // ================= EVENTOS GLOBALES =================
  function bindEvents() {
    // Menú móvil
    const menuBtn = document.getElementById('btnMenuToggle');
    const navLinks = document.getElementById('navLinks');
    menuBtn.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.querySelectorAll('[data-public-link]').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        if (state.view !== 'public') setView('public');
      });
    });

    document.getElementById('brandHomeLink').addEventListener('click', () => {
      if (state.view !== 'public') setView('public');
    });

    // Carrito
    document.getElementById('btnOpenCart').addEventListener('click', openCartDrawer);
    document.getElementById('btnCloseCart').addEventListener('click', closeCartDrawer);
    document.getElementById('cartDrawerBackdrop').addEventListener('click', e => {
      if (e.target.id === 'cartDrawerBackdrop') closeCartDrawer();
    });

    // Botones Auth
    document.getElementById('btnOpenLogin').addEventListener('click', () => openAuthModal('login'));
    document.getElementById('btnOpenRegister').addEventListener('click', () => openAuthModal('register'));
    document.getElementById('btnHeroStart').addEventListener('click', () => {
      if (state.user) setView('dashboard');
      else openAuthModal('register');
    });
    document.getElementById('btnCloseAuthModal').addEventListener('click', closeAuthModal);
    document.getElementById('authModal').addEventListener('click', e => {
      if (e.target.id === 'authModal') closeAuthModal();
    });
    document.getElementById('tabAuthLogin').addEventListener('click', () => switchAuthTab('login'));
    document.getElementById('tabAuthRegister').addEventListener('click', () => switchAuthTab('register'));

    // Alternar vista y cerrar sesión
    document.getElementById('btnToggleView').addEventListener('click', () => {
      setView(state.view === 'dashboard' ? 'public' : 'dashboard');
    });
    document.getElementById('btnBackToPublic').addEventListener('click', () => setView('public'));
    document.getElementById('btnLogout').addEventListener('click', () => {
      api.logout();
      state.user = null;
      state.activeTab = null;
      showToast('Sesión cerrada correctamente.', 'info');
      setView('public');
    });

    // Login Form
    document.getElementById('loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const res = await api.login(
          document.getElementById('loginCorreo').value,
          document.getElementById('loginPassword').value
        );
        state.user = res.user;
        state.activeTab = null;
        closeAuthModal();
        showToast(`¡Bienvenido, ${res.user.nombre}!`, 'success');
        setView('dashboard');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Demo quick logins
    document.querySelectorAll('[data-demo-login]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const creds = DEMO_ACCOUNTS[btn.dataset.demoLogin];
        if (!creds) return;
        try {
          const res = await api.login(creds.correo, creds.password);
          state.user = res.user;
          state.activeTab = null;
          closeAuthModal();
          showToast(`Ingresaste como ${roleLabel(res.user.rol)} (${res.user.nombre}).`, 'success');
          setView('dashboard');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // Register Form
    document.getElementById('registerForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const res = await api.register({
          nombre: document.getElementById('regNombre').value,
          correo: document.getElementById('regCorreo').value,
          edad: Number(document.getElementById('regEdad').value),
          telefono: document.getElementById('regTelefono').value,
          password: document.getElementById('regPassword').value
        });
        state.user = res.user;
        state.activeTab = null;
        closeAuthModal();
        showToast('¡Cuenta creada con éxito! Ya puedes elegir tu plan y empezar.', 'success');
        setView('dashboard');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Contact Form
    document.getElementById('contactForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const res = await api.sendConsulta({
          nombre: document.getElementById('cNombre').value,
          correo: document.getElementById('cCorreo').value,
          telefono: document.getElementById('cTelefono').value,
          interes: document.getElementById('cInteres').value,
          comentario: document.getElementById('cComentario').value
        });
        showToast(res.message, 'success');
        e.target.reset();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ================= ARRANQUE =================
  async function bootstrap() {
    loadCart();
    bindEvents();
    const detectedMode = await api.init();
    const badge = document.getElementById('engineModeBadge');
    badge.textContent = detectedMode === 'remote' ? 'Backend Node + SQLite Activo' : 'Modo Local (Sin Servidor)';
    badge.className = `badge ${detectedMode === 'remote' ? 'badge-green' : 'badge-blue'}`;

    const meRes = await api.getMe();
    state.user = meRes.user;
    updateNavbar();
    await loadPublicData();
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
