const SUPABASE_URL = "https://cpyapqoqxkrgyrcyicyb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_4TPsjfxXz9LXxZxCVS8Wgw_eDF_wbvE";

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLE = "cobrancas";

/*  Estado do app */
let currentUser = null;
let cobrancas = [];
let authMode = "login"; // "login" | "signup"

/*  Elementos */
const el = (id) => document.getElementById(id);
const authScreen = el("auth-screen");
const appScreen = el("app-screen");

/*AUTENTICAÇÃO*/

function initAuthTabs() {
  el("tab-login").addEventListener("click", () => setAuthMode("login"));
  el("tab-signup").addEventListener("click", () => setAuthMode("signup"));
}

function setAuthMode(mode) {
  authMode = mode;
  el("tab-login").classList.toggle("tab-active", mode === "login");
  el("tab-login").classList.toggle("text-mist", mode !== "login");
  el("tab-signup").classList.toggle("tab-active", mode === "signup");
  el("tab-signup").classList.toggle("text-mist", mode !== "signup");
  el("auth-submit").textContent = mode === "login" ? "Entrar" : "Criar conta";
  el("auth-error").classList.add("hidden");
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = el("auth-email").value.trim();
  const password = el("auth-password").value;
  const errorEl = el("auth-error");
  errorEl.classList.add("hidden");
  el("auth-submit").disabled = true;

  try {
    if (authMode === "login") {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { error } = await db.auth.signUp({ email, password });
      if (error) throw error;
      errorEl.textContent = "Conta criada! Verifique seu e-mail se a confirmação estiver ativa, ou faça login.";
      errorEl.classList.remove("text-coral");
      errorEl.classList.add("text-teal");
      errorEl.classList.remove("hidden");
    }
  } catch (err) {
    errorEl.textContent = traduzErro(err.message);
    errorEl.classList.remove("hidden");
    errorEl.classList.remove("text-teal");
    errorEl.classList.add("text-coral");
  } finally {
    el("auth-submit").disabled = false;
  }
}

function traduzErro(msg) {
  if (!msg) return "Erro inesperado.";
  if (msg.includes("Invalid login")) return "E-mail ou senha inválidos.";
  if (msg.includes("already registered")) return "Este e-mail já está cadastrado.";
  if (msg.includes("Password should be")) return "Senha muito curta (mínimo 6 caracteres).";
  if (msg.includes("SUA_URL_AQUI") || msg.includes("fetch")) return "Configure as chaves do Supabase em app.js.";
  return msg;
}

async function handleLogout() {
  await db.auth.signOut();
}

function showApp(user) {
  currentUser = user;
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  el("user-email-label").textContent = user.email || "";
  loadCobrancas();
  setupNotificationButton();
}

function showAuth() {
  currentUser = null;
  appScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
}

/*CÁLCULO DE JUROS E STATUS*/

function hojeISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function diasAtraso(dataVencimentoStr) {
  const venc = new Date(dataVencimentoStr + "T00:00:00");
  const hoje = hojeISO();
  const diffMs = hoje - venc;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function valorAtualizado(c) {
  if (c.pago) return Number(c.valor_original);
  const atraso = diasAtraso(c.data_vencimento);
  if (atraso <= 0) return Number(c.valor_original);
  const juros = Number(c.valor_original) * (Number(c.taxa_juros) / 100);
  return Number(c.valor_original) + juros;
}

function statusDe(c) {
  if (c.pago) return "pago";
  const atraso = diasAtraso(c.data_vencimento);
  if (atraso > 0) return "atrasado";
  if (atraso === 0) return "hoje";
  return "futuro";
}

function fmtMoeda(v) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(str) {
  const d = new Date(str + "T00:00:00");
  return d.toLocaleDateString("pt-BR");
}

/*CALCULAR E RENDERIZAR COBRANÇAS*/

async function loadCobrancas() {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .order("data_vencimento", { ascending: true });

  if (error) {
    console.error("Erro ao carregar cobranças:", error.message);
    return;
  }
  cobrancas = data || [];
  renderDashboard();
  checkVencimentosHoje();
}

function renderDashboard() {
  const listaVazia = el("lista-vazia");
  const grupos = {
    atrasado: { wrap: el("grupo-atrasados"), lista: el("lista-atrasados") },
    hoje: { wrap: el("grupo-hoje"), lista: el("lista-hoje") },
    futuro: { wrap: el("grupo-futuros"), lista: el("lista-futuros") },
    pago: { wrap: el("grupo-pagos"), lista: el("lista-pagos") },
  };

  Object.values(grupos).forEach((g) => {
    g.lista.innerHTML = "";
    g.wrap.classList.add("hidden");
  });

  if (cobrancas.length === 0) {
    listaVazia.classList.remove("hidden");
    atualizarTotais();
    return;
  }
  listaVazia.classList.add("hidden");

  const abertos = cobrancas.filter((c) => !c.pago);
  const pagos = cobrancas.filter((c) => c.pago);

  const atrasados = abertos
    .filter((c) => statusDe(c) === "atrasado")
    .sort((a, b) => diasAtraso(b.data_vencimento) - diasAtraso(a.data_vencimento));
  const hoje = abertos.filter((c) => statusDe(c) === "hoje");
  const futuros = abertos
    .filter((c) => statusDe(c) === "futuro")
    .sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento));

  preencherGrupo(grupos.atrasado, atrasados, "atrasado");
  preencherGrupo(grupos.hoje, hoje, "hoje");
  preencherGrupo(grupos.futuro, futuros, "futuro");

  if (pagos.length > 0) {
    grupos.pago.wrap.classList.remove("hidden");
    el("count-pagos").textContent = `(${pagos.length})`;
    preencherGrupo(grupos.pago, pagos.sort((a, b) => new Date(b.data_pagamento) - new Date(a.data_pagamento)), "pago");
  }

  atualizarTotais();
}

