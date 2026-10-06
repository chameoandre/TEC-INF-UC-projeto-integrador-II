/* PI-II — camada dinâmica do dashboard.
 *
 * - Lê os dados ao vivo (Apps Script; na falta dele, o CSV público da planilha).
 * - Login com conta Google; o token vai junto de cada envio e é conferido no servidor.
 * - Modal para registrar avanços e atualizar a ficha do projeto (nada é digitado na planilha).
 * - Linha do tempo por projeto, devolutiva docente e Raio-X calculado.
 *
 * Todo texto vindo de fora é escapado antes de entrar na página.
 */
(function () {
  'use strict';

  var CFG = window.PI2_CONFIG || {};
  var TIPOS = { avanco: 'Avanço', experimento: 'Experimento', artigo: 'Artigo', dificuldade: 'Dificuldade', outro: 'Outro', legado: 'Histórico' };
  var CAMPOS_URL = ['github', 'overleaf', 'canva', 'pitch', 'dashboard'];

  var PI2 = {
    bruto: [],        // projetos sem escape (para formulários)
    registros: [],    // registros públicos, do mais novo para o mais antigo
    usuario: null,    // {email, nome, papel, projetos, status}
    token: null,
    perfil: null,     // dados do token (nome, foto, exp)
    fonte: 'cópia salva no site',
    atualizadoEm: null,
    ganchosAuth: []   // funções chamadas ao redesenhar a área de login: f(elemento, usuario)
  };
  window.PI2 = PI2;

  // ------------------------------------------------------------------
  // Utilitários
  // ------------------------------------------------------------------
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"'`]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[ch];
    });
  }
  function urlSegura(v) {
    var s = String(v == null ? '' : v).trim();
    return /^https?:\/\/[^\s<>"'`]+$/i.test(s) ? s : '';
  }
  function $(sel, raiz) { return (raiz || document).querySelector(sel); }
  function $$(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); }
  function pendente(v) { var s = String(v || '').trim(); return !s || s.toUpperCase() === 'PENDENTE'; }
  function ehIndividual(p) { return !!p.isDomiciliar; }
  function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }
  function dataBr(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    return doisDigitos(d.getDate()) + '/' + doisDigitos(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function diasDesde(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  function haQuanto(iso) {
    var n = diasDesde(iso);
    if (n === null) return '';
    if (n <= 0) return 'hoje';
    if (n === 1) return 'ontem';
    return 'há ' + n + ' dias';
  }
  function aviso(msg, tipo) { if (typeof window.showToast === 'function') window.showToast(esc(msg), tipo || 'success'); }

  // ------------------------------------------------------------------
  // Conversão linhas da planilha -> projetos.
  // ATENÇÃO: este bloco é idêntico ao de apps-script/Code.gs. Ao mudar um, mude o outro.
  // ------------------------------------------------------------------
  //<linhasParaProjetos>
function linhasParaProjetos(linhas) {
  var projetos = [];
  var c = function (linha, i) { return String(linha[i] == null ? '' : linha[i]).replace(/\r\n?/g, '\n').trim(); };
  var pend = function (v) { return !v || v.toUpperCase() === 'PENDENTE'; };
  linhas.forEach(function (linha) {
    var primeira = c(linha, 0);
    if (!/^\d+$/.test(primeira)) return;
    var id = Number(primeira);
    if (id < 1 || id > 99 || !c(linha, 1)) return;

    var relatorio = c(linha, 5), paper1 = c(linha, 17), paper4 = c(linha, 20);
    var overleaf = '';
    [relatorio, paper4, paper1].some(function (v) {
      var m = v.match(/https?:\/\/[^\s,"]*overleaf\.com[^\s,"]*/);
      if (m) { overleaf = m[0]; return true; }
      return false;
    });
    var techsRaw = c(linha, 24);
    var techs = techsRaw.split(/[,;\n]+/).map(function (t) { return t.trim().replace(/\.$/, ''); }).filter(Boolean);

    var p = {
      id: id,
      title: c(linha, 1),
      team: c(linha, 2),
      objective: c(linha, 3),
      github: c(linha, 4),
      relatorio: relatorio,
      overleaf: overleaf,
      overleafStatus: !overleaf ? 'pendente' : (overleaf.indexOf('/project/') >= 0 ? 'privado' : 'ok'),
      canva: pend(c(linha, 6)) ? '' : c(linha, 6),
      pitch: pend(c(linha, 7)) ? '' : c(linha, 7),
      relatedWorks: c(linha, 8) || 'PENDENTE',
      techs: techs.length ? techs : ['A definir'],
      techsRaw: techsRaw,
      advances: c(linha, 21),
      nextSteps: c(linha, 22),
      difficulties: c(linha, 23),
      observations: c(linha, 25),
      experiments: { exp1: c(linha, 9) || 'PENDENTE', exp2: c(linha, 11) || 'PENDENTE', exp3: c(linha, 13) || 'PENDENTE', exp4: c(linha, 15) || 'PENDENTE' },
      experimentResults: { exp1: c(linha, 10), exp2: c(linha, 12), exp3: c(linha, 14), exp4: c(linha, 16) },
      papers: { paper1: paper1, paper2: c(linha, 18), paper3: c(linha, 19), paper4: paper4 },
      paperStatus: paper1 || 'Planejamento',
      cotbStatus: paper4 || 'Pendente'
    };
    projetos.push(p);
  });
  return projetos;
}
  //</linhasParaProjetos>

  /** Leitor de CSV que respeita aspas, vírgulas e quebras de linha dentro das células. */
  function lerCsv(texto) {
    var linhas = [], linha = [], campo = '', aspas = false;
    for (var i = 0; i < texto.length; i++) {
      var ch = texto[i];
      if (aspas) {
        if (ch === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
        } else campo += ch;
      } else if (ch === '"') aspas = true;
      else if (ch === ',') { linha.push(campo); campo = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && texto[i + 1] === '\n') i++;
        linha.push(campo); linhas.push(linha); linha = []; campo = '';
      } else campo += ch;
    }
    if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas;
  }
  PI2._lerCsv = lerCsv;
  PI2._linhasParaProjetos = linhasParaProjetos;

  // ------------------------------------------------------------------
  // Dados: cópia bruta + versão escapada usada pelos templates do index.html
  // ------------------------------------------------------------------
  function escaparProjeto(p) {
    function percorrer(v, chave) {
      if (typeof v === 'string') return esc(CAMPOS_URL.indexOf(chave) >= 0 ? urlSegura(v) : v);
      if (Array.isArray(v)) return v.map(function (x) { return percorrer(x, ''); });
      if (v && typeof v === 'object') {
        var o = {};
        Object.keys(v).forEach(function (k) { o[k] = percorrer(v[k], k); });
        return o;
      }
      return v;
    }
    return percorrer(p, '');
  }

  /** Substitui os projetos em uso, preservando o plano individual, que não tem linha na planilha. */
  function aplicarProjetos(novos) {
    var antigos = {};
    PI2.bruto.forEach(function (p) { antigos[p.id] = p; });
    var ids = {};
    novos.forEach(function (p) {
      ids[p.id] = true;
      var a = antigos[p.id];
      if (a) ['dashboard', 'isDomiciliar'].forEach(function (k) { if (a[k] && !p[k]) p[k] = a[k]; });
    });
    // Só o que fica fora da planilha por definição é mantido; projeto removido da planilha some daqui também.
    PI2.bruto.forEach(function (p) { if (!ids[p.id] && p.isDomiciliar) novos.push(p); });
    novos.sort(function (a, b) { return a.id - b.id; });
    PI2.bruto = novos;
    reescapar();
  }
  function reescapar() {
    projectsData.length = 0;
    PI2.bruto.forEach(function (p) { projectsData.push(escaparProjeto(p)); });
  }

  function redesenhar() {
    window.renderProjects();
    window.renderAuditTable();
    desenharRaioX();
    atualizarContadores();
    if (PI2._modalProjeto) complementarModalProjeto(PI2._modalProjeto);
  }

  function carregar(silencioso) {
    var p = CFG.apiUrl ? carregarDaApi().catch(function (e) {
      console.warn('[PI2] API indisponível, usando a planilha pública:', e);
      return carregarDoCsv();
    }) : carregarDoCsv();
    return p.then(function () {
      PI2.atualizadoEm = new Date();
      redesenhar();
      if (!silencioso) aviso('Dados atualizados (' + PI2.fonte + ').');
    }).catch(function (e) {
      console.warn('[PI2] Sem dados ao vivo:', e);
      redesenhar();
      if (!silencioso) aviso('Não foi possível buscar dados novos. Exibindo a última cópia salva.', 'warning');
    });
  }

  function carregarDaApi() {
    return fetch(CFG.apiUrl + '?t=' + Date.now(), { redirect: 'follow' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!d.ok) throw new Error(d.erro || 'resposta inválida');
      aplicarProjetos(d.projetos || []);
      PI2.registros = d.registros || [];
      PI2.fonte = 'ao vivo';
    });
  }

  function carregarDoCsv() {
    var base = 'https://docs.google.com/spreadsheets/d/' + CFG.sheetId;
    var urls = [
      base + '/export?format=csv&t=' + Date.now(),
      base + '/gviz/tq?tqx=out:csv&headers=0&sheet=' + encodeURIComponent(CFG.sheetTab || '') + '&t=' + Date.now()
    ];
    function tentar(i) {
      if (i >= urls.length) return Promise.reject(new Error('planilha inacessível'));
      return fetch(urls[i]).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (csv) {
        var projetos = linhasParaProjetos(lerCsv(csv));
        if (!projetos.length) throw new Error('nenhum projeto no CSV');
        aplicarProjetos(projetos);
        PI2.fonte = 'planilha pública';
      }).catch(function () { return tentar(i + 1); });
    }
    return tentar(0);
  }

  PI2.sincronizar = function () {
    var icone = $('#liveSyncIcon'), botao = $('#liveSyncBtn');
    if (icone) icone.className = 'fa-solid fa-spinner fa-spin';
    if (botao) botao.disabled = true;
    return carregar(false).then(function () {
      if (icone) icone.className = 'fa-solid fa-rotate';
      if (botao) botao.disabled = false;
    });
  };

  // ------------------------------------------------------------------
  // Login Google + chamadas autenticadas
  // ------------------------------------------------------------------
  function lerToken(jwt) {
    try {
      var corpo = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var json = decodeURIComponent(atob(corpo).split('').map(function (ch) {
        return '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json);
    } catch (e) { return null; }
  }
  function tokenValido() { return !!(PI2.token && PI2.perfil && PI2.perfil.exp * 1000 > Date.now() + 15000); }
  function loginConfigurado() { return !!(CFG.apiUrl && CFG.googleClientId); }

  function api(acao, dados) {
    if (!tokenValido()) {
      sair(true);
      return Promise.reject(new Error('Sua sessão expirou. Entre novamente com sua conta Google.'));
    }
    var corpo = Object.assign({ acao: acao, idToken: PI2.token }, dados || {});
    // text/plain evita a pré-verificação CORS, que o Apps Script não responde.
    return fetch(CFG.apiUrl, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpo)
    }).then(function (r) {
      if (!r.ok) throw new Error('Servidor indisponível (HTTP ' + r.status + ').');
      return r.json();
    }).then(function (d) {
      if (!d.ok) throw new Error(d.erro || 'Não foi possível concluir.');
      if (d.usuario) PI2.usuario = d.usuario;
      return d;
    });
  }

  function aoReceberCredencial(resp) { return PI2._entrarComToken(resp.credential); }

  PI2._entrarComToken = function (jwt, silencioso) {
    var perfil = lerToken(jwt);
    if (!perfil) { aviso('Login inválido.', 'warning'); return Promise.resolve(); }
    PI2.token = jwt; PI2.perfil = perfil;
    try { sessionStorage.setItem('pi2-token', jwt); } catch (e) { /* armazenamento indisponível */ }
    return api('whoami').then(function () {
      desenharAuth(); redesenhar();
      var u = PI2.usuario;
      if (silencioso) return;
      if (u.status === 'ativo') {
        fecharModal();
        aviso('Olá, ' + u.nome.split(' ')[0] + '! Login confirmado.');
        if (PI2._aposLogin) { var f = PI2._aposLogin; PI2._aposLogin = null; f(); }
      } else abrirSolicitacao();
    }).catch(function (e) {
      sair(true);
      aviso(e.message, 'warning');
    });
  };

  function sair(silencioso) {
    PI2.token = null; PI2.perfil = null; PI2.usuario = null;
    try { sessionStorage.removeItem('pi2-token'); } catch (e) { /* idem */ }
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    desenharAuth(); redesenhar();
    if (!silencioso) aviso('Você saiu.');
  }
  PI2.sair = function () { sair(false); };

  function carregarGoogle() {
    if (!loginConfigurado()) return;
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = function () {
      google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: aoReceberCredencial, auto_select: true, use_fedcm_for_prompt: true });
      PI2._googlePronto = true;
      desenharAuth();
    };
    document.head.appendChild(s);
  }

  function botaoGoogle(el, largo) {
    if (!el || !PI2._googlePronto) return;
    el.innerHTML = '';
    var claro = document.documentElement.getAttribute('data-theme') === 'light';
    google.accounts.id.renderButton(el, { type: 'standard', theme: claro ? 'outline' : 'filled_black', size: largo ? 'large' : 'medium', text: 'signin_with', shape: 'pill', locale: 'pt-BR' });
  }

  function podeEditar(id) {
    var u = PI2.usuario;
    if (!u || u.status !== 'ativo') return false;
    return u.papel === 'docente' || (u.projetos || []).indexOf(Number(id)) >= 0;
  }
  function ehDocente() { return !!(PI2.usuario && PI2.usuario.papel === 'docente' && PI2.usuario.status === 'ativo'); }

  function desenharAuth() {
    var el = $('#pi2-auth');
    if (!el) return;
    if (!loginConfigurado()) {
      el.innerHTML = '<button class="btn btn-outline" type="button" disabled title="O login será ativado quando o backend for implantado (ver apps-script/README-IMPLANTACAO.md)"><i class="fa-solid fa-right-to-bracket"></i> Entrar</button>';
      return;
    }
    var u = PI2.usuario;
    if (!u) {
      el.innerHTML = '<div id="pi2-google-header"></div>';
      botaoGoogle($('#pi2-google-header'), false);
      return;
    }
    var foto = urlSegura(PI2.perfil && PI2.perfil.picture);
    var papel = u.status === 'ativo' ? (u.papel === 'docente' ? 'Docente' : 'Projeto #' + (u.projetos || []).join(', #')) : (u.status === 'pendente' ? 'Aguardando aprovação' : 'Sem cadastro');
    el.innerHTML =
      '<div class="pi2-user-chip">' +
        (foto ? '<img src="' + esc(foto) + '" alt="" referrerpolicy="no-referrer">' : '<span class="pi2-avatar"><i class="fa-solid fa-user"></i></span>') +
        '<span><span class="pi2-nome">' + esc(u.nome.split(' ')[0]) + '</span> <span class="pi2-role ' + (u.status !== 'ativo' ? 'pendente' : '') + '">' + esc(papel) + '</span></span>' +
      '</div>' +
      (ehDocente() ? '<button class="btn btn-outline" type="button" id="pi2-btn-painel"><i class="fa-solid fa-user-shield"></i> Painel docente</button>' : '') +
      (u.status !== 'ativo' ? '<button class="pi2-linkbtn" type="button" id="pi2-btn-solicitar">Solicitar acesso</button>' : '') +
      '<button class="pi2-linkbtn" type="button" id="pi2-btn-sair">Sair</button>';
    $('#pi2-btn-sair').onclick = PI2.sair;
    PI2.ganchosAuth.forEach(function (f) { f(el, u); });
    if ($('#pi2-btn-painel')) $('#pi2-btn-painel').onclick = abrirPainel;
    if ($('#pi2-btn-solicitar')) $('#pi2-btn-solicitar').onclick = abrirSolicitacao;
  }

  // ------------------------------------------------------------------
  // Modal genérico
  // ------------------------------------------------------------------
  function garantirModal() {
    if ($('#pi2Modal')) return;
    var div = document.createElement('div');
    div.className = 'modal-overlay';
    div.id = 'pi2Modal';
    div.innerHTML = '<div class="modal-container" role="dialog" aria-modal="true" aria-labelledby="pi2ModalTitulo">' +
      '<button class="modal-close" type="button" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>' +
      '<div id="pi2ModalCorpo"></div></div>';
    document.body.appendChild(div);
    div.addEventListener('mousedown', function (e) { if (e.target === div) fecharModal(); });
    $('.modal-close', div).onclick = fecharModal;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && div.classList.contains('open')) { e.stopImmediatePropagation(); fecharModal(); } }, true);
  }
  function abrirModal(html, largo) {
    garantirModal();
    $('#pi2Modal .modal-container').classList.toggle('pi2-largo', !!largo);
    $('#pi2ModalCorpo').innerHTML = html;
    $('#pi2Modal').classList.add('open');
    var foco = $('#pi2ModalCorpo [autofocus], #pi2ModalCorpo textarea, #pi2ModalCorpo input, #pi2ModalCorpo select');
    if (foco) foco.focus();
    return $('#pi2ModalCorpo');
  }
  function fecharModal() { var m = $('#pi2Modal'); if (m) m.classList.remove('open'); }
  function cabecalho(titulo, sub) {
    return '<h2 class="pi2-modal-title" id="pi2ModalTitulo">' + titulo + '</h2>' + (sub ? '<p class="pi2-modal-sub">' + sub + '</p>' : '');
  }
  /** Liga o envio de um formulário a uma ação, cuidando de botão ocupado e mensagem de erro. */
  function aoEnviar(form, fn) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var botao = $('button[type=submit]', form), erro = $('.pi2-erro', form);
      var rotulo = botao.innerHTML;
      if (erro) erro.textContent = '';
      botao.disabled = true; botao.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando…';
      Promise.resolve().then(function () { return fn(new FormData(form)); }).catch(function (err) {
        if (erro) erro.textContent = err.message || String(err);
      }).then(function () { botao.disabled = false; botao.innerHTML = rotulo; });
    });
  }
  function projetoBruto(id) { return PI2.bruto.filter(function (p) { return p.id === Number(id); })[0]; }

  // ------------------------------------------------------------------
  // Fluxos: login, solicitação de acesso, registro, ficha
  // ------------------------------------------------------------------
  function abrirLogin(depois) {
    PI2._aposLogin = depois || null;
    if (!loginConfigurado()) {
      abrirModal(cabecalho('Login ainda não ativado', 'O envio de registros pelo dashboard será liberado assim que o professor concluir a implantação do backend.'));
      return;
    }
    var corpo = abrirModal(cabecalho('Entre com sua conta Google', 'Use a conta institucional. Só integrantes cadastrados no projeto conseguem registrar avanços, e cada envio fica gravado com seu nome e a data.') +
      '<div class="pi2-google-btn" id="pi2-google-modal"></div>');
    botaoGoogle($('#pi2-google-modal', corpo), true);
  }

  function abrirSolicitacao() {
    var u = PI2.usuario;
    if (!u) return abrirLogin();
    if (u.status === 'pendente') {
      abrirModal(cabecalho('Solicitação enviada', 'Seu pedido de acesso ao projeto #' + esc((u.pedido || []).join(', #')) + ' aguarda a aprovação de um docente. Depois de aprovado, basta atualizar a página.'));
      return;
    }
    if (u.dominioOk === false) {
      abrirModal(cabecalho('Conta não autorizada', 'Você entrou como <strong>' + esc(u.email) + '</strong>. Saia e entre com a sua conta institucional do IFSC.'));
      return;
    }
    var opcoes = PI2.bruto.map(function (p) { return '<option value="' + p.id + '">#' + doisDigitos(p.id) + ' — ' + esc(p.title) + '</option>'; }).join('');
    var corpo = abrirModal(cabecalho('Solicitar acesso a um projeto', 'Você entrou como <strong>' + esc(u.email) + '</strong>, que ainda não está vinculado a nenhum projeto. Escolha o seu; um docente confirma o vínculo.') +
      '<form class="pi2-form"><div class="pi2-field"><label for="pi2-sol-proj">Meu projeto</label><select id="pi2-sol-proj" name="projeto" required>' + opcoes + '</select></div>' +
      '<div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn primario" type="submit">Enviar solicitação</button></div></form>');
    aoEnviar($('form', corpo), function (fd) {
      return api('solicitarAcesso', { projeto: Number(fd.get('projeto')) }).then(function () {
        desenharAuth(); abrirSolicitacao();
      });
    });
  }

  PI2.abrirRegistro = function (id) {
    if (!PI2.usuario) return abrirLogin(function () { PI2.abrirRegistro(id); });
    if (PI2.usuario.status !== 'ativo') return abrirSolicitacao();
    if (!podeEditar(id)) return aviso('Você só pode registrar avanços no seu próprio projeto.', 'warning');
    var p = projetoBruto(id);
    if (!p) return;
    var exps = [1, 2, 3, 4].map(function (n) {
      var t = p.experiments && p.experiments['exp' + n];
      return '<option value="' + n + '">Exp ' + n + (pendente(t) ? '' : ' — ' + esc(String(t).slice(0, 60))) + '</option>';
    }).join('');
    var corpo = abrirModal(cabecalho('Registrar avanço', '#' + doisDigitos(p.id) + ' — ' + esc(p.title) + '. O registro entra na linha do tempo do projeto com seu nome e a data de hoje.') +
      '<form class="pi2-form">' +
        '<div class="pi2-row">' +
          '<div class="pi2-field"><label for="pi2-tipo">Tipo</label><select id="pi2-tipo" name="tipo">' +
            '<option value="avanco">Avanço no desenvolvimento</option><option value="experimento">Experimento realizado</option>' +
            '<option value="artigo">Escrita do artigo</option><option value="dificuldade">Dificuldade / bloqueio</option><option value="outro">Outro</option></select></div>' +
          '<div class="pi2-field"><label for="pi2-exp">Experimento relacionado</label><select id="pi2-exp" name="experimento"><option value="0">Nenhum</option>' + exps + '</select></div>' +
        '</div>' +
        '<div class="pi2-field"><label for="pi2-texto">O que foi feito</label>' +
          '<textarea id="pi2-texto" name="texto" required minlength="15" maxlength="1500" placeholder="Ex.: Implementamos a tela de cadastro e testamos com 5 usuários; 4 concluíram sem ajuda."></textarea>' +
          '<span class="pi2-contador" id="pi2-cont">0 / 1500</span></div>' +
        '<div class="pi2-field"><label for="pi2-evid">Link de evidência (opcional)</label>' +
          '<input id="pi2-evid" name="evidencia" type="url" inputmode="url" placeholder="https://… commit, vídeo, seção do Overleaf, foto">' +
          '<span class="pi2-hint">Um registro com evidência vale mais: commit no GitHub, vídeo do teste, link de leitura do Overleaf.</span></div>' +
        '<div class="pi2-field"><label for="pi2-prox">Próximos passos</label>' +
          '<textarea id="pi2-prox" class="pi2-curto" name="proximosPassos" maxlength="600">' + esc(p.nextSteps || '') + '</textarea>' +
          '<span class="pi2-hint">Já vem com o que está na ficha; ajuste se mudou.</span></div>' +
        '<div class="pi2-field"><label for="pi2-dif">Dificuldades atuais</label>' +
          '<textarea id="pi2-dif" class="pi2-curto" name="dificuldades" maxlength="600">' + esc(p.difficulties || '') + '</textarea></div>' +
        '<div class="pi2-erro" role="alert"></div>' +
        '<div class="pi2-actions"><button class="pi2-btn" type="button" id="pi2-cancelar">Cancelar</button><button class="pi2-btn primario" type="submit"><i class="fa-solid fa-paper-plane"></i> Registrar</button></div>' +
      '</form>');
    var area = $('#pi2-texto', corpo);
    area.addEventListener('input', function () { $('#pi2-cont', corpo).textContent = area.value.length + ' / 1500'; });
    $('#pi2-cancelar', corpo).onclick = fecharModal;
    aoEnviar($('form', corpo), function (fd) {
      var ev = String(fd.get('evidencia') || '').trim();
      if (ev && !/^https:\/\//i.test(ev)) throw new Error('O link de evidência precisa começar com https://');
      var prox = String(fd.get('proximosPassos') || '').trim(), dif = String(fd.get('dificuldades') || '').trim();
      return api('registrar', {
        projeto: p.id, tipo: fd.get('tipo'), experimento: Number(fd.get('experimento')), texto: fd.get('texto'), evidencia: ev,
        proximosPassos: prox === String(p.nextSteps || '').trim() ? '' : prox,
        dificuldades: dif === String(p.difficulties || '').trim() ? '' : dif
      }).then(function () {
        fecharModal(); aviso('Avanço registrado.');
        return carregar(true);
      });
    });
  };

  var CAMPOS_FICHA = [
    { k: 'objective', r: 'Objetivo', t: 'area' },
    { k: 'github', r: 'Repositório GitHub', t: 'url' },
    { k: 'relatorio', r: 'Artigo no Overleaf (link de leitura)', t: 'url', d: 'No Overleaf: Share → Turn on link sharing → copie o link “Anyone with this link can view”.' },
    { k: 'canva', r: 'Diagrama do projeto (Canva ou similar)', t: 'url' },
    { k: 'pitch', r: 'Vídeo do pitch', t: 'url' },
    { k: 'relatedWorks', r: 'Trabalhos relacionados', t: 'area', d: 'Título de cada trabalho com o ano de publicação, um por linha.' },
    { k: 'techs', r: 'Tecnologias e recursos', t: 'texto', d: 'Separe por vírgula.' }
  ];
  var CAMPOS_FICHA_DOCENTE = [
    { k: 'title', r: 'Título do projeto', t: 'texto' }, { k: 'team', r: 'Integrantes', t: 'texto' },
    { k: 'paper1', r: 'Paper 1 [SEPEI]', t: 'area' }, { k: 'paper2', r: 'Paper 2 [SNCT]', t: 'area' },
    { k: 'paper3', r: 'Paper 3', t: 'area' }, { k: 'paper4', r: 'Paper 4 [COTB]', t: 'area' },
    { k: 'observations', r: 'Observações', t: 'area' }
  ];

  function valorAtual(p, k) {
    var m;
    if ((m = /^exp(\d)(res)?$/.exec(k))) {
      var v = (m[2] ? p.experimentResults : p.experiments) || {};
      v = v['exp' + m[1]] || '';
      return pendente(v) && !m[2] ? '' : v;
    }
    if (/^paper\d$/.test(k)) return (p.papers && p.papers[k]) || '';
    if (k === 'relatorio') return p.relatorio != null ? (pendente(p.relatorio) ? '' : p.relatorio) : (p.overleaf || '');
    if (k === 'techs') return p.techsRaw != null ? p.techsRaw.replace(/\s*\n\s*/g, ', ') : (p.techs || []).join(', ');
    if (k === 'relatedWorks') return pendente(p.relatedWorks) ? '' : p.relatedWorks;
    return p[k] || '';
  }
  function campoHtml(c, valor) {
    var id = 'pi2-f-' + c.k;
    var entrada = c.t === 'area'
      ? '<textarea class="pi2-curto" id="' + id + '" name="' + c.k + '" maxlength="1500">' + esc(valor) + '</textarea>'
      : '<input id="' + id + '" name="' + c.k + '" type="' + (c.t === 'url' ? 'url' : 'text') + '" maxlength="600" value="' + esc(valor) + '"' + (c.t === 'url' ? ' placeholder="https://…"' : '') + '>';
    return '<div class="pi2-field"><label for="' + id + '">' + esc(c.r) + '</label>' + entrada + (c.d ? '<span class="pi2-hint">' + esc(c.d) + '</span>' : '') + '</div>';
  }

  PI2.abrirFicha = function (id) {
    if (!PI2.usuario) return abrirLogin(function () { PI2.abrirFicha(id); });
    if (!podeEditar(id)) return aviso('Você só pode editar a ficha do seu próprio projeto.', 'warning');
    var p = projetoBruto(id);
    if (!p) return;
    var iniciais = {};
    function bloco(campos) {
      return campos.map(function (c) { iniciais[c.k] = String(valorAtual(p, c.k)).trim(); return campoHtml(c, iniciais[c.k]); }).join('');
    }
    var exps = [1, 2, 3, 4].map(function (n) {
      return '<fieldset class="pi2-fieldset"><legend>Experimento ' + n + '</legend>' +
        bloco([{ k: 'exp' + n, r: 'Título / o que será testado', t: 'texto' }, { k: 'exp' + n + 'res', r: 'Resultados obtidos', t: 'area' }]) + '</fieldset>';
    }).join('');
    var corpo = abrirModal(cabecalho('Atualizar ficha do projeto', '#' + doisDigitos(p.id) + ' — ' + esc(p.title) + '. Só os campos que você alterar são gravados; cada alteração fica registrada com autor, data e valor anterior.') +
      '<form class="pi2-form">' + (ehDocente() ? bloco(CAMPOS_FICHA_DOCENTE.slice(0, 2)) : '') + bloco(CAMPOS_FICHA) + exps +
      (ehDocente() ? bloco(CAMPOS_FICHA_DOCENTE.slice(2)) : '') +
      '<div class="pi2-erro" role="alert"></div>' +
      '<div class="pi2-actions"><button class="pi2-btn" type="button" id="pi2-cancelar">Cancelar</button><button class="pi2-btn primario" type="submit"><i class="fa-solid fa-floppy-disk"></i> Salvar alterações</button></div></form>');
    $('#pi2-cancelar', corpo).onclick = fecharModal;
    aoEnviar($('form', corpo), function (fd) {
      var campos = {};
      Object.keys(iniciais).forEach(function (k) {
        var v = String(fd.get(k) || '').trim();
        if (v !== iniciais[k]) campos[k] = v;
      });
      if (!Object.keys(campos).length) throw new Error('Nenhum campo foi alterado.');
      return api('atualizarFicha', { projeto: p.id, campos: campos }).then(function (d) {
        fecharModal(); aviso(d.alterados + ' campo(s) atualizado(s).');
        return carregar(true);
      });
    });
  };

  // ------------------------------------------------------------------
  // Linha do tempo
  // ------------------------------------------------------------------
  function registrosDo(id) { return PI2.registros.filter(function (r) { return Number(r.projeto) === Number(id); }); }
  function ultimoRegistro(id) { return registrosDo(id).filter(function (r) { return r.tipo !== 'legado' && r.data; })[0] || null; }

  function itemHtml(r) {
    var ev = urlSegura(r.evidencia);
    var cab = r.tipo === 'legado'
      ? '<span class="pi2-tag">Histórico</span><span>texto que estava na planilha antes do novo sistema</span>'
      : '<span class="pi2-tag">' + esc(TIPOS[r.tipo] || 'Avanço') + (r.experimento ? ' • Exp ' + Number(r.experimento) : '') + '</span>' +
        '<strong>' + esc(r.autor) + '</strong><span title="' + esc(haQuanto(r.data)) + '">' + esc(dataBr(r.data)) + ' (' + esc(haQuanto(r.data)) + ')</span>';
    var dev = r.devolutiva && r.devolutiva.texto
      ? '<div class="pi2-devolutiva"><small><i class="fa-solid fa-comment-dots"></i> Devolutiva — ' + esc(r.devolutiva.autor) + (r.devolutiva.data ? ', ' + esc(dataBr(r.devolutiva.data)) : '') + '</small>' + esc(r.devolutiva.texto) + '</div>'
      : '';
    var acoes = ehDocente() && r.tipo !== 'legado'
      ? '<div class="pi2-item-actions"><button class="pi2-btn mini" type="button" data-pi2-dev="' + esc(r.id) + '">' + (dev ? 'Editar devolutiva' : 'Dar devolutiva') + '</button>' +
        '<button class="pi2-btn mini perigo" type="button" data-pi2-ocultar="' + esc(r.id) + '">Ocultar</button></div>'
      : '';
    return '<div class="pi2-item tipo-' + esc(r.tipo) + '"><div class="pi2-item-head">' + cab + '</div>' +
      '<div class="pi2-item-text">' + esc(r.texto) + '</div>' +
      (ev ? '<a href="' + esc(ev) + '" target="_blank" rel="noopener"><i class="fa-solid fa-link"></i> ' + esc(ev.length > 70 ? ev.slice(0, 70) + '…' : ev) + '</a>' : '') +
      dev + acoes + '</div>';
  }

  function timelineHtml(id, limite) {
    var lista = registrosDo(id);
    if (!lista.length) return '<div class="pi2-vazio">Nenhum registro ainda.' + (loginConfigurado() ? ' Use “Registrar avanço” para criar o primeiro.' : '') + '</div>';
    var visiveis = limite ? lista.slice(0, limite) : lista;
    return '<div class="pi2-timeline">' + visiveis.map(itemHtml).join('') + '</div>' +
      (limite && lista.length > limite ? '<button class="pi2-linkbtn" type="button" data-pi2-todos="' + Number(id) + '">Ver os ' + lista.length + ' registros</button>' : '');
  }

  function abrirDevolutiva(id) {
    var r = PI2.registros.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var corpo = abrirModal(cabecalho('Devolutiva docente', 'Aparece junto do registro, visível para toda a turma.') + itemHtml(Object.assign({}, r, { devolutiva: null })).replace(/<div class="pi2-item-actions">.*?<\/div>/, '') +
      '<form class="pi2-form" style="margin-top:1rem"><div class="pi2-field"><label for="pi2-dev-txt">Comentário</label>' +
      '<textarea id="pi2-dev-txt" name="texto" maxlength="600">' + esc(r.devolutiva ? r.devolutiva.texto : '') + '</textarea><span class="pi2-hint">Deixe vazio para remover a devolutiva.</span></div>' +
      '<div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn primario" type="submit">Salvar devolutiva</button></div></form>');
    aoEnviar($('form', corpo), function (fd) {
      return api('devolutiva', { id: id, texto: fd.get('texto') }).then(function () { fecharModal(); aviso('Devolutiva salva.'); return carregar(true); });
    });
  }
  function ocultarRegistro(id) {
    var corpo = abrirModal(cabecalho('Ocultar este registro?', 'Ele sai do dashboard, mas continua guardado na planilha de controle, onde pode ser reexibido.') +
      '<form class="pi2-form"><div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn" type="button" id="pi2-cancelar">Cancelar</button><button class="pi2-btn perigo" type="submit">Ocultar</button></div></form>');
    $('#pi2-cancelar', corpo).onclick = fecharModal;
    aoEnviar($('form', corpo), function () {
      return api('ocultar', { id: id, oculto: true }).then(function () { fecharModal(); aviso('Registro ocultado.'); return carregar(true); });
    });
  }

  document.addEventListener('click', function (e) {
    var alvo = e.target.closest ? e.target.closest('[data-pi2-dev],[data-pi2-ocultar],[data-pi2-todos],[data-pi2-registrar],[data-pi2-ficha]') : null;
    if (!alvo) return;
    e.stopPropagation();
    if (alvo.dataset.pi2Dev) abrirDevolutiva(alvo.dataset.pi2Dev);
    else if (alvo.dataset.pi2Ocultar) ocultarRegistro(alvo.dataset.pi2Ocultar);
    else if (alvo.dataset.pi2Todos) window.openModal(Number(alvo.dataset.pi2Todos));
    else if (alvo.dataset.pi2Registrar) PI2.abrirRegistro(Number(alvo.dataset.pi2Registrar));
    else if (alvo.dataset.pi2Ficha) PI2.abrirFicha(Number(alvo.dataset.pi2Ficha));
  }, true);

  // ------------------------------------------------------------------
  // Complementos nos cards e na ficha completa
  // ------------------------------------------------------------------
  function botoesAcao(id, compacto) {
    if (PI2.usuario && !podeEditar(id)) return '';
    if (!PI2.usuario && !loginConfigurado()) return '';
    if (compacto) return '<button type="button" class="link-btn pi2-registrar" data-pi2-registrar="' + id + '" title="Registrar um avanço deste projeto"><i class="fa-solid fa-pen-to-square"></i> Registrar</button>';
    return '<button type="button" class="pi2-btn mini primario" data-pi2-registrar="' + id + '"><i class="fa-solid fa-pen-to-square"></i> Registrar avanço</button> ' +
      '<button type="button" class="pi2-btn mini" data-pi2-ficha="' + id + '"><i class="fa-solid fa-sliders"></i> Atualizar ficha</button>';
  }

  function complementarCards() {
    $$('.project-card').forEach(function (card) {
      var id = Number(card.id.replace('project-card-', ''));
      var links = $('.proj-links', card);
      if (links && !$('.pi2-registrar', links)) links.insertAdjacentHTML('beforeend', botoesAcao(id, true));

      var meta = $('.card-quick-meta', card), ult = ultimoRegistro(id);
      if (meta && CFG.apiUrl) {
        var dias = ult ? diasDesde(ult.data) : null;
        var parado = dias === null || dias >= (CFG.diasParado || 14);
        meta.insertAdjacentHTML('beforeend', '<span class="quick-meta-pill pi2-recencia ' + (parado ? 'parado' : 'green') + '"><i class="fa-solid fa-clock-rotate-left"></i> ' +
          (ult ? 'Último registro ' + esc(haQuanto(ult.data)) : 'Sem registros') + '</span>');
      }

      var conteudo = $('.project-collapsible-content', card), rodape = $('.card-expanded-footer', card);
      if (conteudo && rodape && (CFG.apiUrl || registrosDo(id).length)) {
        var sec = document.createElement('div');
        sec.className = 'card-extra-section';
        sec.innerHTML = '<div class="card-extra-title pi2-secao-titulo"><span><i class="fa-solid fa-timeline text-cyan"></i> Linha do tempo</span><span>' + botoesAcao(id, false) + '</span></div>' + timelineHtml(id, 3);
        conteudo.insertBefore(sec, rodape);
        // A coluna AVANÇOS da planilha espelha estes registros; evita mostrar duas vezes.
        if (ult) $$('.card-extra-section', conteudo).forEach(function (s) {
          var t = $('.card-extra-title', s);
          if (s !== sec && t && /Avanços Recentes/.test(t.textContent)) s.style.display = 'none';
        });
      }
    });
  }

  function complementarModalProjeto(id) {
    var corpo = $('#modalContent');
    if (!corpo || !$('#projectModal').classList.contains('open')) return;
    var antigo = $('#pi2-modal-extra', corpo);
    if (antigo) antigo.remove();
    if (!CFG.apiUrl && !registrosDo(id).length) return;
    var div = document.createElement('div');
    div.id = 'pi2-modal-extra';
    div.innerHTML = '<h3 class="pi2-h pi2-secao-titulo"><span><i class="fa-solid fa-timeline text-cyan"></i> Linha do tempo de registros</span><span>' + botoesAcao(id, false) + '</span></h3>' + timelineHtml(id, 0);
    corpo.appendChild(div);
  }

  // ------------------------------------------------------------------
  // Contadores e Raio-X calculados
  // ------------------------------------------------------------------
  function indicadores() {
    var turma = PI2.bruto.filter(function (p) { return !ehIndividual(p); });
    function ids(lista) { return lista.map(function (p) { return '#' + doisDigitos(p.id); }).join(', ') || '—'; }
    function qtdExps(p) { return [1, 2, 3, 4].filter(function (n) { return !pendente(p.experiments && p.experiments['exp' + n]); }).length; }
    var limite = CFG.diasParado || 14;
    return {
      total: PI2.bruto.length, turma: turma, ids: ids,
      overleafOk: turma.filter(function (p) { return p.overleafStatus === 'ok'; }),
      overleafRuim: turma.filter(function (p) { return p.overleafStatus !== 'ok'; }),
      exps4: turma.filter(function (p) { return qtdExps(p) === 4; }),
      exps0: turma.filter(function (p) { return qtdExps(p) === 0; }),
      expsIncompletos: turma.filter(function (p) { return qtdExps(p) < 4; }),
      pitch: turma.filter(function (p) { return !!urlSegura(p.pitch); }),
      semPitch: turma.filter(function (p) { return !urlSegura(p.pitch); }),
      rel: turma.filter(function (p) { return !pendente(p.relatedWorks); }),
      semRel: turma.filter(function (p) { return pendente(p.relatedWorks); }),
      ativos7: turma.filter(function (p) { var u = ultimoRegistro(p.id); return u && diasDesde(u.data) < 7; }),
      parados: turma.filter(function (p) { var u = ultimoRegistro(p.id); return !u || diasDesde(u.data) >= limite; })
    };
  }

  function atualizarContadores() {
    var k = indicadores(), n = k.turma.length, individuais = k.total - n;
    var selo = $('.nav-tabs-bar .tab-btn .badge-count'); if (selo) selo.textContent = k.total;
    var todos = $('.filter-pills .pill'); if (todos) todos.textContent = 'Todos (' + k.total + ')';
    var total = $('#kpi-total-projs');
    if (total) {
      total.textContent = k.total;
      var subs = $$('.kpi-sub', total.closest('.kpi-grid'));
      var privados = k.turma.filter(function (p) { return p.overleafStatus === 'privado'; });
      var semLink = k.turma.filter(function (p) { return p.overleafStatus === 'pendente'; });
      if (subs[0]) subs[0].textContent = n + ' equipes' + (individuais ? ' + ' + individuais + ' plano individual' : '');
      if (subs[1]) subs[1].textContent = 'Links de leitura públicos';
      if (subs[2]) subs[2].textContent = privados.length ? 'Liberar “Share Link”: ' + k.ids(privados) : 'Nenhum link interno';
      if (subs[3]) subs[3].textContent = semLink.length ? 'Pendentes: ' + k.ids(semLink) : 'Todos informaram o link';
    }
    var fonte = $('#pi2-fonte');
    if (fonte) {
      var hora = PI2.atualizadoEm ? doisDigitos(PI2.atualizadoEm.getHours()) + ':' + doisDigitos(PI2.atualizadoEm.getMinutes()) : '';
      fonte.textContent = 'Dados: ' + PI2.fonte + (hora ? ', lidos às ' + hora : (window.PI2_BAKED_AT ? ' em ' + window.PI2_BAKED_AT : ''));
    }
  }

  function kpi(titulo, valor, sub, cor, icone) {
    return '<div class="kpi-card"><div class="kpi-header"><span class="kpi-title">' + esc(titulo) + '</span><div class="kpi-icon ' + cor + '"><i class="fa-solid ' + icone + '"></i></div></div>' +
      '<div class="kpi-val">' + esc(valor) + '</div><div class="kpi-sub">' + esc(sub) + '</div></div>';
  }

  function desenharRaioX() {
    var aba = $('#tab-avancos-pendencias');
    if (!aba) return;
    var caixa = $('#pi2-raiox');
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.id = 'pi2-raiox';
      var hero = $('.hero-banner', aba);
      hero.parentNode.insertBefore(caixa, hero.nextSibling);
    }
    var k = indicadores(), n = k.turma.length;
    var tags = $$('.hero-meta .meta-tag strong', aba);
    if (tags[0]) tags[0].textContent = CFG.apiUrl ? k.ativos7.length + ' de ' + n + ' equipes com registro em 7 dias' : n + ' equipes';
    if (tags[1]) tags[1].textContent = k.overleafOk.length + ' / ' + n + ' projetos';
    if (tags[2]) tags[2].textContent = k.exps4.length + ' de ' + n + ' equipes';
    if (tags[3]) tags[3].textContent = k.exps0.length + ' de ' + n + ' projetos';

    var recentes = PI2.registros.filter(function (r) { return r.tipo !== 'legado'; }).slice(0, 8);
    var feed = recentes.length
      ? '<div class="pi2-timeline">' + recentes.map(function (r) {
          var p = projetoBruto(r.projeto);
          return itemHtml(r).replace('<div class="pi2-item-head">', '<div class="pi2-item-head"><strong>#' + doisDigitos(Number(r.projeto)) + ' ' + esc(p ? p.title : '') + '</strong>');
        }).join('') + '</div>'
      : '<div class="pi2-vazio">' + (CFG.apiUrl ? 'Nenhum registro enviado pelo dashboard ainda.' : 'Os registros aparecem aqui quando o envio pelo dashboard for ativado.') + '</div>';
    var parados = CFG.apiUrl
      ? (k.parados.length ? '<ul class="pi2-lista">' + k.parados.map(function (p) {
          var u = ultimoRegistro(p.id);
          return '<li><strong>#' + doisDigitos(p.id) + ' ' + esc(p.title) + '</strong> — ' + (u ? 'último registro ' + esc(haQuanto(u.data)) : 'nenhum registro') + '</li>';
        }).join('') + '</ul>' : '<div class="pi2-vazio">Todas as equipes registraram algo nos últimos ' + (CFG.diasParado || 14) + ' dias.</div>')
      : '<div class="pi2-vazio">Disponível após ativar o envio pelo dashboard.</div>';

    caixa.innerHTML =
      '<div class="guide-box">' +
        '<h3><i class="fa-solid fa-gauge-high text-green"></i> Situação atual da turma (calculada dos dados)</h3>' +
        '<p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 1.25rem;">Estes números são recalculados a cada carregamento; considera as ' + n + ' equipes, sem o plano individual.</p>' +
        '<div class="kpi-grid">' +
          kpi('Overleaf público', k.overleafOk.length + ' / ' + n, k.overleafRuim.length ? 'Falta: ' + k.ids(k.overleafRuim) : 'Todos com link de leitura', 'green', 'fa-lock-open') +
          kpi('4 experimentos definidos', k.exps4.length + ' / ' + n, k.expsIncompletos.length ? 'Incompletos: ' + k.ids(k.expsIncompletos) : 'Todos completos', 'cyan', 'fa-flask-vial') +
          kpi('Pitch em vídeo', k.pitch.length + ' / ' + n, k.semPitch.length ? 'Falta: ' + k.ids(k.semPitch) : 'Todos enviaram', 'amber', 'fa-video') +
          kpi('Trabalhos relacionados', k.rel.length + ' / ' + n, k.semRel.length ? 'Falta: ' + k.ids(k.semRel) : 'Todos preencheram', 'red', 'fa-book-bookmark') +
        '</div>' +
        '<div class="pi2-raiox-cols">' +
          '<div><h4 class="pi2-h"><i class="fa-solid fa-bolt text-green"></i> Últimos registros</h4>' + feed + '</div>' +
          '<div><h4 class="pi2-h"><i class="fa-solid fa-hourglass-half text-amber"></i> Equipes sem registro recente</h4>' + parados + '</div>' +
        '</div>' +
      '</div>';
  }

  // ------------------------------------------------------------------
  // Painel docente
  // ------------------------------------------------------------------
  function abrirPainel() {
    abrirModal(cabecalho('Painel docente', 'Carregando…'));
    api('painel').then(desenharPainel).catch(function (e) { abrirModal(cabecalho('Painel docente', esc(e.message))); });
  }
  function desenharPainel(d) {
    var pend = d.membros.filter(function (m) { return m.status === 'pendente'; });
    var titulo = function (id) { var p = projetoBruto(id); return p ? '#' + doisDigitos(p.id) + ' ' + esc(p.title) : '#' + esc(id); };
    var linhasPend = pend.map(function (m) {
      return '<tr><td>' + esc(m.nome) + '<br><small>' + esc(m.email) + '</small></td><td>' + titulo(m.projetos) + '</td><td>' +
        '<button class="pi2-btn mini primario" type="button" data-aprovar="' + esc(m.email) + '">Aprovar</button> ' +
        '<button class="pi2-btn mini perigo" type="button" data-recusar="' + esc(m.email) + '">Recusar</button></td></tr>';
    }).join('');
    var linhasMembros = d.membros.filter(function (m) { return m.status !== 'pendente'; }).map(function (m) {
      return '<tr><td>' + esc(m.nome || '—') + '<br><small>' + esc(m.email) + '</small></td><td>' + esc(m.papel) + '</td><td>' + esc(m.projetos) + '</td><td>' + esc(m.status) + '</td></tr>';
    }).join('');
    var linhasAlt = (d.alteracoes || []).map(function (a) {
      return '<tr><td>' + esc(dataBr(a.data)) + '</td><td>#' + doisDigitos(a.projeto) + '</td><td>' + esc(a.autor) + '</td><td>' + esc(a.campo) + '</td><td>' + esc(String(a.de).slice(0, 80)) + ' → ' + esc(String(a.para).slice(0, 80)) + '</td></tr>';
    }).join('');
    var corpo = abrirModal(cabecalho('Painel docente', 'Aprovação de acessos, cadastro de integrantes e histórico de alterações.') +
      '<p><a class="pi2-btn mini" href="' + esc(urlSegura(d.planilhaControle)) + '" target="_blank" rel="noopener"><i class="fa-solid fa-lock"></i> Planilha de controle (privada)</a> ' +
      '<a class="pi2-btn mini" href="' + esc(urlSegura(d.planilhaPublica)) + '" target="_blank" rel="noopener"><i class="fa-solid fa-table"></i> Planilha de projetos</a></p>' +
      '<h3 class="pi2-h">Solicitações pendentes (' + pend.length + ')</h3>' +
      (pend.length ? '<div class="pi2-table-wrap"><table class="pi2-table"><thead><tr><th>Estudante</th><th>Projeto pedido</th><th></th></tr></thead><tbody>' + linhasPend + '</tbody></table></div>' : '<div class="pi2-vazio">Nenhuma solicitação aguardando.</div>') +
      '<h3 class="pi2-h">Cadastrar ou alterar integrante</h3>' +
      '<form class="pi2-form"><div class="pi2-row"><div class="pi2-field"><label for="pi2-m-email">E-mail da conta Google</label><input id="pi2-m-email" name="email" type="email" required></div>' +
      '<div class="pi2-field"><label for="pi2-m-nome">Nome</label><input id="pi2-m-nome" name="nome" type="text" maxlength="120"></div></div>' +
      '<div class="pi2-row"><div class="pi2-field"><label for="pi2-m-proj">Projeto(s)</label><input id="pi2-m-proj" name="projetos" type="text" placeholder="Ex.: 3" inputmode="numeric"><span class="pi2-hint">Número do projeto; separe por vírgula se houver mais de um.</span></div>' +
      '<div class="pi2-field"><label for="pi2-m-status">Situação</label><select id="pi2-m-status" name="status"><option value="ativo">Ativo (aluno)</option><option value="docente">Ativo (docente)</option><option value="recusado">Bloqueado</option></select></div></div>' +
      '<div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn primario" type="submit">Salvar integrante</button></div></form>' +
      '<h3 class="pi2-h">Integrantes cadastrados</h3>' +
      (linhasMembros ? '<div class="pi2-table-wrap"><table class="pi2-table"><thead><tr><th>Pessoa</th><th>Papel</th><th>Projetos</th><th>Situação</th></tr></thead><tbody>' + linhasMembros + '</tbody></table></div>' : '<div class="pi2-vazio">Ninguém cadastrado ainda.</div>') +
      '<h3 class="pi2-h">Últimas alterações de ficha</h3>' +
      (linhasAlt ? '<div class="pi2-table-wrap"><table class="pi2-table"><thead><tr><th>Data</th><th>Proj.</th><th>Quem</th><th>Campo</th><th>De → para</th></tr></thead><tbody>' + linhasAlt + '</tbody></table></div>' : '<div class="pi2-vazio">Nenhuma alteração registrada.</div>'));

    $$('[data-aprovar],[data-recusar]', corpo).forEach(function (b) {
      b.onclick = function () {
        b.disabled = true;
        api('decidirAcesso', { email: b.dataset.aprovar || b.dataset.recusar, aprovar: !!b.dataset.aprovar }).then(desenharPainel)
          .catch(function (e) { b.disabled = false; aviso(e.message, 'warning'); });
      };
    });
    aoEnviar($('form', corpo), function (fd) {
      var st = fd.get('status');
      return api('salvarMembro', { email: fd.get('email'), nome: fd.get('nome'), projetos: fd.get('projetos'),
        papel: st === 'docente' ? 'docente' : 'aluno', status: st === 'recusado' ? 'recusado' : 'ativo' }).then(function (r) {
        aviso('Integrante salvo.'); desenharPainel(r);
      });
    });
  }

  // ------------------------------------------------------------------
  // Partida
  // ------------------------------------------------------------------
  // Utilitários compartilhados com os outros módulos (pi2-notas.js).
  PI2.interno = { esc: esc, urlSegura: urlSegura, $: $, $$: $$, api: api, aviso: aviso, abrirModal: abrirModal, fecharModal: fecharModal,
    cabecalho: cabecalho, aoEnviar: aoEnviar, ehDocente: ehDocente, doisDigitos: doisDigitos, dataBr: dataBr, haQuanto: haQuanto,
    projetoBruto: projetoBruto, registrosDo: registrosDo, pendente: pendente };

  // 1) Escapa imediatamente a cópia salva no HTML, antes do primeiro desenho.
  PI2.bruto = JSON.parse(JSON.stringify(projectsData));
  reescapar();

  // 2) Acrescenta os complementos a cada redesenho feito pelo código original.
  var desenharOriginal = window.renderProjects;
  window.renderProjects = function () { desenharOriginal(); complementarCards(); };
  var abrirOriginal = window.openModal;
  window.openModal = function (id) { abrirOriginal(id); PI2._modalProjeto = id; complementarModalProjeto(id); };
  window.liveSyncFromSheet = PI2.sincronizar;

  window.addEventListener('load', function () {
    desenharAuth();
    desenharRaioX();
    atualizarContadores();
    carregarGoogle();
    var salvo = null;
    try { salvo = sessionStorage.getItem('pi2-token'); } catch (e) { /* armazenamento indisponível */ }
    var perfil = salvo && lerToken(salvo);
    var retomar = loginConfigurado() && perfil && perfil.exp * 1000 > Date.now() + 60000;
    carregar(true).then(function () { if (retomar) PI2._entrarComToken(salvo, true); });
  });
})();