function preencherGrupo(grupo, itens, tipo) {
  if (itens.length === 0) return;
  grupo.wrap.classList.remove("hidden");
  itens.forEach((c) => grupo.lista.appendChild(criarItemEl(c, tipo)));
}

function criarItemEl(c, tipo) {
  const tpl = el("item-template").content.cloneNode(true);
  const nomeEl = tpl.querySelector(".item-nome");
  const subEl = tpl.querySelector(".item-sub");
  const valorEl = tpl.querySelector(".item-valor");
  const origEl = tpl.querySelector(".item-original");
  const btn = tpl.querySelector(".item-pagar");

  const atualizado = valorAtualizado(c);
  const atraso = diasAtraso(c.data_vencimento);

  nomeEl.textContent = c.nome_devedor;

  if (tipo === "pago") {
    subEl.textContent = `Pago em ${c.data_pagamento ? fmtData(c.data_pagamento.slice(0, 10)) : "-"}`;
    subEl.className = "item-sub text-teal text-xs mt-0.5";
  } else if (tipo === "atrasado") {
    subEl.textContent = `Venceu em ${fmtData(c.data_vencimento)} · ${atraso} dia(s) de atraso`;
    subEl.className = "item-sub text-coral text-xs mt-0.5";
  } else if (tipo === "hoje") {
    subEl.textContent = `Vence hoje${c.telefone ? " · " + c.telefone : ""}`;
    subEl.className = "item-sub text-amber text-xs mt-0.5";
  } else {
    subEl.textContent = `Vence em ${fmtData(c.data_vencimento)}${c.telefone ? " · " + c.telefone : ""}`;
    subEl.className = "item-sub text-mist text-xs mt-0.5";
  }

  valorEl.textContent = fmtMoeda(atualizado);
  if (tipo === "atrasado") valorEl.classList.add("text-coral");
  if (tipo === "pago") valorEl.classList.add("text-teal");

  if (Math.abs(atualizado - Number(c.valor_original)) > 0.005) {
    origEl.textContent = `original: ${fmtMoeda(c.valor_original)}`;
  } else {
    origEl.textContent = "";
  }

  if (tipo === "pago") {
    btn.remove();
  } else {
    btn.addEventListener("click", () => marcarComoPago(c.id));
  }

  return tpl.firstElementChild;
}

function atualizarTotais() {
  const abertos = cobrancas.filter((c) => !c.pago);
  const hojeD = hojeISO();
  const mesAtual = hojeD.getMonth();
  const anoAtual = hojeD.getFullYear();

  const totalMes = abertos
    .filter((c) => {
      const v = new Date(c.data_vencimento + "T00:00:00");
      return v.getMonth() === mesAtual && v.getFullYear() === anoAtual;
    })
    .reduce((s, c) => s + valorAtualizado(c), 0);

  const totalHoje = abertos
    .filter((c) => statusDe(c) === "hoje")
    .reduce((s, c) => s + valorAtualizado(c), 0);

  const totalAtrasado = abertos
    .filter((c) => statusDe(c) === "atrasado")
    .reduce((s, c) => s + valorAtualizado(c), 0);

  el("total-mes").textContent = fmtMoeda(totalMes);
  el("total-hoje").textContent = fmtMoeda(totalHoje);
  el("total-atrasado").textContent = fmtMoeda(totalAtrasado);
}

async function marcarComoPago(id) {
  const { error } = await db
    .from(TABLE)
    .update({ pago: true, data_pagamento: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    alert("Erro ao marcar como pago: " + error.message);
    return;
  }
  await loadCobrancas();
}

/*CADASTRO DE NOVO DEVEDOR */

async function handleCadastroSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const msgEl = el("cadastro-msg");
  const fd = new FormData(form);

  const payload = {
    user_id: currentUser.id,
    nome_devedor: fd.get("nome_devedor").trim(),
    telefone: fd.get("telefone").trim() || null,
    valor_original: parseFloat(fd.get("valor_original")),
    taxa_juros: parseFloat(fd.get("taxa_juros")) || 0,
    data_vencimento: fd.get("data_vencimento"),
    observacoes: fd.get("observacoes").trim() || null,
  };

  const { error } = await db.from(TABLE).insert(payload);

  msgEl.classList.remove("hidden");
  if (error) {
    msgEl.textContent = "Erro ao salvar: " + error.message;
    msgEl.className = "text-xs text-coral";
    return;
  }

  msgEl.textContent = "Devedor cadastrado com sucesso!";
  msgEl.className = "text-xs text-teal";
  form.reset();
  await loadCobrancas();
  setTimeout(() => {
    switchView("dashboard");
    msgEl.classList.add("hidden");
  }, 900);
}

/* CALCULADORA DE JUROS SIMPLES*/

function initCalculadora() {
  ["calc-valor", "calc-taxa", "calc-dias"].forEach((id) => {
    el(id).addEventListener("input", atualizarCalculadora);
  });
}

function atualizarCalculadora() {
  const valor = parseFloat(el("calc-valor").value) || 0;
  const taxa = parseFloat(el("calc-taxa").value) || 0;
  const dias = parseFloat(el("calc-dias").value) || 0;
  const juros = valor * (taxa / 100) * (dias / 30);
  el("calc-juros").textContent = fmtMoeda(juros);
  el("calc-total").textContent = fmtMoeda(valor + juros);
}

/*NAVEGAÇÃO ENTRE VIEWS (Dashboard / Cadastro / Calculadora)*/

function switchView(view) {
  document.querySelectorAll(".view-panel").forEach((v) => v.classList.add("hidden"));
  el(`view-${view}`).classList.remove("hidden");

  document.querySelectorAll(".view-tab").forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle("border-teal", active);
    btn.classList.toggle("text-white", active);
    btn.classList.toggle("border-transparent", !active);
    btn.classList.toggle("text-mist", !active);
  });

  document.querySelectorAll(".mnav-tab").forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle("text-white", active);
    btn.classList.toggle("text-mist", !active);
  });
}

function initNav() {
  document.querySelectorAll(".view-tab, .mnav-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  el("toggle-pagos").addEventListener("click", () => {
    el("lista-pagos").classList.toggle("hidden");
  });
}

/*NOTIFICAÇÕES*/

function setupNotificationButton() {
  if (!("Notification" in window)) return;
  const btn = el("btn-enable-notif");
  if (Notification.permission === "default") {
    btn.classList.remove("hidden");
    btn.addEventListener("click", async () => {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        btn.classList.add("hidden");
        checkVencimentosHoje();
      }
    });
  }
}

function checkVencimentosHoje() {
  const venceHoje = cobrancas.filter((c) => !c.pago && statusDe(c) === "hoje");
  const banner = el("today-banner");
  const bannerText = el("today-banner-text");

  if (venceHoje.length === 0) {
    banner.classList.add("hidden");
    return;
  }

  const nomes = venceHoje.map((c) => c.nome_devedor).join(", ");
  const totalHoje = venceHoje.reduce((s, c) => s + valorAtualizado(c), 0);

  bannerText.textContent =
    venceHoje.length === 1
      ? `${nomes} vence hoje — ${fmtMoeda(totalHoje)}`
      : `${venceHoje.length} cobranças vencem hoje (${nomes}) — total de ${fmtMoeda(totalHoje)}`;
  banner.classList.remove("hidden");

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("CTRL — vencimentos de hoje", {
        body:
          venceHoje.length === 1
            ? `${nomes} vence hoje (${fmtMoeda(totalHoje)})`
            : `${venceHoje.length} devedores vencem hoje: ${nomes}`,
        icon: "icons/icon-192.png",
        tag: "vencimentos-hoje",
      });
    } catch (e) {
      console.warn("Não foi possível exibir notificação nativa:", e);
    }
  }
}

/*SERVICE WORKER (instalação como PWA)*/

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.warn("Falha ao registrar Service Worker:", err);
      });
    });
  }
}

/*NICIALIZAÇÃO*/

async function init() {
  initAuthTabs();
  setAuthMode("login");
  el("auth-form").addEventListener("submit", handleAuthSubmit);
  el("btn-logout").addEventListener("click", handleLogout);
  el("form-cadastro").addEventListener("submit", handleCadastroSubmit);
  initNav();
  initCalculadora();
  registerServiceWorker();

  db.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      showApp(session.user);
    } else {
      showAuth();
    }
  });

  const { data } = await db.auth.getSession();
  if (data.session?.user) {
    showApp(data.session.user);
  } else {
    showAuth();
  }
}

init();
