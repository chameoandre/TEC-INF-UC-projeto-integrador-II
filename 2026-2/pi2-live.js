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
    links: [],        // links extras dos projetos: {id, projeto, nome, url}
    avaliacoes: [],   // avaliações de rubricas pedagógicas
    demandas: [],     // demandas e checkpoints (gerais ou direcionadas por grupo)
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
  function ehIndividual(p) { return !!p.isDomiciliar || p.id === 11; }
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
      var m = v.match(/https?:\/\/[^\s,"]*overleaf\.com\/read\/[^\s,"]*/);
      if (m) { overleaf = m[0]; return true; }
      return false;
    });
    if (!overleaf) {
      [relatorio, paper4, paper1].some(function (v) {
        var m = v.match(/https?:\/\/[^\s,"]*overleaf\.com[^\s,"]*/);
        if (m) { overleaf = m[0]; return true; }
        return false;
      });
    }
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
      overleafStatus: !overleaf ? 'pendente' : (overleaf.indexOf('/project/') >= 0 ? 'privado' : (overleaf.indexOf('/read/') >= 0 ? 'ok' : 'edicao')),
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
    if (id === 11) p.isDomiciliar = true;
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
  /** Situação do link do Overleaf: só o link de leitura (/read/) é seguro para publicar. */
  function statusOverleaf(url) {
    if (!url) return 'pendente';
    if (url.indexOf('/project/') >= 0) return 'privado';   // link interno: ninguém de fora abre
    return url.indexOf('/read/') >= 0 ? 'ok' : 'edicao';   // sem /read/ é link de edição: quem abre altera o artigo
  }
  // ------------------------------------------------------------------
  // Estrutura de Objetivos: Geral + 4 Degraus Metodológicos + Desdobramentos
  // ------------------------------------------------------------------
  function parseObjetivos(texto) {
    var raw = String(texto || '').trim();
    var res = {
      geral: '',
      d1: '',
      d2: '',
      d3: '',
      d4: '',
      extras: [] // [{ degrau: 'D1'|'D2'|'D3'|'D4', texto: '...' }]
    };
    if (!raw) return res;

    if (/\[OBJETIVO GERAL\]/i.test(raw) || /\[OBJETIVOS ESPEC[ÍI]FICOS\]/i.test(raw) || /\[D[1-4]\]/i.test(raw)) {
      var partes = raw.split(/\[OBJETIVOS ESPEC[ÍI]FICOS\]/i);
      var blocoGeral = partes[0].replace(/\[OBJETIVO GERAL\]/i, '');
      var blocoEsp = partes.length > 1 ? partes.slice(1).join('\n') : '';

      // Caso o aluno tenha usado [D1]..[D4] sem o cabeçalho [OBJETIVOS ESPECÍFICOS]
      if (!blocoEsp && /\[D[1-4]\]/i.test(blocoGeral)) {
        var idxPrimeiroD = blocoGeral.search(/(?:^|\r?\n)\s*[-*•]?\s*\[D[1-4]\]/i);
        if (idxPrimeiroD >= 0) {
          blocoEsp = blocoGeral.slice(idxPrimeiroD);
          blocoGeral = blocoGeral.slice(0, idxPrimeiroD);
        }
      }
      res.geral = blocoGeral.trim();

      if (blocoEsp) {
        var linhas = blocoEsp.split(/\r?\n/);
        var ultimoAlvo = null; // { tipo: 'd1'|'d2'|'d3'|'d4'|'extra', idx?: number }
        linhas.forEach(function (linha) {
          var m = linha.match(/^\s*[-*•]?\s*\[(D[1-4])\]\s*(.*)$/i);
          if (m) {
            var deg = m[1].toUpperCase();
            var cont = m[2].trim();
            var chave = deg.toLowerCase();
            if (!res[chave] && ultimoAlvo && ultimoAlvo.tipo === chave) {
              res[chave] = cont;
            } else if (!res[chave]) {
              res[chave] = cont;
              ultimoAlvo = { tipo: chave };
            } else if (cont) {
              res.extras.push({ degrau: deg, texto: cont });
              ultimoAlvo = { tipo: 'extra', idx: res.extras.length - 1 };
            } else {
              ultimoAlvo = { tipo: chave };
            }
          } else {
            var contLinha = linha.trim();
            if (contLinha && ultimoAlvo) {
              if (ultimoAlvo.tipo === 'extra' && res.extras[ultimoAlvo.idx]) {
                res.extras[ultimoAlvo.idx].texto += '\n' + contLinha;
              } else if (ultimoAlvo.tipo && ultimoAlvo.tipo.indexOf('d') === 0) {
                res[ultimoAlvo.tipo] = (res[ultimoAlvo.tipo] ? res[ultimoAlvo.tipo] + '\n' : '') + contLinha;
              }
            }
          }
        });
      }
    } else {
      res.geral = raw;
    }
    return res;
  }

  function serializarObjetivos(dados) {
    var linhas = [];
    linhas.push('[OBJETIVO GERAL]');
    linhas.push(String(dados.geral || '').trim());
    linhas.push('');
    linhas.push('[OBJETIVOS ESPECÍFICOS]');
    linhas.push('- [D1] ' + String(dados.d1 || '').trim());
    linhas.push('- [D2] ' + String(dados.d2 || '').trim());
    linhas.push('- [D3] ' + String(dados.d3 || '').trim());
    linhas.push('- [D4] ' + String(dados.d4 || '').trim());
    (dados.extras || []).forEach(function (ex) {
      var tx = String(ex.texto || '').trim();
      if (tx) {
        linhas.push('- [' + String(ex.degrau || 'D1').toUpperCase() + '] ' + tx);
      }
    });
    return linhas.join('\n');
  }

  PI2.parseObjetivos = parseObjetivos;
  PI2.serializarObjetivos = serializarObjetivos;

  function reescapar() {
    // Recalcula aqui para valer também para dados vindos de um backend ou de uma cópia antiga.
    PI2.bruto.forEach(function (p) {
      if (/overleaf\.com/.test(p.overleaf || '')) p.overleafStatus = statusOverleaf(p.overleaf);
      p.objetivosParsed = parseObjetivos(p.objective);
      p.objetivoGeral = p.objetivosParsed.geral;
    });
    projectsData.length = 0;
    PI2.bruto.forEach(function (p) {
      var ep = escaparProjeto(p);
      if (p.objetivosParsed && p.objetivosParsed.geral) {
        ep.objectiveOriginal = ep.objective;
        ep.objective = esc(p.objetivosParsed.geral);
      }
      projectsData.push(ep);
    });
  }

  function redesenhar() {
    window.renderProjects();
    window.renderAuditTable();
    desenharRaioX();
    atualizarContadores();
    if ($('#tab-notas') && ($('#tab-notas').classList.contains('active') || PI2._notasRenderizado)) {
      renderNotasTab();
    }
    if ($('#tab-demandas') && ($('#tab-demandas').classList.contains('active') || PI2._demandasRenderizado)) {
      renderDemandasTab();
    }
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
      PI2.links = d.links || [];
      PI2.avaliacoes = d.avaliacoes || [];
      PI2.demandas = d.demandas || [];
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

  function guardarSessao(jwt, usuario) {
    try {
      localStorage.setItem('pi2-token', jwt);
      if (usuario) localStorage.setItem('pi2-usuario', JSON.stringify(usuario));
    } catch (e) {
      try {
        sessionStorage.setItem('pi2-token', jwt);
        if (usuario) sessionStorage.setItem('pi2-usuario', JSON.stringify(usuario));
      } catch (e2) {}
    }
  }

  function lerSessaoGuardada() {
    try {
      var tok = localStorage.getItem('pi2-token') || sessionStorage.getItem('pi2-token');
      var usrStr = localStorage.getItem('pi2-usuario') || sessionStorage.getItem('pi2-usuario');
      var usr = null;
      try { usr = usrStr ? JSON.parse(usrStr) : null; } catch (e) {}
      return { token: tok, usuario: usr };
    } catch (e) {
      return { token: null, usuario: null };
    }
  }

  function limparSessaoGuardada() {
    try {
      localStorage.removeItem('pi2-token');
      localStorage.removeItem('pi2-usuario');
    } catch (e) {}
    try {
      sessionStorage.removeItem('pi2-token');
      sessionStorage.removeItem('pi2-usuario');
    } catch (e) {}
  }

  function agendarRenovacao(perfil) {
    if (PI2._timerRenovacao) { clearTimeout(PI2._timerRenovacao); PI2._timerRenovacao = null; }
    if (!perfil || !perfil.exp) return;
    var msRestantes = (perfil.exp * 1000) - Date.now();
    var delay = msRestantes - 120000; // 2 min antes do token de 1h expirar
    if (delay > 0) {
      PI2._timerRenovacao = setTimeout(function () {
        tentarAutoLoginGoogle();
      }, delay);
    }
  }

  function tentarAutoLoginGoogle() {
    if (!loginConfigurado() || !PI2._googlePronto) return;
    try {
      google.accounts.id.prompt();
    } catch (e) {}
  }

  function aoReceberCredencial(resp) { return PI2._entrarComToken(resp.credential, false); }

  PI2._entrarComToken = function (jwt, silencioso) {
    var perfil = lerToken(jwt);
    if (!perfil) {
      if (!silencioso) aviso('Login inválido.', 'warning');
      return Promise.resolve();
    }
    PI2.token = jwt; PI2.perfil = perfil;
    guardarSessao(jwt, PI2.usuario);
    agendarRenovacao(perfil);
    return api('whoami').then(function (d) {
      if (d.usuario) {
        PI2.usuario = d.usuario;
        guardarSessao(jwt, d.usuario);
      }
      desenharAuth(); redesenhar();
      var u = PI2.usuario;
      if (silencioso) return;
      if (u.status === 'ativo') {
        fecharModal();
        aviso('Olá, ' + u.nome.split(' ')[0] + '! Login confirmado.');
        if (PI2._aposLogin) { var f = PI2._aposLogin; PI2._aposLogin = null; f(); }
      } else abrirSolicitacao();
    }).catch(function (e) {
      var msg = String(e && e.message || '');
      var expirado = msg.indexOf('expir') >= 0 || msg.indexOf('inválid') >= 0;
      if (expirado) {
        sair(true);
        if (!silencioso) aviso('Sua sessão expirou. Entre novamente.', 'warning');
      } else if (!silencioso) {
        aviso(e.message, 'warning');
      }
    });
  };

  function sair(silencioso) {
    if (PI2._timerRenovacao) { clearTimeout(PI2._timerRenovacao); PI2._timerRenovacao = null; }
    PI2.token = null; PI2.perfil = null; PI2.usuario = null;
    limparSessaoGuardada();
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
      google.accounts.id.initialize({
        client_id: CFG.googleClientId,
        callback: aoReceberCredencial,
        auto_select: true,
        use_fedcm_for_prompt: true
      });
      PI2._googlePronto = true;
      desenharAuth();
      if (!tokenValido()) {
        tentarAutoLoginGoogle();
      }
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

  /** Selo com o total de pedidos de acesso e links aguardando decisão do docente. */
  function contadorPendencias() {
    var p = (PI2.usuario && PI2.usuario.pendencias) || PI2._pendencias;
    if (PI2.usuario && PI2.usuario.pendencias) PI2._pendencias = PI2.usuario.pendencias;
    var n = p ? (p.acessos || 0) + (p.links || 0) : 0;
    return n ? ' <span class="pi2-contador-pend" title="' + (p.acessos || 0) + ' pedido(s) de acesso e ' + (p.links || 0) + ' link(s) aguardando sua decisão">' + n + '</span>' : '';
  }

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
      (ehDocente() ? '<button class="btn btn-outline" type="button" id="pi2-btn-painel"><i class="fa-solid fa-user-shield"></i> Painel docente' + contadorPendencias() + '</button>' : '') +
      (ehDocente() ? ' <button class="btn btn-action" type="button" id="pi2-btn-demanda-top" style="background:var(--accent-blue);color:#fff;font-size:0.78rem;padding:0.35rem 0.65rem;" title="Criar nova demanda docente ou broadcast"><i class="fa-solid fa-bullhorn"></i> Nova Demanda</button>' : '') +
      (u.status !== 'ativo' ? '<button class="pi2-linkbtn" type="button" id="pi2-btn-solicitar">Solicitar acesso</button>' : '') +
      '<button class="pi2-linkbtn" type="button" id="pi2-btn-sair">Sair</button>';
    $('#pi2-btn-sair').onclick = PI2.sair;
    PI2.ganchosAuth.forEach(function (f) { f(el, u); });
    if ($('#pi2-btn-painel')) $('#pi2-btn-painel').onclick = abrirPainel;
    if ($('#pi2-btn-demanda-top')) $('#pi2-btn-demanda-top').onclick = function () { PI2.abrirModalCriarDemanda('*'); };
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
    var corpo = abrirModal(cabecalho('Entre com sua conta Google', 'Use sua conta Google cadastrada no SIGAA ou sua conta institucional (@aluno.ifsc.edu.br). Só integrantes vinculados ao projeto conseguem editar a ficha e registrar avanços.') +
      '<div class="pi2-google-btn" id="pi2-google-modal"></div>');
    botaoGoogle($('#pi2-google-modal', corpo), true);
  }

  function abrirSolicitacao(projSugerido) {
    var u = PI2.usuario;
    if (!u) return abrirLogin();
    if (u.status === 'pendente') {
      abrirModal(cabecalho('Solicitação enviada', 'Seu pedido de acesso ao projeto #' + esc((u.pedido || []).join(', #')) + ' com a conta <strong>' + esc(u.email) + '</strong> aguarda a aprovação de um docente. Depois de aprovado, basta atualizar a página.'));
      return;
    }
    if (u.dominioOk === false) {
      abrirModal(cabecalho('Conta não autorizada', 'Você entrou como <strong>' + esc(u.email) + '</strong>. Saia e entre com a sua conta institucional do IFSC ou com o e-mail cadastrado no SIGAA.'));
      return;
    }
    var opcoes = PI2.bruto.map(function (p) {
      var sel = Number(projSugerido) === Number(p.id) ? ' selected' : '';
      return '<option value="' + p.id + '"' + sel + '>#' + doisDigitos(p.id) + ' — ' + esc(p.title) + ' (' + esc(p.team) + ')</option>';
    }).join('');
    var corpo = abrirModal(cabecalho('Solicitar acesso a um projeto', 'Você entrou como <strong>' + esc(u.email) + '</strong>, que ainda não está vinculado a nenhum projeto. Escolha o seu; um docente confirma o vínculo.') +
      '<form class="pi2-form"><div class="pi2-field"><label for="pi2-sol-proj">Meu projeto</label><select id="pi2-sol-proj" name="projeto" required>' + opcoes + '</select></div>' +
      '<div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn primario" type="submit">Enviar solicitação</button></div></form>');
    aoEnviar($('form', corpo), function (fd) {
      return api('solicitarAcesso', { projeto: Number(fd.get('projeto')) }).then(function (res) {
        if (res && res.usuario) {
          PI2.usuario = res.usuario;
          guardarSessao(PI2.token, res.usuario);
        }
        desenharAuth();
        redesenhar();
        if (PI2.usuario && PI2.usuario.status === 'ativo') {
          fecharModal();
          aviso('Vínculo confirmado automaticamente! Você já pode editar seu projeto.');
        } else {
          abrirSolicitacao();
        }
      });
    });
  }

  PI2.abrirRegistro = function (id) {
    if (!PI2.usuario) return abrirLogin(function () { PI2.abrirRegistro(id); });
    if (PI2.usuario.status !== 'ativo') return abrirSolicitacao(id);
    if (!podeEditar(id)) return aviso('Você só pode registrar avanços no seu próprio projeto.', 'warning');
    var p = projetoBruto(id);
    if (!p) return;
    var exps = [1, 2, 3, 4].map(function (n) {
      var t = p.experiments && p.experiments['exp' + n];
      return '<option value="' + n + '">Exp ' + n + (pendente(t) ? '' : ' — ' + esc(String(t).slice(0, 60))) + '</option>';
    }).join('');
    var demandasAbertas = (PI2.demandas || []).filter(function (d) {
      return (d.projeto === '*' || Number(d.projeto) === Number(id)) && d.status !== 'concluida';
    });
    var selectDemanda = demandasAbertas.length > 0 ? (
      '<div class="pi2-field" style="background:var(--chip-bg);padding:0.75rem;border-radius:var(--radius-sm,6px);border:1px solid var(--border-color);">' +
        '<label for="pi2-reg-demanda" style="color:var(--accent-cyan);font-weight:700;"><i class="fa-solid fa-link"></i> Este avanço cumpre alguma demanda do orientador?</label>' +
        '<select id="pi2-reg-demanda" name="demandaId">' +
          '<option value="">Nenhuma / Avanço geral de rotina</option>' +
          demandasAbertas.map(function (d) {
            return '<option value="' + esc(d.id) + '">[' + (d.projeto === '*' ? 'Geral' : '#' + doisDigitos(d.projeto)) + '] ' + esc(d.titulo) + (d.prazo ? ' (Prazo: ' + esc(d.prazo) + ')' : '') + '</option>';
          }).join('') +
        '</select>' +
      '</div>'
    ) : '';

    var corpo = abrirModal(cabecalho('Registrar avanço', '#' + doisDigitos(p.id) + ' — ' + esc(p.title) + '. O registro entra na linha do tempo do projeto com seu nome e a data de hoje.') +
      '<form class="pi2-form">' +
        selectDemanda +
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
        dificuldades: dif === String(p.difficulties || '').trim() ? '' : dif,
        demandaId: fd.get('demandaId') || ''
      }).then(function () {
        fecharModal(); aviso('Avanço registrado.');
        return carregar(true);
      });
    });
  };

  var CAMPOS_FICHA = [
    { k: 'github', r: 'Repositório GitHub', t: 'url' },
    { k: 'relatorio', r: 'Artigo no Overleaf (link de leitura)', t: 'url', d: 'No Overleaf: Share → Turn on link sharing → copie o link “Anyone with this link can view”.' },
    { k: 'canva', r: 'Diagrama da arquitetura (Canva, Miro, Drive…)', t: 'url' },
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
    if (k === 'relatorio') return (p.relatorio != null && !pendente(p.relatorio)) ? p.relatorio : (p.overleaf || '');
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
    if (PI2.usuario.status !== 'ativo') return abrirSolicitacao(id);
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

    var rawObj = String(valorAtual(p, 'objective') || p.objective || '').trim();
    iniciais['objective'] = rawObj;
    var parsedObj = parseObjetivos(rawObj);

    function itemExtraHtml(degrau, texto, idx) {
      return '<div class="pi2-obj-extra-item" data-extra-idx="' + idx + '" style="background:var(--chip-bg);border:1px dashed var(--accent-cyan);border-radius:6px;padding:0.65rem 0.8rem;display:flex;flex-direction:column;gap:0.4rem;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<div style="display:flex;align-items:center;gap:0.5rem;">' +
            '<span style="font-size:0.75rem;font-weight:700;color:var(--text-main);"><i class="fa-solid fa-code-branch" style="color:var(--accent-cyan);"></i> Desdobramento de:</span>' +
            '<select class="pi2-extra-degrau-select" style="font-size:0.78rem;padding:0.2rem 0.45rem;border-radius:4px;font-weight:700;">' +
              '<option value="D1"' + (degrau === 'D1' ? ' selected' : '') + '>D1 (Diagnóstico/Requisitos)</option>' +
              '<option value="D2"' + (degrau === 'D2' ? ' selected' : '') + '>D2 (Modelagem/Design)</option>' +
              '<option value="D3"' + (degrau === 'D3' ? ' selected' : '') + '>D3 (Implementação/Código)</option>' +
              '<option value="D4"' + (degrau === 'D4' ? ' selected' : '') + '>D4 (Validação/Testes)</option>' +
            '</select>' +
          '</div>' +
          '<button type="button" class="pi2-btn-remover-extra" style="background:none;border:none;color:var(--ifsc-red,#ef4444);cursor:pointer;font-size:0.85rem;" title="Remover desdobramento">' +
            '<i class="fa-solid fa-trash-can"></i>' +
          '</button>' +
        '</div>' +
        '<textarea class="pi2-curto pi2-extra-texto" rows="2" maxlength="500" placeholder="Redação do objetivo específico adicional relacionado a este degrau...">' + esc(texto) + '</textarea>' +
      '</div>';
    }

    var blocoObjetivos = `
      <div class="pi2-rubrica-section" style="border-left:4px solid var(--accent-cyan);padding:1rem;margin-bottom:1rem;">
        <div class="pi2-field" style="margin-bottom:0.75rem;">
          <label for="pi2-f-obj-geral" style="font-size:0.88rem;font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:0.4rem;">
            <i class="fa-solid fa-bullseye" style="color:var(--accent-cyan);"></i> Objetivo Geral do Projeto
          </label>
          <div class="pi2-hint" style="margin-bottom:0.4rem;font-size:0.75rem;line-height:1.4;">
            <strong>Fórmula do Roteiro 1:</strong> <code>[Verbo no Infinitivo] + [Entregável de Software/Hardware Tangível] + [Público-Alvo e Contexto] + [Propósito e Impacto Real]</code>
          </div>
          <textarea id="pi2-f-obj-geral" class="pi2-curto" rows="3" maxlength="1000" placeholder="Ex: Desenvolver uma estação meteorológica IoT de baixo custo para o campus do IFSC com sensores e microcontrolador ESP32 para monitoramento microclimático e fins educacionais...">${esc(parsedObj.geral)}</textarea>
        </div>

        <fieldset class="pi2-fieldset" style="border:1px solid var(--border-color);border-radius:8px;padding:0.9rem;margin-top:1rem;">
          <legend style="font-weight:700;color:var(--text-main);font-size:0.85rem;display:flex;align-items:center;gap:0.4rem;">
            <i class="fa-solid fa-stairs" style="color:var(--ifsc-green);"></i> Objetivos Específicos — 4 Degraus Metodológicos
          </legend>
          <div class="pi2-hint" style="margin-bottom:0.75rem;font-size:0.75rem;">
            Padrão mínimo de 4 objetivos específicos cobrindo todo o ciclo metodológico (D1 a D4). Caso necessite desdobrar algum degrau em mais frentes de trabalho, use o botão <strong>+ Adicionar objetivo específico</strong>.
          </div>

          <!-- D1 -->
          <div class="pi2-field" style="margin-bottom:0.75rem;">
            <label for="pi2-f-obj-d1" style="font-size:0.8rem;font-weight:700;color:var(--accent-cyan);display:flex;align-items:center;gap:0.4rem;">
              <span class="proj-id-badge" style="font-size:0.65rem;padding:0.15rem 0.35rem;">D1</span> Degrau 1: Diagnóstico, Requisitos & Estado da Arte
            </label>
            <div class="pi2-hint" style="font-size:0.72rem;margin-bottom:0.25rem;">Verbos: <em>Mapear, Identificar, Levantar requisitos e analisar trabalhos relacionados.</em></div>
            <textarea id="pi2-f-obj-d1" class="pi2-curto" rows="2" maxlength="600" placeholder="Ex: Mapear os requisitos funcionais e não-funcionais dos sensores meteorológicos e levantar o estado da arte na literatura...">${esc(parsedObj.d1)}</textarea>
          </div>

          <!-- D2 -->
          <div class="pi2-field" style="margin-bottom:0.75rem;">
            <label for="pi2-f-obj-d2" style="font-size:0.8rem;font-weight:700;color:var(--accent-cyan);display:flex;align-items:center;gap:0.4rem;">
              <span class="proj-id-badge" style="font-size:0.65rem;padding:0.15rem 0.35rem;">D2</span> Degrau 2: Modelagem, Arquitetura & Design
            </label>
            <div class="pi2-hint" style="font-size:0.72rem;margin-bottom:0.25rem;">Verbos: <em>Modelar arquitetura técnica no Canva/Draw.io, Prototipar wireframes e diagramas de fluxo.</em></div>
            <textarea id="pi2-f-obj-d2" class="pi2-curto" rows="2" maxlength="600" placeholder="Ex: Modelar a arquitetura física dos circuitos eletrônicos e projetar os wireframes da interface web responsiva...">${esc(parsedObj.d2)}</textarea>
          </div>

          <!-- D3 -->
          <div class="pi2-field" style="margin-bottom:0.75rem;">
            <label for="pi2-f-obj-d3" style="font-size:0.8rem;font-weight:700;color:var(--accent-cyan);display:flex;align-items:center;gap:0.4rem;">
              <span class="proj-id-badge" style="font-size:0.65rem;padding:0.15rem 0.35rem;">D3</span> Degrau 3: Implementação, Código & Software
            </label>
            <div class="pi2-hint" style="font-size:0.72rem;margin-bottom:0.25rem;">Verbos: <em>Desenvolver firmware/software, Versionar no GitHub, Implementar rotinas e integrações.</em></div>
            <textarea id="pi2-f-obj-d3" class="pi2-curto" rows="2" maxlength="600" placeholder="Ex: Desenvolver o firmware de leitura em C++, implementar a API de ingestão de dados e versionar no GitHub...">${esc(parsedObj.d3)}</textarea>
          </div>

          <!-- D4 -->
          <div class="pi2-field" style="margin-bottom:0.75rem;">
            <label for="pi2-f-obj-d4" style="font-size:0.8rem;font-weight:700;color:var(--accent-cyan);display:flex;align-items:center;gap:0.4rem;">
              <span class="proj-id-badge" style="font-size:0.65rem;padding:0.15rem 0.35rem;">D4</span> Degrau 4: Validação, Testes Experimentais & Métricas
            </label>
            <div class="pi2-hint" style="font-size:0.72rem;margin-bottom:0.25rem;">Verbos: <em>Validar precisão e calibração, Executar testes controlados, Coletar métricas com usuários.</em></div>
            <textarea id="pi2-f-obj-d4" class="pi2-curto" rows="2" maxlength="600" placeholder="Ex: Validar a calibragem dos sensores em bancada experimental e avaliar a usabilidade do painel com a comunidade escolar...">${esc(parsedObj.d4)}</textarea>
          </div>

          <!-- Lista de Desdobramentos Extras -->
          <div id="pi2-lista-especificos-extras" style="display:flex;flex-direction:column;gap:0.6rem;margin-top:0.6rem;">
            ${(parsedObj.extras || []).map(function (ex, idx) {
              return itemExtraHtml(ex.degrau, ex.texto, idx);
            }).join('')}
          </div>

          <div style="margin-top:0.85rem;display:flex;justify-content:flex-end;">
            <button type="button" class="btn btn-outline" id="pi2-btn-add-obj-esp" style="font-size:0.78rem;padding:0.35rem 0.75rem;color:var(--accent-cyan);border-color:var(--accent-cyan);">
              <i class="fa-solid fa-plus"></i> Adicionar Objetivo Específico
            </button>
          </div>
        </fieldset>
      </div>
    `;

    var corpo = abrirModal(cabecalho('Atualizar ficha do projeto', '#' + doisDigitos(p.id) + ' — ' + esc(p.title) + '. Só os campos que você alterar são gravados; cada alteração fica registrada com autor, data e valor anterior.') +
      '<form class="pi2-form">' + (ehDocente() ? bloco(CAMPOS_FICHA_DOCENTE.slice(0, 2)) : '') + blocoObjetivos + bloco(CAMPOS_FICHA) + exps +
      (ehDocente() ? bloco(CAMPOS_FICHA_DOCENTE.slice(2)) : '') +
      '<div class="pi2-erro" role="alert"></div>' +
      '<div class="pi2-actions"><button class="pi2-btn" type="button" id="pi2-cancelar">Cancelar</button><button class="pi2-btn primario" type="submit"><i class="fa-solid fa-floppy-disk"></i> Salvar alterações</button></div></form>');
    $('#pi2-cancelar', corpo).onclick = fecharModal;

    // Ações para adicionar e remover objetivos específicos extras
    var btnAddExtra = $('#pi2-btn-add-obj-esp', corpo);
    var containerExtras = $('#pi2-lista-especificos-extras', corpo);
    if (btnAddExtra && containerExtras) {
      btnAddExtra.onclick = function () {
        var count = containerExtras.children.length;
        var wrapper = document.createElement('div');
        wrapper.innerHTML = itemExtraHtml('D1', '', count);
        var novoItem = wrapper.firstElementChild;
        containerExtras.appendChild(novoItem);
        var txtArea = $('.pi2-extra-texto', novoItem);
        if (txtArea) txtArea.focus();
      };
    }

    corpo.addEventListener('click', function (e) {
      var btnRem = e.target.closest('.pi2-btn-remover-extra');
      if (btnRem) {
        var item = btnRem.closest('.pi2-obj-extra-item');
        if (item) item.remove();
      }
    });

    aoEnviar($('form', corpo), function (fd) {
      var campos = {};

      // Coleta Objetivo Geral + Objetivos Específicos estruturados
      var g = ($('#pi2-f-obj-geral', corpo) ? $('#pi2-f-obj-geral', corpo).value : '').trim();
      var d1 = ($('#pi2-f-obj-d1', corpo) ? $('#pi2-f-obj-d1', corpo).value : '').trim();
      var d2 = ($('#pi2-f-obj-d2', corpo) ? $('#pi2-f-obj-d2', corpo).value : '').trim();
      var d3 = ($('#pi2-f-obj-d3', corpo) ? $('#pi2-f-obj-d3', corpo).value : '').trim();
      var d4 = ($('#pi2-f-obj-d4', corpo) ? $('#pi2-f-obj-d4', corpo).value : '').trim();
      var extras = [];
      $$('.pi2-obj-extra-item', corpo).forEach(function (item) {
        var sel = $('.pi2-extra-degrau-select', item);
        var txt = $('.pi2-extra-texto', item);
        if (txt && txt.value.trim()) {
          extras.push({ degrau: sel ? sel.value : 'D1', texto: txt.value.trim() });
        }
      });
      var objSerializado = serializarObjetivos({ geral: g, d1: d1, d2: d2, d3: d3, d4: d4, extras: extras }).replace(/\r\n?/g, '\n');
      if (objSerializado !== String(iniciais['objective'] || '').replace(/\r\n?/g, '\n')) {
        campos['objective'] = objSerializado;
      }

      Object.keys(iniciais).forEach(function (k) {
        if (k === 'objective') return;
        var v = String(fd.get(k) || '').replace(/\r\n?/g, '\n').trim();
        var ini = String(iniciais[k] || '').replace(/\r\n?/g, '\n').trim();
        if (v !== ini) campos[k] = v;
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
    var alvo = e.target.closest ? e.target.closest('[data-pi2-dev],[data-pi2-ocultar],[data-pi2-todos],[data-pi2-registrar],[data-pi2-ficha],[data-pi2-links],[data-pi2-notas],[data-pi2-demanda],[data-pi2-concluir-demanda],[data-pi2-remover-demanda]') : null;
    if (!alvo) return;
    e.stopPropagation();
    if (alvo.dataset.pi2Dev) abrirDevolutiva(alvo.dataset.pi2Dev);
    else if (alvo.dataset.pi2Ocultar) ocultarRegistro(alvo.dataset.pi2Ocultar);
    else if (alvo.dataset.pi2Todos) window.openModal(Number(alvo.dataset.pi2Todos));
    else if (alvo.dataset.pi2Registrar) PI2.abrirRegistro(Number(alvo.dataset.pi2Registrar));
    else if (alvo.dataset.pi2Ficha) PI2.abrirFicha(Number(alvo.dataset.pi2Ficha));
    else if (alvo.dataset.pi2Links) PI2.abrirLinks(Number(alvo.dataset.pi2Links));
    else if (alvo.dataset.pi2Notas) PI2.abrirModalAvaliarObjetivos(Number(alvo.dataset.pi2Notas));
    else if (alvo.dataset.pi2Demanda) PI2.abrirModalCriarDemanda(alvo.dataset.pi2Demanda);
    else if (alvo.dataset.pi2ConcluirDemanda) PI2.concluirDemanda(alvo.dataset.pi2ConcluirDemanda);
    else if (alvo.dataset.pi2RemoverDemanda) PI2.removerDemanda(alvo.dataset.pi2RemoverDemanda);
  }, true);

  // ------------------------------------------------------------------
  // Complementos nos cards e na ficha completa
  // ------------------------------------------------------------------
  function botoesAcao(id, compacto) {
    if (PI2.usuario && PI2.usuario.status === 'ativo' && !podeEditar(id)) return '';
    if (!PI2.usuario && !loginConfigurado()) return '';
    if (compacto) {
      return (ehDocente() ? '<button type="button" class="link-btn pi2-notas-btn" data-pi2-notas="' + id + '" title="Avaliar rubricas e notas deste projeto"><i class="fa-solid fa-clipboard-list"></i> Avaliar</button> ' : '') +
        (ehDocente() ? '<button type="button" class="link-btn" data-pi2-demanda="' + id + '" title="Criar demanda para esta equipe"><i class="fa-solid fa-bullhorn"></i> Demanda</button> ' : '') +
        '<button type="button" class="link-btn pi2-editar-ficha" data-pi2-ficha="' + id + '" title="Editar objetivos (Geral e D1-D4), experimentos, trabalhos relacionados e ficha"><i class="fa-solid fa-sliders"></i> Editar ficha</button> ' +
        '<button type="button" class="link-btn pi2-registrar" data-pi2-registrar="' + id + '" title="Registrar um avanço deste projeto"><i class="fa-solid fa-pen-to-square"></i> Registrar</button>';
    }
    return '<button type="button" class="pi2-btn mini primario" data-pi2-registrar="' + id + '"><i class="fa-solid fa-pen-to-square"></i> Registrar avanço</button> ' +
      '<button type="button" class="pi2-btn mini" data-pi2-links="' + id + '"><i class="fa-solid fa-link"></i> Links</button> ' +
      '<button type="button" class="pi2-btn mini" data-pi2-ficha="' + id + '"><i class="fa-solid fa-sliders"></i> Atualizar ficha</button>' +
      (ehDocente() ? ' <button type="button" class="pi2-btn mini" data-pi2-demanda="' + id + '" title="Criar demanda para esta equipe"><i class="fa-solid fa-bullhorn"></i> Demanda</button>' : '') +
      (ehDocente() ? ' <button type="button" class="pi2-btn mini" data-pi2-notas="' + id + '" title="Avaliar rubricas e notas deste projeto"><i class="fa-solid fa-clipboard-list"></i> Avaliar Rubrica</button>' : '');
  }

  // ------------------------------------------------------------------
  // Links do projeto: os quatro fixos da ficha e a lista livre de links extras
  // ------------------------------------------------------------------
  function linksDo(id) { return PI2.links.filter(function (l) { return Number(l.projeto) === Number(id) && urlSegura(l.url); }); }
  /** Botões dos links extras, no formato do card (compacto) ou da ficha completa. */
  function linksExtrasHtml(id, compacto) {
    return linksDo(id).map(function (l) {
      return compacto
        ? '<a href="' + esc(urlSegura(l.url)) + '" target="_blank" rel="noopener" class="link-btn pi2-link-extra" title="' + esc(l.nome) + '" onclick="event.stopPropagation();"><i class="fa-solid fa-link"></i> <span class="pi2-rotulo">' + esc(l.nome) + '</span></a>'
        : '<a href="' + esc(urlSegura(l.url)) + '" target="_blank" rel="noopener" class="pi2-btn mini"><i class="fa-solid fa-link"></i> ' + esc(l.nome) + '</a>';
    }).join(compacto ? '' : ' ');
  }
  var LINKS_FIXOS = [
    { k: 'github', r: 'Repositório GitHub' },
    { k: 'relatorio', r: 'Artigo no Overleaf (link de leitura)', d: 'No Overleaf: Share → copie o link “Anyone with this link can view” (…/read/…).' },
    { k: 'canva', r: 'Diagrama da arquitetura' },
    { k: 'pitch', r: 'Pitch em vídeo' }
  ];

  PI2.abrirLinks = function (id, doProjeto) {
    if (!PI2.usuario) return abrirLogin(function () { PI2.abrirLinks(id); });
    if (PI2.usuario.status !== 'ativo') return abrirSolicitacao(id);
    if (!podeEditar(id)) return aviso('Você só pode alterar os links do seu próprio projeto.', 'warning');
    var p = projetoBruto(id);
    if (!p) return;
    if (!doProjeto) {
      // A situação de cada link (no ar, aguardando, recusado) só o servidor sabe.
      abrirModal(cabecalho('Links do projeto', 'Carregando…'));
      api('linksProjeto', { projeto: id }).then(function (r) { PI2.abrirLinks(id, r.doProjeto || []); })
        .catch(function (e) { abrirModal(cabecalho('Links do projeto', esc(e.message))); });
      return;
    }
    var iniciais = {};
    var fixos = LINKS_FIXOS.map(function (c) {
      iniciais[c.k] = String(valorAtual(p, c.k)).trim();
      return campoHtml({ k: c.k, r: c.r, d: c.d, t: 'url' }, iniciais[c.k]);
    }).join('');
    var SELO = { aprovado: '<span class="pi2-selo pub">no ar</span>', pendente: '<span class="pi2-selo parcial">aguardando aprovação do professor</span>', recusado: '<span class="pi2-selo">não aprovado</span>' };
    var extras = doProjeto || linksDo(id).map(function (l) { return { id: l.id, nome: l.nome, url: l.url, status: 'aprovado' }; });
    var lista = extras.length
      ? '<div class="pi2-table-wrap"><table class="pi2-table"><tbody>' + extras.map(function (l) {
          return '<tr><td><strong>' + esc(l.nome) + '</strong> ' + (SELO[l.status] || '') + '<br><a href="' + esc(urlSegura(l.url)) + '" target="_blank" rel="noopener">' + esc(l.url.length > 60 ? l.url.slice(0, 60) + '…' : l.url) + '</a></td>' +
            '<td style="text-align:right;white-space:nowrap"><button class="pi2-btn mini perigo" type="button" data-remover-link="' + esc(l.id) + '">Remover</button></td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="pi2-vazio">Nenhum link extra ainda.</div>';
    var corpo = abrirModal(cabecalho('Links do projeto', '#' + doisDigitos(p.id) + ' — ' + esc(p.title) + '. Toda alteração fica registrada com seu nome e a data.') +
      '<h3 class="pi2-h">Links principais</h3><form class="pi2-form" id="pi2-form-fixos">' + fixos +
      '<div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn primario" type="submit">Salvar links principais</button></div></form>' +
      '<h3 class="pi2-h">Outros links</h3><p class="pi2-modal-sub">Protótipo no ar, planilha de testes, apresentação, pasta de fotos… ' + (ehDocente() ? 'Links incluídos por você entram no ar na hora; os dos alunos esperam a sua aprovação.' : 'O link aparece no card do projeto depois que um professor aprovar.') + '</p>' + lista +
      '<form class="pi2-form" id="pi2-form-extra" style="margin-top:0.8rem"><div class="pi2-row">' +
      '<div class="pi2-field"><label for="pi2-l-nome">Nome do botão</label><input id="pi2-l-nome" name="nome" type="text" maxlength="40" required placeholder="Ex.: Protótipo no ar"></div>' +
      '<div class="pi2-field"><label for="pi2-l-url">Endereço</label><input id="pi2-l-url" name="url" type="url" inputmode="url" required placeholder="https://…"></div></div>' +
      '<div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn" type="button" id="pi2-l-fechar">Fechar</button><button class="pi2-btn primario" type="submit"><i class="fa-solid fa-plus"></i> Adicionar link</button></div></form>');
    $('#pi2-l-fechar', corpo).onclick = fecharModal;
    aoEnviar($('#pi2-form-fixos', corpo), function (fd) {
      var campos = {};
      Object.keys(iniciais).forEach(function (k) { var v = String(fd.get(k) || '').trim(); if (v !== iniciais[k]) campos[k] = v; });
      if (!Object.keys(campos).length) throw new Error('Nenhum link foi alterado.');
      return api('atualizarFicha', { projeto: p.id, campos: campos }).then(function () {
        aviso('Links principais atualizados.');
        return carregar(true).then(function () { PI2.abrirLinks(id, doProjeto); });
      });
    });
    aoEnviar($('#pi2-form-extra', corpo), function (fd) {
      var url = String(fd.get('url') || '').trim();
      if (!/^https:\/\//i.test(url)) throw new Error('O endereço precisa começar com https://');
      return api('salvarLink', { projeto: p.id, nome: fd.get('nome'), url: url }).then(function (r) {
        PI2.links = r.links || PI2.links; aviso(r.pendente ? 'Link enviado. Ele aparece no card depois que o professor aprovar.' : 'Link adicionado.'); redesenhar(); PI2.abrirLinks(id, r.doProjeto);
      });
    });
    $$('[data-remover-link]', corpo).forEach(function (b) {
      b.onclick = function () {
        if (!b.dataset.confirmado) { b.dataset.confirmado = '1'; b.textContent = 'Confirmar remoção'; return; }
        b.disabled = true;
        api('removerLink', { id: b.dataset.removerLink }).then(function (r) {
          PI2.links = r.links || PI2.links; aviso('Link removido.'); redesenhar(); PI2.abrirLinks(id, r.doProjeto);
        }).catch(function (e) { b.disabled = false; aviso(e.message, 'warning'); });
      };
    });
  };

  function complementarCards() {
    $$('.project-card').forEach(function (card) {
      var id = Number(card.id.replace('project-card-', ''));
      var p = projetoBruto(id);
      var parsedObj = p ? (p.objetivosParsed || parseObjetivos(p.objective)) : { geral: '', d1: '', d2: '', d3: '', d4: '', extras: [] };
      var qtdDegraus = ['d1', 'd2', 'd3', 'd4'].filter(function (k) { return !!(parsedObj[k] && String(parsedObj[k]).trim()); }).length;

      var links = $('.proj-links', card);
      if (links && !$('.pi2-registrar', links) && !$('.pi2-link-extra', links)) {
        links.insertAdjacentHTML('beforeend', linksExtrasHtml(id, true) + botoesAcao(id, true) +
          (podeEditar(id) ? '<button type="button" class="link-btn pi2-editar-links" data-pi2-links="' + id + '" title="Corrigir os links deste projeto ou incluir outros"><i class="fa-solid fa-pen"></i> Links</button>' : ''));
      }

      var meta = $('.card-quick-meta', card), ult = ultimoRegistro(id);
      if (meta) {
        if (!$('.pi2-obj-meta', meta)) {
          var corObj = qtdDegraus === 4 ? 'green' : (qtdDegraus > 0 || parsedObj.geral ? 'cyan' : 'amber');
          var txtObj = qtdDegraus > 0 ? ('Objetivos D1–D4: ' + qtdDegraus + '/4') : (parsedObj.geral ? 'Obj. Geral OK (D1–D4 pend.)' : 'Objetivos: Pendentes');
          meta.insertAdjacentHTML('beforeend', '<span class="quick-meta-pill pi2-obj-meta ' + corObj + '"><i class="fa-solid fa-bullseye"></i> ' + esc(txtObj) + '</span>');
        }
        if (CFG.apiUrl && !$('.pi2-recencia', meta)) {
          var dias = ult ? diasDesde(ult.data) : null;
          var parado = dias === null || dias >= (CFG.diasParado || 14);
          meta.insertAdjacentHTML('beforeend', '<span class="quick-meta-pill pi2-recencia ' + (parado ? 'parado' : 'green') + '"><i class="fa-solid fa-clock-rotate-left"></i> ' +
            (ult ? 'Último registro ' + esc(haQuanto(ult.data)) : 'Sem registros') + '</span>');
        }
      }

      // Renderiza no próprio card tanto o Objetivo Geral quanto os 4 Objetivos Específicos (D1 a D4) e desdobramentos
      var objBox = $('.card-obj-box', card);
      if (objBox && p && !$('.pi2-card-degraus', objBox)) {
        var degLabels = [
          { k: 'D1', campo: 'd1', tit: 'Diagnóstico & Requisitos' },
          { k: 'D2', campo: 'd2', tit: 'Modelagem & Design' },
          { k: 'D3', campo: 'd3', tit: 'Implementação & Código' },
          { k: 'D4', campo: 'd4', tit: 'Validação & Testes' }
        ];
        var listaDegHtml = degLabels.map(function (d) {
          var val = String(parsedObj[d.campo] || '').trim();
          var extrasDeg = (parsedObj.extras || []).filter(function (ex) { return ex.degrau === d.k; });
          return '<li style="display:flex;align-items:flex-start;gap:0.45rem;padding:0.35rem 0;border-bottom:1px dashed var(--border-color);font-size:0.8rem;line-height:1.4;">' +
            '<span class="proj-id-badge" style="font-size:0.65rem;padding:0.1rem 0.38rem;flex-shrink:0;margin-top:0.1rem;background:' + (val ? 'rgba(34,197,94,0.18)' : 'rgba(245,158,11,0.15)') + ';color:' + (val ? 'var(--ifsc-green-light)' : 'var(--accent-amber)') + ';">' + d.k + '</span>' +
            '<div style="flex:1;">' +
              (val
                ? '<span style="color:var(--text-main);">' + esc(val) + '</span>'
                : '<span style="color:var(--text-dim);font-style:italic;">' + esc(d.tit) + ' — pendente (preencher em Editar ficha)</span>') +
              (extrasDeg.length ? extrasDeg.map(function (ex) {
                return '<div style="margin-top:0.25rem;padding:0.2rem 0.45rem;background:rgba(6,182,212,0.08);border-left:2px solid var(--accent-cyan);border-radius:4px;font-size:0.76rem;color:var(--text-main);"><i class="fa-solid fa-code-branch" style="color:var(--accent-cyan);"></i> ' + esc(ex.texto) + '</div>';
              }).join('') : '') +
            '</div>' +
          '</li>';
        }).join('');

        objBox.innerHTML =
          '<div style="margin-bottom:0.65rem;">' +
            '<i class="fa-solid fa-bullseye text-cyan"></i> <strong>Objetivo Geral:</strong> ' + esc(parsedObj.geral || 'Definição de escopo em andamento.') +
          '</div>' +
          '<div class="pi2-card-degraus" style="margin-top:0.55rem;padding-top:0.55rem;border-top:1px solid var(--border-color);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;font-size:0.76rem;font-weight:700;color:var(--accent-cyan);text-transform:uppercase;letter-spacing:0.04em;">' +
              '<span><i class="fa-solid fa-stairs"></i> Objetivos Específicos (Degraus D1–D4)</span>' +
              '<span style="color:' + (qtdDegraus === 4 ? 'var(--ifsc-green-light)' : 'var(--accent-amber)') + ';">' + qtdDegraus + '/4 definidos</span>' +
            '</div>' +
            '<ul style="list-style:none;padding:0;margin:0;">' + listaDegHtml + '</ul>' +
          '</div>';
      }

      // Sincroniza registro legado em memória caso a coluna AVANÇOS da planilha tenha sido atualizada
      if (p && p.advances) {
        var regsProj = registrosDo(id);
        if (regsProj.length === 1 && regsProj[0].tipo === 'legado') {
          regsProj[0].texto = p.advances;
        }
      }

      var conteudo = $('.project-collapsible-content', card), rodape = $('.card-expanded-footer', card);
      if (conteudo && rodape && (CFG.apiUrl || registrosDo(id).length)) {
        var sec = document.createElement('div');
        sec.className = 'card-extra-section';
        sec.innerHTML = '<div class="card-extra-title pi2-secao-titulo"><span><i class="fa-solid fa-timeline text-cyan"></i> Linha do tempo</span><span>' + botoesAcao(id, false) + '</span></div>' + timelineHtml(id, 3);
        conteudo.insertBefore(sec, rodape);
        // Só oculta "Avanços Recentes" quando o último registro da linha do tempo já espelha exatamente o texto da planilha.
        if (ult && p && String(ult.texto || '').trim() === String(p.advances || '').trim()) {
          $$('.card-extra-section', conteudo).forEach(function (s) {
            var t = $('.card-extra-title', s);
            if (s !== sec && t && /Avanços Recentes/.test(t.textContent)) s.style.display = 'none';
          });
        }
      }
    });
  }

  function complementarModalProjeto(id) {
    var corpo = $('#modalContent');
    if (!corpo || !$('#projectModal').classList.contains('open')) return;

    // Enriquecimento com caixas separadas para Objetivo Geral e Objetivos Específicos (Degraus D1-D4)
    var p = projetoBruto(id);
    if (p) {
      var rawObj = valorAtual(p, 'objective') || p.objective || '';
      var parsed = parseObjetivos(rawObj);

      // Localiza a seção de objetivo no modal e aprimora com caixas separadas
      var objSec = Array.from($$('div', corpo)).find(function (d) {
        var h4 = $('h4', d);
        return h4 && /Objetivo Geral/i.test(h4.textContent);
      });

      if (objSec) {
        var aval = (PI2.avaliacoes || []).find(function (a) { return Number(a.projeto) === Number(id) && (a.tipo === 'objetivos' || !a.tipo); });
        var crit = (aval && aval.criterios) ? aval.criterios : {};

        function statusBadge(st) {
          if (st === 'conforme') return '<span class="status-tag tag-ok" style="font-size:0.68rem;padding:0.15rem 0.4rem;"><i class="fa-solid fa-check"></i> Conforme</span>';
          if (st === 'ajustar') return '<span class="status-tag tag-ajuste" style="font-size:0.68rem;padding:0.15rem 0.4rem;"><i class="fa-solid fa-triangle-exclamation"></i> Requer Ajustes</span>';
          return '<span class="status-tag tag-pendente" style="font-size:0.68rem;padding:0.15rem 0.4rem;">⏳ A Avaliar</span>';
        }

        var degrausInfo = [
          { k: 'D1', tit: 'D1: Diagnóstico, Requisitos & Estado da Arte', txt: parsed.d1, st: crit.esp1_status, obs: crit.esp1_obs },
          { k: 'D2', tit: 'D2: Modelagem, Arquitetura & Design', txt: parsed.d2, st: crit.esp2_status, obs: crit.esp2_obs },
          { k: 'D3', tit: 'D3: Implementação, Código & Software', txt: parsed.d3, st: crit.esp3_status, obs: crit.esp3_obs },
          { k: 'D4', tit: 'D4: Validação, Testes Experimentais & Métricas', txt: parsed.d4, st: crit.esp4_status, obs: crit.esp4_obs }
        ];

        objSec.innerHTML = `
          <!-- CAIXA SEPARADA 1: OBJETIVO GERAL -->
          <div class="pi2-obj-preview-box" style="margin-bottom:1rem;border-left:4px solid var(--accent-cyan);background:var(--chip-bg);border-radius:8px;padding:0.85rem 1rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
              <h4 style="font-size:0.82rem;text-transform:uppercase;color:var(--accent-cyan);letter-spacing:0.05em;margin:0;display:flex;align-items:center;gap:0.4rem;">
                <i class="fa-solid fa-bullseye"></i> Objetivo Geral do Projeto
              </h4>
              ${statusBadge(crit.geral_status)}
            </div>
            <p style="color:var(--text-main);font-size:0.92rem;line-height:1.55;margin:0;">
              ${esc(parsed.geral || 'Definição de escopo em andamento.')}
            </p>
          </div>

          <!-- CAIXA SEPARADA 2: OBJETIVOS ESPECÍFICOS (4 DEGRAUS METODOLÓGICOS + DESDOBRAMENTOS) -->
          <div style="margin-bottom:1.25rem;background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;padding:1rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
              <h4 style="font-size:0.82rem;text-transform:uppercase;color:var(--ifsc-green-light);letter-spacing:0.05em;margin:0;display:flex;align-items:center;gap:0.4rem;">
                <i class="fa-solid fa-stairs"></i> Objetivos Específicos — 4 Degraus Metodológicos (D1 a D4)
              </h4>
              <span style="font-size:0.72rem;color:var(--text-dim);">Ciclo Pedagógico</span>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.6rem;">
              ${degrausInfo.map(function (d) {
                var extrasDesseDegrau = (parsed.extras || []).filter(function (ex) { return ex.degrau === d.k; });
                return `
                  <div style="background:var(--chip-bg);border:1px solid var(--border-color);border-radius:6px;padding:0.65rem 0.85rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
                      <div style="display:flex;align-items:center;gap:0.4rem;">
                        <span class="proj-id-badge" style="font-size:0.65rem;padding:0.15rem 0.4rem;">${d.k}</span>
                        <strong style="font-size:0.82rem;color:var(--text-main);">${esc(d.tit)}</strong>
                      </div>
                      ${statusBadge(d.st)}
                    </div>
                    <div style="font-size:0.85rem;color:var(--text-muted);line-height:1.45;margin-left:0.2rem;">
                      ${d.txt ? esc(d.txt) : '<em style="color:var(--text-dim);">Etapa metodológica padrão do projeto (a detalhar pela equipe).</em>'}
                    </div>
                    ${d.obs ? `<div style="font-size:0.76rem;color:var(--accent-amber);margin-top:0.3rem;"><i class="fa-solid fa-comment-dots"></i> Devolutiva docente: ${esc(d.obs)}</div>` : ''}
                    
                    ${extrasDesseDegrau.length > 0 ? `
                      <div style="margin-top:0.5rem;padding-top:0.4rem;border-top:1px dashed var(--border-color);display:flex;flex-direction:column;gap:0.35rem;">
                        ${extrasDesseDegrau.map(function (ex) {
                          return `
                            <div style="font-size:0.8rem;background:rgba(6,182,212,0.08);border-left:2px solid var(--accent-cyan);padding:0.35rem 0.6rem;border-radius:4px;color:var(--text-main);">
                              <i class="fa-solid fa-code-branch" style="color:var(--accent-cyan);"></i> <strong>Desdobramento:</strong> ${esc(ex.texto)}
                            </div>
                          `;
                        }).join('')}
                      </div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }
    }

    var antigo = $('#pi2-modal-extra', corpo);
    if (antigo) antigo.remove();
    if (!CFG.apiUrl && !registrosDo(id).length && !linksDo(id).length && !(PI2.demandas || []).length) return;
    var div = document.createElement('div');
    div.id = 'pi2-modal-extra';
    var extras = linksExtrasHtml(id, false);

    var projsDemandas = (PI2.demandas || []).filter(function (d) {
      return d.projeto === '*' || Number(d.projeto) === Number(id);
    });
    var demandasHtml = '';
    if (projsDemandas.length > 0) {
      demandasHtml = '<div style="margin-bottom:1.25rem;background:var(--chip-bg);padding:1rem;border-radius:var(--radius-sm,6px);border:1px solid var(--border-color);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">' +
          '<h4 style="font-size:0.8rem;text-transform:uppercase;color:var(--accent-blue);letter-spacing:0.05em;margin:0;">' +
            '<i class="fa-solid fa-bullhorn"></i> Demandas & Checkpoints Atribuídos (' + projsDemandas.length + ')' +
          '</h4>' +
          (ehDocente() ? '<button class="pi2-btn mini" type="button" data-pi2-demanda="' + id + '" style="font-size:0.72rem;padding:0.2rem 0.5rem;"><i class="fa-solid fa-plus"></i> Nova Demanda</button>' : '') +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:0.5rem;">' +
          projsDemandas.map(function (d) {
            var isDone = d.status === 'concluida';
            var contagem = calcularContadorPrazo(d.prazo, isDone);
            return '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg-card);padding:0.6rem 0.8rem;border-radius:6px;border-left:3px solid ' + (isDone ? 'var(--ifsc-green)' : 'var(--accent-amber)') + ';font-size:0.82rem;gap:0.5rem;flex-wrap:wrap;">' +
              '<div>' +
                '<strong>' + (d.projeto === '*' ? '[Geral] ' : '') + esc(d.titulo) + '</strong>' +
                (d.prazo ? '<span style="color:var(--accent-amber);font-size:0.75rem;margin-left:0.5rem;"><i class="fa-solid fa-calendar-day"></i> ' + esc(d.prazo) + '</span>' : '') +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:0.4rem;">' +
                contagem.html +
                '<span class="status-tag ' + (isDone ? 'tag-ok' : 'tag-pendente') + '" style="font-size:0.7rem;">' + (isDone ? 'Concluída' : 'Pendente') + '</span>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
    }

    div.innerHTML = demandasHtml +
      (extras ? '<h3 class="pi2-h"><i class="fa-solid fa-link text-cyan"></i> Outros links do projeto</h3><div class="pi2-evidencias">' + extras + '</div>' : '') +
      '<h3 class="pi2-h pi2-secao-titulo"><span><i class="fa-solid fa-timeline text-cyan"></i> Linha do tempo de registros</span><span>' + botoesAcao(id, false) + '</span></h3>' + timelineHtml(id, 0);
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
      var deEdicao = k.turma.filter(function (p) { return p.overleafStatus === 'edicao'; });
      var semLink = k.turma.filter(function (p) { return p.overleafStatus === 'pendente'; });
      if (subs[0]) subs[0].textContent = n + ' equipes' + (individuais ? ' + ' + individuais + ' plano individual' : '');
      if (subs[1]) subs[1].textContent = 'Links de leitura públicos';
      if (subs[2]) subs[2].textContent = (privados.length ? 'Link interno: ' + k.ids(privados) : 'Nenhum link interno') + (deEdicao.length ? ' • de edição: ' + k.ids(deEdicao) : '');
      var titulos = $$('.kpi-title', total.closest('.kpi-grid'));
      if (titulos[2]) titulos[2].textContent = 'Links a corrigir';
      var valor = $('#kpi-overleaf-privado');
      if (valor) valor.textContent = (privados.length + deEdicao.length) + ' / ' + k.total;
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
    var lp = d.linksPendentes || [];
    var linhasLinks = lp.map(function (l) {
      return '<tr><td>' + titulo(l.projeto) + '<br><small>' + esc(l.autor) + ' • ' + esc(dataBr(l.data)) + '</small></td>' +
        '<td><strong>' + esc(l.nome) + '</strong><br><a href="' + esc(urlSegura(l.url)) + '" target="_blank" rel="noopener">' + esc(l.url.length > 55 ? l.url.slice(0, 55) + '…' : l.url) + '</a></td>' +
        '<td style="white-space:nowrap"><button class="pi2-btn mini primario" type="button" data-link-ok="' + esc(l.id) + '">Aprovar</button> ' +
        '<button class="pi2-btn mini perigo" type="button" data-link-nao="' + esc(l.id) + '">Recusar</button></td></tr>';
    }).join('');
    desenharAuth();
    var corpo = abrirModal(cabecalho('Painel docente', 'Aprovação de acessos e de links, cadastro de integrantes e histórico de alterações.') +
      '<div style="background:var(--chip-bg);border:1px solid var(--border-color);border-radius:var(--radius-sm, 8px);padding:0.75rem 1rem;margin-bottom:1.25rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;">' +
      '<div><strong style="color:var(--text-main);font-size:0.9rem;"><i class="fa-solid fa-clipboard-list" style="color:var(--accent-amber);"></i> Central Pedagógica & Avaliações</strong>' +
      '<p style="font-size:0.78rem;color:var(--text-muted);margin:0.15rem 0 0 0;">Controle das notas dos 11 projetos e envio de mensagens e metas.</p></div>' +
      '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;">' +
      '<button class="pi2-btn mini primario" style="background:var(--accent-blue);color:#fff;" type="button" onclick="PI2.fecharModal(); PI2.abrirModalCriarDemanda(\'*\');"><i class="fa-solid fa-bullhorn"></i> Nova Demanda / Broadcast</button>' +
      '<button class="pi2-btn mini primario" style="background:var(--accent-amber);color:#fff;" type="button" onclick="PI2.fecharModal(); switchTab(\'notas\');"><i class="fa-solid fa-arrow-up-right-from-square"></i> Acessar Notas</button></div></div>' +
      '<p><button class="pi2-btn mini primario" type="button" id="pi2-painel-notas"><i class="fa-solid fa-clipboard-list"></i> Notas da turma</button> ' +
      '<a class="pi2-btn mini" href="' + esc(urlSegura(d.planilhaControle)) + '" target="_blank" rel="noopener"><i class="fa-solid fa-lock"></i> Planilha de controle (privada)</a> ' +
      '<a class="pi2-btn mini" href="' + esc(urlSegura(d.planilhaPublica)) + '" target="_blank" rel="noopener"><i class="fa-solid fa-table"></i> Planilha de projetos</a></p>' +
      '<h3 class="pi2-h">Solicitações pendentes (' + pend.length + ')</h3>' +
      (pend.length ? '<div class="pi2-table-wrap"><table class="pi2-table"><thead><tr><th>Estudante</th><th>Projeto pedido</th><th></th></tr></thead><tbody>' + linhasPend + '</tbody></table></div>' : '<div class="pi2-vazio">Nenhuma solicitação aguardando.</div>') +
      '<h3 class="pi2-h">Links aguardando aprovação (' + lp.length + ')</h3>' +
      (lp.length ? '<p class="pi2-modal-sub">Abra o endereço para conferir antes de aprovar. Só depois da aprovação o link aparece no card do projeto.</p><div class="pi2-table-wrap"><table class="pi2-table"><thead><tr><th>Projeto</th><th>Link</th><th></th></tr></thead><tbody>' + linhasLinks + '</tbody></table></div>' : '<div class="pi2-vazio">Nenhum link aguardando.</div>') +
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

    var bNotas = $('#pi2-painel-notas', corpo);
    if (bNotas) bNotas.onclick = function () { if (PI2.abrirNotas) PI2.abrirNotas(); };
    $$('[data-link-ok],[data-link-nao]', corpo).forEach(function (b) {
      b.onclick = function () {
        b.disabled = true;
        api('decidirLink', { id: b.dataset.linkOk || b.dataset.linkNao, aprovar: !!b.dataset.linkOk }).then(function (r) {
          if (r.links) PI2.links = r.links;
          aviso(b.dataset.linkOk ? 'Link aprovado: já aparece no card.' : 'Link recusado.'); redesenhar(); desenharPainel(r);
        }).catch(function (e) { b.disabled = false; aviso(e.message, 'warning'); });
      };
    });
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
  function trocarSubAbaNotas(subaba) {
    if (PI2.abrirNotasLegado) PI2.abrirNotasLegado(subaba);
  }

  function renderNotasTab() {
    var container = $('#tab-notas');
    if (!container) return;
    PI2._notasRenderizado = true;

    var projetos = (typeof window.projectsData !== 'undefined' && Array.isArray(window.projectsData) && window.projectsData.length > 0)
      ? window.projectsData
      : ((typeof projectsData !== 'undefined' && Array.isArray(projectsData)) ? projectsData : []);

    var avaliacoes = PI2.avaliacoes || [];
    var isDocente = ehDocente();
    var meuProjetoId = (PI2.usuario && PI2.usuario.projetos && Array.isArray(PI2.usuario.projetos))
      ? (PI2.usuario.projetos[0] !== '*' ? Number(PI2.usuario.projetos[0]) : null)
      : null;

    var totalProjetos = projetos.length;
    var avaliadosCount = 0;
    var aprovadosCount = 0;
    var ajustarCount = 0;
    var somaNotas = 0;
    var countNotasValidas = 0;
    var entregasConformesCount = 0;

    var projsComAval = projetos.map(function (p) {
      var aval = avaliacoes.find(function (a) {
        return Number(a.projeto) === Number(p.id) && (a.tipo === 'objetivos' || !a.tipo);
      });
      var status = aval ? aval.status : 'pendente';
      var nota = aval && aval.nota !== undefined && aval.nota !== '' ? parseFloat(String(aval.nota).replace(',', '.')) : null;

      if (aval) {
        avaliadosCount++;
        if (status === 'aprovado') aprovadosCount++;
        else if (status === 'ajustar') ajustarCount++;
        if (!isNaN(nota) && nota !== null) {
          somaNotas += nota;
          countNotasValidas++;
        }
      }

      var crit = (aval && aval.criterios) ? aval.criterios : {};
      if (crit.artigo_status === 'conforme' || p.overleafStatus === 'ok') entregasConformesCount++;

      return {
        projeto: p,
        avaliacao: aval,
        status: status,
        nota: nota
      };
    });

    var mediaNotas = countNotasValidas > 0 ? (somaNotas / countNotasValidas).toFixed(1).replace('.', ',') : '—';
    var pendentesCount = totalProjetos - avaliadosCount;

    var avaliacaoMeuProjeto = meuProjetoId ? projsComAval.find(function (item) { return Number(item.projeto.id) === meuProjetoId; }) : null;

    container.innerHTML = `
      <div class="pi2-notas-container">
        
        <!-- CABEÇALHO DO PAINEL -->
        <div class="pi2-notas-header">
          <div>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;">
              <span class="proj-id-badge" style="background:rgba(245,158,11,0.15);color:var(--accent-amber);font-weight:700;">
                <i class="fa-solid fa-clipboard-list"></i> CENTRAL PEDAGÓGICA UNIFICADA
              </span>
              <span style="font-size:0.75rem;color:var(--text-dim);">Turma INF-2024 • Semestre 2026-2</span>
            </div>
            <h2 style="font-size:1.35rem;font-weight:700;color:var(--text-main);margin:0;">
              Grade Unificada de Notas & Rubricas Formativas
            </h2>
            <p style="font-size:0.85rem;color:var(--text-muted);margin:0.25rem 0 0 0;">
              Acompanhamento integrado de todos os itens avaliativos da turma (Objetivo Geral, 4 Degraus Metodológicos D1-D4, Entregas Técnicas, Demandas e Avaliação de Pares).
            </p>
          </div>

          <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
            ${isDocente ? `
              <button class="btn btn-outline" onclick="PI2.abrirModalCriarDemanda('*')" style="font-size:0.8rem;padding:0.45rem 0.85rem;color:var(--accent-blue);" title="Criar nova demanda para toda a turma ou equipe">
                <i class="fa-solid fa-bullhorn"></i> Nova Demanda Broadcast
              </button>
              <button class="btn btn-outline" onclick="PI2.abrirNotasLegado('config')" style="font-size:0.8rem;padding:0.45rem 0.85rem;" title="Configurar pesos e fórmulas de fechamento">
                <i class="fa-solid fa-sliders"></i> Pesos & Regras
              </button>
              <button class="btn btn-outline" onclick="PI2.abrirNotasLegado('alunos')" style="font-size:0.8rem;padding:0.45rem 0.85rem;" title="Gerenciar chamada, frequência e lista de estudantes">
                <i class="fa-solid fa-users"></i> Alunos & Frequência
              </button>
            ` : ''}
            <button class="btn btn-outline" onclick="PI2.sincronizar()" style="font-size:0.8rem;padding:0.45rem 0.85rem;" title="Atualizar dados da planilha">
              <i class="fa-solid fa-arrows-rotate"></i> Sincronizar
            </button>
          </div>
        </div>

        <!-- DESTAQUE PARA ESTUDANTE LOGADO -->
        ${(avaliacaoMeuProjeto && !isDocente) ? `
          <div class="pi2-aluno-destaque" style="margin-bottom:1.25rem;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem;margin-bottom:1rem;">
              <div>
                <span class="proj-id-badge" style="background:rgba(37,99,235,0.15);color:var(--accent-blue);font-weight:700;">
                  <i class="fa-solid fa-star"></i> SUA EQUIPE — PROJETO #${avaliacaoMeuProjeto.projeto.id}
                </span>
                <h3 style="font-size:1.2rem;font-weight:700;color:var(--text-main);margin:0.35rem 0 0.15rem 0;">
                  ${esc(avaliacaoMeuProjeto.projeto.title || ('Projeto #' + avaliacaoMeuProjeto.projeto.id))}
                </h3>
                <span style="font-size:0.8rem;color:var(--text-muted);"><i class="fa-solid fa-users" style="color:var(--accent-blue);"></i> ${esc(avaliacaoMeuProjeto.projeto.team || 'Integrantes a definir')}</span>
              </div>
              <div style="display:flex;gap:0.75rem;align-items:center;">
                <div style="text-align:right;">
                  <div style="font-size:0.75rem;color:var(--text-dim);font-weight:600;text-transform:uppercase;">Nota Atual</div>
                  <div class="pi2-nota-val ${avaliacaoMeuProjeto.nota !== null ? (avaliacaoMeuProjeto.nota >= 7 ? 'excelente' : 'ajuste') : ''}" style="font-size:1.4rem;">
                    ${avaliacaoMeuProjeto.nota !== null ? avaliacaoMeuProjeto.nota.toFixed(1).replace('.', ',') : 'Em avaliação'}
                  </div>
                </div>
                <div>
                  <div style="font-size:0.75rem;color:var(--text-dim);font-weight:600;text-transform:uppercase;">Situação Geral</div>
                  <span class="status-tag ${avaliacaoMeuProjeto.status === 'aprovado' ? 'tag-ok' : (avaliacaoMeuProjeto.status === 'ajustar' ? 'tag-ajuste' : 'tag-pendente')}" style="padding:0.4rem 0.75rem;font-size:0.82rem;">
                    ${avaliacaoMeuProjeto.status === 'aprovado' ? '🟢 Conforme' : (avaliacaoMeuProjeto.status === 'ajustar' ? '🟡 Requer Ajustes' : '⚪ Em Elaboração')}
                  </span>
                </div>
              </div>
            </div>

            ${avaliacaoMeuProjeto.avaliacao && avaliacaoMeuProjeto.avaliacao.parecer ? `
              <div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:0.85rem 1.15rem;margin-bottom:0.75rem;">
                <strong style="font-size:0.85rem;color:var(--accent-blue);display:flex;align-items:center;gap:0.35rem;margin-bottom:0.35rem;">
                  <i class="fa-solid fa-comment-dots"></i> Devolutiva do Professor Orientador:
                </strong>
                <p style="font-size:0.88rem;color:var(--text-main);margin:0;line-height:1.5;">${esc(avaliacaoMeuProjeto.avaliacao.parecer)}</p>
              </div>
            ` : ''}

            <!-- 4 Degraus Específicos do Aluno -->
            ${(avaliacaoMeuProjeto.avaliacao && avaliacaoMeuProjeto.avaliacao.criterios) ? `
              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:0.6rem;margin-top:0.75rem;">
                <div style="background:var(--bg-card);padding:0.6rem 0.8rem;border-radius:6px;border:1px solid var(--border-color);font-size:0.78rem;">
                  <strong>D1 (Exploração):</strong> <span class="pi2-deg-badge ${avaliacaoMeuProjeto.avaliacao.criterios.esp1_status || 'ausente'}">${(avaliacaoMeuProjeto.avaliacao.criterios.esp1_status === 'conforme' ? '✔️ Conforme' : (avaliacaoMeuProjeto.avaliacao.criterios.esp1_status === 'ajustar' ? '⚠️ Ajustar' : '❌ Ausente'))}</span>
                  ${avaliacaoMeuProjeto.avaliacao.criterios.esp1_obs ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.25rem;">${esc(avaliacaoMeuProjeto.avaliacao.criterios.esp1_obs)}</div>` : ''}
                </div>
                <div style="background:var(--bg-card);padding:0.6rem 0.8rem;border-radius:6px;border:1px solid var(--border-color);font-size:0.78rem;">
                  <strong>D2 (Modelagem):</strong> <span class="pi2-deg-badge ${avaliacaoMeuProjeto.avaliacao.criterios.esp2_status || 'ausente'}">${(avaliacaoMeuProjeto.avaliacao.criterios.esp2_status === 'conforme' ? '✔️ Conforme' : (avaliacaoMeuProjeto.avaliacao.criterios.esp2_status === 'ajustar' ? '⚠️ Ajustar' : '❌ Ausente'))}</span>
                  ${avaliacaoMeuProjeto.avaliacao.criterios.esp2_obs ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.25rem;">${esc(avaliacaoMeuProjeto.avaliacao.criterios.esp2_obs)}</div>` : ''}
                </div>
                <div style="background:var(--bg-card);padding:0.6rem 0.8rem;border-radius:6px;border:1px solid var(--border-color);font-size:0.78rem;">
                  <strong>D3 (Implementação):</strong> <span class="pi2-deg-badge ${avaliacaoMeuProjeto.avaliacao.criterios.esp3_status || 'ausente'}">${(avaliacaoMeuProjeto.avaliacao.criterios.esp3_status === 'conforme' ? '✔️ Conforme' : (avaliacaoMeuProjeto.avaliacao.criterios.esp3_status === 'ajustar' ? '⚠️ Ajustar' : '❌ Ausente'))}</span>
                  ${avaliacaoMeuProjeto.avaliacao.criterios.esp3_obs ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.25rem;">${esc(avaliacaoMeuProjeto.avaliacao.criterios.esp3_obs)}</div>` : ''}
                </div>
                <div style="background:var(--bg-card);padding:0.6rem 0.8rem;border-radius:6px;border:1px solid var(--border-color);font-size:0.78rem;">
                  <strong>D4 (Validação):</strong> <span class="pi2-deg-badge ${avaliacaoMeuProjeto.avaliacao.criterios.esp4_status || 'ausente'}">${(avaliacaoMeuProjeto.avaliacao.criterios.esp4_status === 'conforme' ? '✔️ Conforme' : (avaliacaoMeuProjeto.avaliacao.criterios.esp4_status === 'ajustar' ? '⚠️ Ajustar' : '❌ Ausente'))}</span>
                  ${avaliacaoMeuProjeto.avaliacao.criterios.esp4_obs ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.25rem;">${esc(avaliacaoMeuProjeto.avaliacao.criterios.esp4_obs)}</div>` : ''}
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- QUADRO DE KPIS CONSOLIDADOS -->
        <div class="pi2-notas-kpi-grid">
          <div class="pi2-kpi-card">
            <span class="pi2-kpi-val">${totalProjetos}</span>
            <span class="pi2-kpi-lbl">Equipes na Turma</span>
          </div>
          <div class="pi2-kpi-card">
            <span class="pi2-kpi-val" style="color:var(--ifsc-green-light);">${aprovadosCount}</span>
            <span class="pi2-kpi-lbl">Objetivos Aprovados</span>
          </div>
          <div class="pi2-kpi-card">
            <span class="pi2-kpi-val" style="color:var(--accent-amber);">${ajustarCount}</span>
            <span class="pi2-kpi-lbl">Requerem Ajustes</span>
          </div>
          <div class="pi2-kpi-card">
            <span class="pi2-kpi-val" style="color:var(--text-dim);">${pendentesCount}</span>
            <span class="pi2-kpi-lbl">Em Elaboração</span>
          </div>
          <div class="pi2-kpi-card">
            <span class="pi2-kpi-val" style="color:var(--accent-blue);">${mediaNotas}</span>
            <span class="pi2-kpi-lbl">Média da Turma</span>
          </div>
        </div>

        <!-- BARRA DE FILTROS E BUSCA -->
        <div class="pi2-notas-toolbar">
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <input type="text" id="pi2-notas-search" class="pi2-search-input" placeholder="🔍 Buscar por projeto ou integrante..." oninput="PI2.filtrarTabelaNotas()" />
            <button class="btn-detail active-filter" id="pi2-filter-btn-todos" onclick="PI2.filtrarNotasPorStatus('todos')" style="font-size:0.75rem;padding:0.35rem 0.65rem;">Todos (${totalProjetos})</button>
            <button class="btn-detail" id="pi2-filter-btn-aprovado" onclick="PI2.filtrarNotasPorStatus('aprovado')" style="font-size:0.75rem;padding:0.35rem 0.65rem;color:var(--ifsc-green-light);">🟢 Conformes (${aprovadosCount})</button>
            <button class="btn-detail" id="pi2-filter-btn-ajustar" onclick="PI2.filtrarNotasPorStatus('ajustar')" style="font-size:0.75rem;padding:0.35rem 0.65rem;color:var(--accent-amber);">🟡 Ajustar (${ajustarCount})</button>
            <button class="btn-detail" id="pi2-filter-btn-pendente" onclick="PI2.filtrarNotasPorStatus('pendente')" style="font-size:0.75rem;padding:0.35rem 0.65rem;color:var(--text-dim);">⚪ Pendentes (${pendentesCount})</button>
          </div>
          ${isDocente ? `
            <div style="font-size:0.8rem;color:var(--accent-purple);font-weight:600;">
              <i class="fa-solid fa-user-shield"></i> Modo Docente Ativo — Clique em <strong>Avaliar</strong> para lançar rubricas, artefatos e avaliação de pares
            </div>
          ` : ''}
        </div>

        <!-- TABELA CONSOLIDADA DAS 11 EQUIPES -->
        <div class="pi2-notas-table-wrapper">
          <table class="pi2-notas-table" id="pi2-tabela-notas">
            <thead>
              <tr>
                <th style="width:40px;">#</th>
                <th style="min-width:180px;">Projeto & Equipe</th>
                <th style="min-width:130px;">Objetivo Geral</th>
                <th style="min-width:180px;">4 Degraus (D1-D4)</th>
                <th style="min-width:190px;">Entregas Técnicas</th>
                <th style="min-width:85px;text-align:center;">Demandas</th>
                <th style="min-width:95px;text-align:center;">Pares</th>
                <th style="min-width:95px;">Status</th>
                <th style="width:65px;text-align:center;">Nota</th>
                <th style="min-width:180px;">Parecer Orientador</th>
                <th style="min-width:110px;text-align:right;">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${projsComAval.map(function (item) {
                var p = item.projeto;
                var pBruto = projetoBruto(p.id) || p;
                var parsedObj = pBruto.objetivosParsed || parseObjetivos(pBruto.objective || '');
                var a = item.avaliacao;
                var nomeProj = p.title || ('Projeto #' + p.id);
                var integrantesProj = p.team || 'Integrantes a definir';
                var crit = a && a.criterios ? a.criterios : {};
                var qtdDegPreenchidos = ['d1', 'd2', 'd3', 'd4'].filter(function (k) { return !!(parsedObj[k] && String(parsedObj[k]).trim()); }).length;
                var temGeral = !!(parsedObj.geral && String(parsedObj.geral).trim());
                var statusClass = item.status === 'aprovado' ? 'tag-ok' : (item.status === 'ajustar' ? 'tag-ajuste' : ((temGeral && qtdDegPreenchidos === 4) ? 'tag-ok' : 'tag-pendente'));
                var statusLabel = item.status === 'aprovado' ? '🟢 Conforme' : (item.status === 'ajustar' ? '🟡 Ajustar' : ((temGeral && qtdDegPreenchidos === 4) ? '📝 Em Análise' : '⚪ Pendente'));
                var notaTxt = item.nota !== null ? item.nota.toFixed(1).replace('.', ',') : '—';
                var notaClass = item.nota !== null ? (item.nota >= 7.0 ? 'excelente' : 'ajuste') : '';

                var demEquipe = (PI2.demandas || []).filter(function (d) { return d.projeto === '*' || Number(d.projeto) === Number(p.id); });
                var concluidas = demEquipe.filter(function (d) { return d.status === 'concluida'; }).length;

                var eqDados = (PI2.notas && typeof PI2.notas.obterDadosEquipe === 'function') ? PI2.notas.obterDadosEquipe(p.id) : null;
                var totalMembros = eqDados && eqDados.membros ? eqDados.membros.length : 0;

                function degBadgeHtml(num, rotulo) {
                  var st = crit['esp' + num + '_status'];
                  var obs = crit['esp' + num + '_obs'];
                  var txt = String(parsedObj['d' + num] || '').trim();
                  if (st) {
                    return '<span class="pi2-deg-badge ' + st + '" title="D' + num + ': ' + rotulo + ' (' + esc(obs || txt || 'Sem obs') + ')">' +
                      'D' + num + ': ' + (st === 'conforme' ? '✔️' : (st === 'ajustar' ? '⚠️' : '❌')) +
                    '</span>';
                  }
                  if (txt) {
                    return '<span class="pi2-deg-badge conforme" style="background:rgba(6,182,212,0.14);color:var(--accent-cyan);border-color:rgba(6,182,212,0.35);" title="D' + num + ' preenchido pela equipe (aguardando avaliação): ' + esc(txt) + '">' +
                      'D' + num + ': 📝' +
                    '</span>';
                  }
                  return '<span class="pi2-deg-badge ausente" title="D' + num + ': ' + rotulo + ' (Ainda não preenchido pela equipe)">' +
                    'D' + num + ': ❌' +
                  '</span>';
                }

                return `
                  <tr class="pi2-nota-row" data-id="${p.id}" data-status="${item.status}" data-nome="${esc(nomeProj).toLowerCase()}" data-integrantes="${esc(integrantesProj).toLowerCase()}">
                    <td>
                      <span class="proj-id-badge" style="font-weight:700;">#${p.id}</span>
                    </td>
                    <td>
                      <strong style="color:var(--text-main);font-size:0.92rem;display:block;margin-bottom:0.2rem;">${esc(nomeProj)}</strong>
                      <div style="font-size:0.75rem;color:var(--text-dim);line-height:1.3;">
                        <i class="fa-solid fa-users" style="color:var(--accent-blue);"></i> ${esc(integrantesProj)}
                      </div>
                    </td>
                    <td>
                      ${crit.geral_status ? `
                        <span class="status-tag ${crit.geral_status === 'conforme' ? 'tag-ok' : 'tag-ajuste'}" style="font-size:0.72rem;">
                          ${crit.geral_status === 'conforme' ? '✔️ Conforme' : '⚠️ Revisar'}
                        </span>
                        <div style="font-size:0.68rem;color:var(--text-dim);margin-top:0.25rem;">
                          ${crit.geral_verbo ? '✓ Verbo ' : ''}${crit.geral_produto ? '✓ Produto ' : ''}${crit.geral_publico ? '✓ Público ' : ''}${crit.geral_proposito ? '✓ Propósito' : ''}
                        </div>
                      ` : (temGeral ? `
                        <span class="status-tag" style="font-size:0.72rem;background:rgba(6,182,212,0.14);color:var(--accent-cyan);border:1px solid rgba(6,182,212,0.35);" title="${esc(parsedObj.geral)}">
                          📝 Cadastrado
                        </span>
                      ` : '<span style="font-size:0.75rem;color:var(--text-dim);">Pendente</span>')}
                    </td>
                    <td>
                      <div style="display:flex;gap:0.25rem;flex-wrap:wrap;">
                        ${degBadgeHtml(1, 'Exploração e Referenciais')}
                        ${degBadgeHtml(2, 'Modelagem, WBS e Wireframe')}
                        ${degBadgeHtml(3, 'Implementação Web e GitHub')}
                        ${degBadgeHtml(4, 'Validação e Testes')}
                      </div>
                    </td>
                    <td>
                      <div class="pi2-pills-row">
                        ${p.overleaf ? `
                          <a href="${esc(urlSegura(p.overleaf))}" target="_blank" rel="noopener" class="pi2-item-badge ${crit.artigo_status || (p.overleafStatus === 'ok' ? 'conforme' : 'ajustar')}" title="Artigo SBC Overleaf: ${esc(crit.artigo_obs || p.overleafStatus || 'Link disponível')}">
                            <i class="fa-solid fa-file-lines"></i> Artigo
                          </a>
                        ` : `<span class="pi2-item-badge ausente" title="Artigo não informado"><i class="fa-solid fa-file-lines"></i> Artigo</span>`}

                        ${p.github ? `
                          <a href="${esc(urlSegura(p.github))}" target="_blank" rel="noopener" class="pi2-item-badge ${crit.github_status || 'conforme'}" title="Código GitHub: ${esc(crit.github_obs || 'Link disponível')}">
                            <i class="fa-brands fa-github"></i> Código
                          </a>
                        ` : `<span class="pi2-item-badge ausente" title="GitHub não informado"><i class="fa-brands fa-github"></i> Código</span>`}

                        ${p.canva ? `
                          <a href="${esc(urlSegura(p.canva))}" target="_blank" rel="noopener" class="pi2-item-badge ${crit.diagrama_status || 'conforme'}" title="Diagrama Canva/Drive: ${esc(crit.diagrama_obs || 'Link disponível')}">
                            <i class="fa-solid fa-project-diagram"></i> Diag
                          </a>
                        ` : `<span class="pi2-item-badge ausente" title="Diagrama não informado"><i class="fa-solid fa-project-diagram"></i> Diag</span>`}

                        ${p.pitch ? `
                          <a href="${esc(urlSegura(p.pitch))}" target="_blank" rel="noopener" class="pi2-item-badge ${crit.pitch_status || 'conforme'}" title="Vídeo Pitch: ${esc(crit.pitch_obs || 'Link disponível')}">
                            <i class="fa-solid fa-video"></i> Pitch
                          </a>
                        ` : `<span class="pi2-item-badge ausente" title="Pitch não informado"><i class="fa-solid fa-video"></i> Pitch</span>`}
                      </div>
                    </td>
                    <td style="text-align:center;">
                      ${demEquipe.length > 0 ? `
                        <span class="status-tag ${concluidas === demEquipe.length ? 'tag-ok' : 'tag-ajuste'}" style="font-size:0.7rem;padding:0.2rem 0.45rem;" title="${concluidas} de ${demEquipe.length} demandas concluídas">
                          <i class="fa-solid fa-bullhorn"></i> ${concluidas}/${demEquipe.length}
                        </span>
                      ` : '<span style="font-size:0.72rem;color:var(--text-dim);">—</span>'}
                    </td>
                    <td style="text-align:center;">
                      ${totalMembros > 0 ? `
                        <span class="pi2-item-badge link" style="font-size:0.7rem;" title="${totalMembros} estudantes com participação acompanhada">
                          <i class="fa-solid fa-user-group"></i> ${totalMembros} alunos
                        </span>
                      ` : '<span style="font-size:0.72rem;color:var(--text-dim);">Fator 1.0</span>'}
                    </td>
                    <td>
                      <span class="status-tag ${statusClass}" style="font-size:0.72rem;">
                        ${statusLabel}
                      </span>
                    </td>
                    <td style="text-align:center;">
                      <span class="pi2-nota-val ${notaClass}">
                        ${notaTxt}
                      </span>
                    </td>
                    <td>
                      <div style="font-size:0.78rem;color:var(--text-muted);max-width:240px;line-height:1.35;" title="${esc(a && a.parecer ? a.parecer : '')}">
                        ${a && a.parecer ? esc(a.parecer.length > 70 ? a.parecer.substring(0, 70) + '...' : a.parecer) : '<span style="color:var(--text-dim);">Sem parecer emitido</span>'}
                      </div>
                    </td>
                    <td style="text-align:right;">
                      <div style="display:flex;gap:0.35rem;justify-content:flex-end;">
                        ${isDocente ? `
                          <button class="btn-action" onclick="PI2.abrirModalAvaliarObjetivos(${p.id})" style="background:var(--accent-amber);color:#fff;font-size:0.72rem;padding:0.3rem 0.55rem;" title="Avaliar rubricas, entregas e pares do Projeto #${p.id}">
                            <i class="fa-solid fa-pen-to-square"></i> Avaliar
                          </button>
                        ` : ''}
                        <button class="btn-detail" onclick="openModal(${p.id})" style="font-size:0.72rem;padding:0.3rem 0.55rem;" title="Abrir ficha do Projeto #${p.id}">
                          <i class="fa-solid fa-eye"></i> Ficha
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

      </div>
    `;
  }

  function filtrarTabelaNotas() {
    var search = ($('#pi2-notas-search') ? $('#pi2-notas-search').value : '').toLowerCase().trim();
    var rows = $$('.pi2-nota-row');
    rows.forEach(function (row) {
      var nome = row.getAttribute('data-nome') || '';
      var intg = row.getAttribute('data-integrantes') || '';
      var id = row.getAttribute('data-id') || '';
      var match = !search || nome.includes(search) || intg.includes(search) || id === search;
      var curHidden = row.getAttribute('data-status-hidden') === 'true';
      if (!match || curHidden) {
        row.style.display = 'none';
      } else {
        row.style.display = '';
      }
    });
  }

  function filtrarNotasPorStatus(status) {
    ['todos', 'aprovado', 'ajustar', 'pendente'].forEach(function (s) {
      var btn = $('#pi2-filter-btn-' + s);
      if (btn) {
        if (s === status) btn.classList.add('active-filter');
        else btn.classList.remove('active-filter');
      }
    });

    var rows = $$('.pi2-nota-row');
    rows.forEach(function (row) {
      var rowStatus = row.getAttribute('data-status');
      if (status === 'todos' || rowStatus === status) {
        row.removeAttribute('data-status-hidden');
      } else {
        row.setAttribute('data-status-hidden', 'true');
      }
    });
    filtrarTabelaNotas();
  }

  function abrirModalAvaliarObjetivos(projId) {
    if (!ehDocente()) {
      aviso('Apenas docentes podem realizar avaliações formais dos projetos.', 'warning');
      return;
    }

    var proj = projetoBruto(projId);
    if (!proj) {
      aviso('Projeto #' + projId + ' não encontrado.', 'warning');
      return;
    }

    var aval = (PI2.avaliacoes || []).find(function (a) {
      return Number(a.projeto) === Number(projId) && (a.tipo === 'objetivos' || !a.tipo);
    });

    var rawObj = valorAtual(proj, 'objective') || proj.objective || '';
    var parsedObj = parseObjetivos(rawObj);

    var crit = Object.assign({
      geral_status: parsedObj.geral ? 'conforme' : 'ausente',
      esp1_status: parsedObj.d1 ? 'conforme' : 'ausente',
      esp2_status: parsedObj.d2 ? 'conforme' : 'ausente',
      esp3_status: parsedObj.d3 ? 'conforme' : 'ausente',
      esp4_status: parsedObj.d4 ? 'conforme' : 'ausente'
    }, (aval && aval.criterios) ? aval.criterios : {});
    var notaAtual = (aval && aval.nota != null && aval.nota !== '') ? String(aval.nota).replace('.', ',') : '';
    var statusAtual = aval ? (aval.status || 'aprovado') : 'aprovado';
    var parecerAtual = aval ? (aval.parecer || '') : '';

    var eqDados = (PI2.notas && typeof PI2.notas.obterDadosEquipe === 'function') ? PI2.notas.obterDadosEquipe(projId) : null;
    var membros = (eqDados && eqDados.membros) ? eqDados.membros : [];

    var demEquipe = (PI2.demandas || []).filter(function (d) { return d.projeto === '*' || Number(d.projeto) === Number(projId); });
    var demConcluidas = demEquipe.filter(function (d) { return d.status === 'concluida'; }).length;

    var html = `
      <div style="margin-bottom:1.25rem;">
        <span class="proj-id-badge" style="background:rgba(245,158,11,0.15);color:var(--accent-amber);font-weight:700;">
          <i class="fa-solid fa-clipboard-check"></i> RUBRICAS PEDAGÓGICAS COMPLETAS
        </span>
        <h2 style="font-size:1.35rem;font-weight:700;margin-top:0.4rem;color:var(--text-main);">
          #${proj.id} ${esc(proj.title)}
        </h2>
        <div style="color:var(--accent-cyan);font-size:0.85rem;"><i class="fa-solid fa-users"></i> ${esc(proj.team)}</div>
      </div>

      <!-- Links diretos para conferência imediata -->
      <div style="background:var(--bg-surface, rgba(241,245,249,0.6));border:1px solid var(--border-color);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.25rem;">
        <div style="font-size:0.78rem;font-weight:700;color:var(--text-main);margin-bottom:0.5rem;display:flex;align-items:center;gap:0.4rem;">
          <i class="fa-solid fa-up-right-from-square" style="color:var(--accent-blue);"></i> Artefatos da Equipe para Inspeção Imediata:
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
          ${proj.overleaf ? `
            <a href="${esc(urlSegura(proj.overleaf))}" target="_blank" rel="noopener" class="pi2-item-badge link" style="padding:0.35rem 0.65rem;font-size:0.8rem;">
              <i class="fa-solid fa-file-lines"></i> Abrir Artigo SBC no Overleaf
            </a>
          ` : `<span class="pi2-item-badge ausente" style="padding:0.35rem 0.65rem;font-size:0.8rem;"><i class="fa-solid fa-file-lines"></i> Artigo Overleaf não cadastrado</span>`}

          ${proj.github ? `
            <a href="${esc(urlSegura(proj.github))}" target="_blank" rel="noopener" class="pi2-item-badge link" style="padding:0.35rem 0.65rem;font-size:0.8rem;">
              <i class="fa-brands fa-github"></i> Repositório GitHub
            </a>
          ` : `<span class="pi2-item-badge ausente" style="padding:0.35rem 0.65rem;font-size:0.8rem;"><i class="fa-brands fa-github"></i> Repositório não cadastrado</span>`}

          ${proj.canva ? `
            <a href="${esc(urlSegura(proj.canva))}" target="_blank" rel="noopener" class="pi2-item-badge link" style="padding:0.35rem 0.65rem;font-size:0.8rem;">
              <i class="fa-solid fa-project-diagram"></i> Diagrama de Arquitetura
            </a>
          ` : `<span class="pi2-item-badge ausente" style="padding:0.35rem 0.65rem;font-size:0.8rem;"><i class="fa-solid fa-project-diagram"></i> Diagrama não cadastrado</span>`}

          ${proj.pitch ? `
            <a href="${esc(urlSegura(proj.pitch))}" target="_blank" rel="noopener" class="pi2-item-badge link" style="padding:0.35rem 0.65rem;font-size:0.8rem;">
              <i class="fa-solid fa-video"></i> Vídeo Pitch
            </a>
          ` : `<span class="pi2-item-badge ausente" style="padding:0.35rem 0.65rem;font-size:0.8rem;"><i class="fa-solid fa-video"></i> Pitch não cadastrado</span>`}
        </div>
      </div>

      <!-- Texto cadastrado pelos estudantes: OBJETIVO GERAL -->
      <div class="pi2-obj-preview-box" style="margin-bottom:1.25rem;">
        <div class="pi2-obj-preview-title">
          <i class="fa-solid fa-bullseye"></i> Redação Atual do Objetivo Geral (Cadastrada pela Equipe)
        </div>
        <div class="pi2-obj-preview-text">${esc(parsedObj.geral || 'Nenhum objetivo geral registrado até o momento.')}</div>
      </div>

      <form id="pi2-form-avaliar-objetivos" class="pi2-modal-form">
        <!-- BLOCO 1: OBJETIVO GERAL -->
        <div class="pi2-rubrica-section">
          <div class="pi2-rubrica-header">
            <h3><i class="fa-solid fa-bullseye" style="color:var(--accent-cyan);"></i> 1. Rubrica do Objetivo Geral</h3>
            <select id="pi2-eval-geral-status" class="pi2-status-select" style="font-weight:700;">
              <option value="conforme" ${crit.geral_status === 'conforme' ? 'selected' : ''}>✔️ Conforme / Aprovado</option>
              <option value="ajustar" ${crit.geral_status === 'ajustar' ? 'selected' : ''}>⚠️ Requer Ajustes</option>
              <option value="ausente" ${crit.geral_status === 'ausente' ? 'selected' : ''}>❌ Não Elaborado / Ausente</option>
            </select>
          </div>
          <p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:0.75rem;">
            Fórmula Roteiro 1: <code>[Verbo de Ação] + [O que será criado] + [Público/Contexto] + [Propósito/Benefício]</code>
          </p>
          <div class="pi2-checklist-grid">
            <label class="pi2-check-item">
              <input type="checkbox" id="crit-geral-verbo" ${crit.geral_verbo ? 'checked' : ''} />
              <span><strong>Verbo no Infinitivo:</strong> Inicia com verbo de ação técnica (Desenvolver, Criar, Implementar...)</span>
            </label>
            <label class="pi2-check-item">
              <input type="checkbox" id="crit-geral-produto" ${crit.geral_produto ? 'checked' : ''} />
              <span><strong>Entregável:</strong> Define claramente o produto de software tangível</span>
            </label>
            <label class="pi2-check-item">
              <input type="checkbox" id="crit-geral-publico" ${crit.geral_publico ? 'checked' : ''} />
              <span><strong>Público/Contexto:</strong> Delimita para quem e em qual ambiente se aplica</span>
            </label>
            <label class="pi2-check-item">
              <input type="checkbox" id="crit-geral-proposito" ${crit.geral_proposito ? 'checked' : ''} />
              <span><strong>Propósito & Impacto:</strong> Deixa claro qual problema real ou necessidade resolve</span>
            </label>
          </div>
        </div>

        <!-- BLOCO 2: OBJETIVOS ESPECÍFICOS (OS 4 DEGRAUS METODOLÓGICOS E DESDOBRAMENTOS) -->
        <div class="pi2-rubrica-section">
          <div class="pi2-rubrica-header">
            <h3><i class="fa-solid fa-stairs" style="color:var(--ifsc-green-light);"></i> 2. Os 4 Degraus Metodológicos (D1 a D4)</h3>
            <span style="font-size:0.75rem;color:var(--text-dim);">Inspeção formativa da redação e entregáveis de cada etapa</span>
          </div>

          <div class="pi2-degraus-container">
            <!-- Degrau 1 -->
            <div class="pi2-degrau-row">
              <div class="pi2-degrau-top">
                <div class="pi2-degrau-tag">
                  <span class="proj-id-badge" style="font-size:0.65rem;padding:0.15rem 0.4rem;">DEGRAU 1</span>
                  <span>Requisitos, Diagnóstico & Trabalhos Relacionados</span>
                </div>
                <select id="crit-esp1-status" class="pi2-status-select">
                  <option value="conforme" ${crit.esp1_status === 'conforme' ? 'selected' : ''}>✔️ Conforme</option>
                  <option value="ajustar" ${crit.esp1_status === 'ajustar' ? 'selected' : ''}>⚠️ Requer Ajustes</option>
                  <option value="ausente" ${crit.esp1_status === 'ausente' ? 'selected' : ''}>❌ Ausente</option>
                </select>
              </div>
              <div class="pi2-degrau-desc">Verbos: <em>Mapear, Identificar, Levantar, Investigar necessidades e analisar o estado da arte.</em></div>
              <div style="font-size:0.8rem;background:var(--chip-bg);border-left:3px solid var(--accent-cyan);padding:0.4rem 0.65rem;border-radius:4px;margin:0.35rem 0;color:var(--text-main);">
                <strong>Redação cadastrada pelos estudantes:</strong> ${parsedObj.d1 ? esc(parsedObj.d1) : '<em style="color:var(--text-dim);">Não redigido ainda</em>'}
              </div>
              ${(parsedObj.extras || []).filter(function (ex) { return ex.degrau === 'D1'; }).map(function (ex) {
                return `<div style="font-size:0.76rem;background:rgba(6,182,212,0.08);border-left:2px solid var(--accent-cyan);padding:0.3rem 0.55rem;border-radius:4px;margin:0.25rem 0;color:var(--text-main);"><i class="fa-solid fa-code-branch" style="color:var(--accent-cyan);"></i> <strong>Desdobramento:</strong> ${esc(ex.texto)}</div>`;
              }).join('')}
              <input type="text" id="crit-esp1-obs" placeholder="Observação/apontamento específico (opcional)" value="${esc(crit.esp1_obs || '')}" style="font-size:0.8rem;padding:0.35rem 0.6rem;margin-top:0.3rem;" />
            </div>

            <!-- Degrau 2 -->
            <div class="pi2-degrau-row">
              <div class="pi2-degrau-top">
                <div class="pi2-degrau-tag">
                  <span class="proj-id-badge" style="font-size:0.65rem;padding:0.15rem 0.4rem;">DEGRAU 2</span>
                  <span>Modelagem & Design (Diagramas / Wireframes)</span>
                </div>
                <select id="crit-esp2-status" class="pi2-status-select">
                  <option value="conforme" ${crit.esp2_status === 'conforme' ? 'selected' : ''}>✔️ Conforme</option>
                  <option value="ajustar" ${crit.esp2_status === 'ajustar' ? 'selected' : ''}>⚠️ Requer Ajustes</option>
                  <option value="ausente" ${crit.esp2_status === 'ausente' ? 'selected' : ''}>❌ Ausente</option>
                </select>
              </div>
              <div class="pi2-degrau-desc">Verbos: <em>Modelar arquitetura no Canva/Draw.io, Prototipar wireframes de interface e fluxos.</em></div>
              <div style="font-size:0.8rem;background:var(--chip-bg);border-left:3px solid var(--accent-cyan);padding:0.4rem 0.65rem;border-radius:4px;margin:0.35rem 0;color:var(--text-main);">
                <strong>Redação cadastrada pelos estudantes:</strong> ${parsedObj.d2 ? esc(parsedObj.d2) : '<em style="color:var(--text-dim);">Não redigido ainda</em>'}
              </div>
              ${(parsedObj.extras || []).filter(function (ex) { return ex.degrau === 'D2'; }).map(function (ex) {
                return `<div style="font-size:0.76rem;background:rgba(6,182,212,0.08);border-left:2px solid var(--accent-cyan);padding:0.3rem 0.55rem;border-radius:4px;margin:0.25rem 0;color:var(--text-main);"><i class="fa-solid fa-code-branch" style="color:var(--accent-cyan);"></i> <strong>Desdobramento:</strong> ${esc(ex.texto)}</div>`;
              }).join('')}
              <input type="text" id="crit-esp2-obs" placeholder="Observação/apontamento específico (opcional)" value="${esc(crit.esp2_obs || '')}" style="font-size:0.8rem;padding:0.35rem 0.6rem;margin-top:0.3rem;" />
            </div>

            <!-- Degrau 3 -->
            <div class="pi2-degrau-row">
              <div class="pi2-degrau-top">
                <div class="pi2-degrau-tag">
                  <span class="proj-id-badge" style="font-size:0.65rem;padding:0.15rem 0.4rem;">DEGRAU 3</span>
                  <span>Implementação & Código (GitHub / Software)</span>
                </div>
                <select id="crit-esp3-status" class="pi2-status-select">
                  <option value="conforme" ${crit.esp3_status === 'conforme' ? 'selected' : ''}>✔️ Conforme</option>
                  <option value="ajustar" ${crit.esp3_status === 'ajustar' ? 'selected' : ''}>⚠️ Requer Ajustes</option>
                  <option value="ausente" ${crit.esp3_status === 'ausente' ? 'selected' : ''}>❌ Ausente</option>
                </select>
              </div>
              <div class="pi2-degrau-desc">Verbos: <em>Desenvolver módulos de software, Versionar no Git/GitHub, Estruturar backend e frontend.</em></div>
              <div style="font-size:0.8rem;background:var(--chip-bg);border-left:3px solid var(--accent-cyan);padding:0.4rem 0.65rem;border-radius:4px;margin:0.35rem 0;color:var(--text-main);">
                <strong>Redação cadastrada pelos estudantes:</strong> ${parsedObj.d3 ? esc(parsedObj.d3) : '<em style="color:var(--text-dim);">Não redigido ainda</em>'}
              </div>
              ${(parsedObj.extras || []).filter(function (ex) { return ex.degrau === 'D3'; }).map(function (ex) {
                return `<div style="font-size:0.76rem;background:rgba(6,182,212,0.08);border-left:2px solid var(--accent-cyan);padding:0.3rem 0.55rem;border-radius:4px;margin:0.25rem 0;color:var(--text-main);"><i class="fa-solid fa-code-branch" style="color:var(--accent-cyan);"></i> <strong>Desdobramento:</strong> ${esc(ex.texto)}</div>`;
              }).join('')}
              <input type="text" id="crit-esp3-obs" placeholder="Observação/apontamento específico (opcional)" value="${esc(crit.esp3_obs || '')}" style="font-size:0.8rem;padding:0.35rem 0.6rem;margin-top:0.3rem;" />
            </div>

            <!-- Degrau 4 -->
            <div class="pi2-degrau-row">
              <div class="pi2-degrau-top">
                <div class="pi2-degrau-tag">
                  <span class="proj-id-badge" style="font-size:0.65rem;padding:0.15rem 0.4rem;">DEGRAU 4</span>
                  <span>Validação & Testes Experimentais</span>
                </div>
                <select id="crit-esp4-status" class="pi2-status-select">
                  <option value="conforme" ${crit.esp4_status === 'conforme' ? 'selected' : ''}>✔️ Conforme</option>
                  <option value="ajustar" ${crit.esp4_status === 'ajustar' ? 'selected' : ''}>⚠️ Requer Ajustes</option>
                  <option value="ausente" ${crit.esp4_status === 'ausente' ? 'selected' : ''}>❌ Ausente</option>
                </select>
              </div>
              <div class="pi2-degrau-desc">Verbos: <em>Validar usabilidade com usuários, Executar bateria de testes controlados, Coletar métricas experimentais.</em></div>
              <div style="font-size:0.8rem;background:var(--chip-bg);border-left:3px solid var(--accent-cyan);padding:0.4rem 0.65rem;border-radius:4px;margin:0.35rem 0;color:var(--text-main);">
                <strong>Redação cadastrada pelos estudantes:</strong> ${parsedObj.d4 ? esc(parsedObj.d4) : '<em style="color:var(--text-dim);">Não redigido ainda</em>'}
              </div>
              ${(parsedObj.extras || []).filter(function (ex) { return ex.degrau === 'D4'; }).map(function (ex) {
                return `<div style="font-size:0.76rem;background:rgba(6,182,212,0.08);border-left:2px solid var(--accent-cyan);padding:0.3rem 0.55rem;border-radius:4px;margin:0.25rem 0;color:var(--text-main);"><i class="fa-solid fa-code-branch" style="color:var(--accent-cyan);"></i> <strong>Desdobramento:</strong> ${esc(ex.texto)}</div>`;
              }).join('')}
              <input type="text" id="crit-esp4-obs" placeholder="Observação/apontamento específico (opcional)" value="${esc(crit.esp4_obs || '')}" style="font-size:0.8rem;padding:0.35rem 0.6rem;margin-top:0.3rem;" />
            </div>
          </div>
        </div>

        <!-- BLOCO 3: ENTREGAS TÉCNICAS & ARTEFATOS -->
        <div class="pi2-rubrica-section">
          <div class="pi2-rubrica-header">
            <h3><i class="fa-solid fa-box-archive" style="color:var(--accent-purple);"></i> 3. Rubricas das Entregas Técnicas & Artefatos</h3>
            <span style="font-size:0.75rem;color:var(--text-dim);">Artigo, repositório, diagrama e pitch</span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:0.75rem;">
            <!-- Artigo SBC Overleaf -->
            <div class="pi2-degrau-row">
              <div class="pi2-degrau-top">
                <div class="pi2-degrau-tag">
                  <i class="fa-solid fa-file-lines" style="color:var(--accent-blue);"></i> <strong>Artigo SBC (Overleaf)</strong>
                </div>
                <select id="crit-artigo-status" class="pi2-status-select">
                  <option value="conforme" ${crit.artigo_status === 'conforme' || (!crit.artigo_status && proj.overleafStatus === 'ok') ? 'selected' : ''}>✔️ Conforme</option>
                  <option value="ajustar" ${crit.artigo_status === 'ajustar' || (!crit.artigo_status && proj.overleafStatus === 'edicao') ? 'selected' : ''}>⚠️ Requer Ajustes</option>
                  <option value="ausente" ${crit.artigo_status === 'ausente' || (!crit.artigo_status && !proj.overleaf) ? 'selected' : ''}>❌ Ausente</option>
                </select>
              </div>
              <input type="text" id="crit-artigo-obs" placeholder="Apontamentos de estrutura do artigo" value="${esc(crit.artigo_obs || '')}" style="font-size:0.8rem;padding:0.35rem 0.6rem;" />
            </div>

            <!-- Código GitHub -->
            <div class="pi2-degrau-row">
              <div class="pi2-degrau-top">
                <div class="pi2-degrau-tag">
                  <i class="fa-brands fa-github" style="color:var(--text-main);"></i> <strong>Código (GitHub)</strong>
                </div>
                <select id="crit-github-status" class="pi2-status-select">
                  <option value="conforme" ${crit.github_status === 'conforme' || (!crit.github_status && proj.github) ? 'selected' : ''}>✔️ Conforme</option>
                  <option value="ajustar" ${crit.github_status === 'ajustar' ? 'selected' : ''}>⚠️ Requer Ajustes</option>
                  <option value="ausente" ${crit.github_status === 'ausente' || (!crit.github_status && !proj.github) ? 'selected' : ''}>❌ Ausente</option>
                </select>
              </div>
              <input type="text" id="crit-github-obs" placeholder="Apontamentos do repositório/commits" value="${esc(crit.github_obs || '')}" style="font-size:0.8rem;padding:0.35rem 0.6rem;" />
            </div>

            <!-- Diagrama / Arquitetura -->
            <div class="pi2-degrau-row">
              <div class="pi2-degrau-top">
                <div class="pi2-degrau-tag">
                  <i class="fa-solid fa-project-diagram" style="color:var(--accent-amber);"></i> <strong>Diagrama de Arquitetura</strong>
                </div>
                <select id="crit-diagrama-status" class="pi2-status-select">
                  <option value="conforme" ${crit.diagrama_status === 'conforme' || (!crit.diagrama_status && proj.canva) ? 'selected' : ''}>✔️ Conforme</option>
                  <option value="ajustar" ${crit.diagrama_status === 'ajustar' ? 'selected' : ''}>⚠️ Requer Ajustes</option>
                  <option value="ausente" ${crit.diagrama_status === 'ausente' || (!crit.diagrama_status && !proj.canva) ? 'selected' : ''}>❌ Ausente</option>
                </select>
              </div>
              <input type="text" id="crit-diagrama-obs" placeholder="Apontamentos do diagrama/WBS" value="${esc(crit.diagrama_obs || '')}" style="font-size:0.8rem;padding:0.35rem 0.6rem;" />
            </div>

            <!-- Vídeo Pitch -->
            <div class="pi2-degrau-row">
              <div class="pi2-degrau-top">
                <div class="pi2-degrau-tag">
                  <i class="fa-solid fa-video" style="color:var(--ifsc-red);"></i> <strong>Vídeo Pitch</strong>
                </div>
                <select id="crit-pitch-status" class="pi2-status-select">
                  <option value="conforme" ${crit.pitch_status === 'conforme' || (!crit.pitch_status && proj.pitch) ? 'selected' : ''}>✔️ Conforme</option>
                  <option value="ajustar" ${crit.pitch_status === 'ajustar' ? 'selected' : ''}>⚠️ Requer Ajustes</option>
                  <option value="ausente" ${crit.pitch_status === 'ausente' || (!crit.pitch_status && !proj.pitch) ? 'selected' : ''}>❌ Ausente</option>
                </select>
              </div>
              <input type="text" id="crit-pitch-obs" placeholder="Apontamentos do vídeo pitch" value="${esc(crit.pitch_obs || '')}" style="font-size:0.8rem;padding:0.35rem 0.6rem;" />
            </div>
          </div>
        </div>

        <!-- BLOCO 4: PARTICIPAÇÃO & AVALIAÇÃO DE PARES -->
        <div class="pi2-rubrica-section">
          <div class="pi2-rubrica-header">
            <h3><i class="fa-solid fa-user-group" style="color:var(--accent-blue);"></i> 4. Participação Individual & Avaliação de Pares</h3>
            <span style="font-size:0.75rem;color:var(--text-dim);">Autoavaliação e nota indicada pelos colegas da equipe</span>
          </div>

          ${membros.length > 0 ? `
            <div class="pi2-table-wrap" style="margin-bottom:0.75rem;">
              <table class="pi2-table" style="font-size:0.8rem;">
                <thead>
                  <tr>
                    <th>Estudante</th>
                    <th style="text-align:center;">Autoavaliação</th>
                    <th style="text-align:center;">Média dos Colegas</th>
                    <th style="width:140px;text-align:center;">Participação (Vale)</th>
                  </tr>
                </thead>
                <tbody>
                  ${membros.map(function (m) {
                    var mediaParesTxt = m.mediaPares !== null && m.mediaPares !== undefined ? Number(m.mediaPares).toFixed(1).replace('.', ',') : '—';
                    var autoTxt = m.auto !== null && m.auto !== undefined ? Number(m.auto).toFixed(1).replace('.', ',') : '—';
                    var valeVal = m.vale !== null && m.vale !== undefined ? m.vale : (m.mediaPares !== null ? String(m.mediaPares).replace('.', ',') : '10,0');

                    return `
                      <tr>
                        <td><strong>${esc(m.nome || m.id)}</strong></td>
                        <td style="text-align:center;">${autoTxt}</td>
                        <td style="text-align:center;"><span class="pi2-item-badge link">${mediaParesTxt}</span></td>
                        <td style="text-align:center;">
                          <input type="number" step="0.1" min="0" max="10" class="pi2-eval-participacao-input" data-aluno-id="${esc(m.id)}" data-media-pares="${mediaParesTxt !== '—' ? mediaParesTxt : '10'}" value="${valeVal}" style="width:80px;text-align:center;font-weight:700;padding:0.25rem 0.4rem;font-size:0.85rem;" />
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
            <div style="display:flex;justify-content:flex-end;">
              <button type="button" class="btn btn-outline" id="pi2-btn-copiar-pares" style="font-size:0.75rem;padding:0.3rem 0.65rem;">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Usar médias indicadas pelos colegas para todos
              </button>
            </div>
          ` : `
            <div style="font-size:0.8rem;color:var(--text-muted);background:var(--bg-card);padding:0.75rem 1rem;border-radius:6px;border:1px solid var(--border-color);">
              <i class="fa-solid fa-circle-info" style="color:var(--accent-blue);"></i> Integrantes desta equipe estão em fase de homologação na planilha de controle. O fator de participação geral está como 1.0 (100%).
            </div>
          `}
        </div>

        <!-- BLOCO 5: NOTA CONSOLIDADA & PARECER ORIENTADOR -->
        <div class="pi2-rubrica-section" style="background:var(--chip-bg);">
          <div style="margin-bottom:0.85rem;display:flex;justify-content:space-between;align-items:center;background:var(--bg-card);padding:0.6rem 0.85rem;border-radius:6px;border:1px dashed var(--accent-amber);">
            <div style="font-size:0.78rem;color:var(--text-muted);">
              <i class="fa-solid fa-calculator" style="color:var(--accent-amber);"></i> Computar tudo (Objetivo Geral + 4 Degraus + Artefatos + Demandas):
            </div>
            <button type="button" class="btn btn-outline" id="pi2-btn-computar-nota-sugerida" style="font-size:0.75rem;padding:0.3rem 0.65rem;color:var(--accent-amber);border-color:var(--accent-amber);">
              <i class="fa-solid fa-wand-magic-sparkles"></i> Sugerir Nota Consolidada
            </button>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.85rem;">
            <div class="pi2-form-group">
              <label>Nota Avaliativa Geral (0,0 a 10,0) *</label>
              <input type="text" id="pi2-eval-nota" required placeholder="Ex: 9,5" value="${esc(notaAtual)}" style="font-size:1.05rem;font-weight:700;" />
            </div>
            <div class="pi2-form-group">
              <label>Parecer Geral de Conformidade *</label>
              <select id="pi2-eval-status" required style="font-weight:700;">
                <option value="aprovado" ${statusAtual === 'aprovado' ? 'selected' : ''}>🟢 Aprovado (Objetivos & Entregas Conformadas)</option>
                <option value="ajustar" ${statusAtual === 'ajustar' ? 'selected' : ''}>🟡 Requer Ajustes (Revisar Redação/Entregas)</option>
                <option value="pendente" ${statusAtual === 'pendente' ? 'selected' : ''}>⚪ Em Elaboração / Pendente</option>
              </select>
            </div>
          </div>

          <div class="pi2-form-group">
            <label>Devolutiva Pedagógica & Parecer Docente (Transparente para os Estudantes)</label>
            <textarea id="pi2-eval-parecer" rows="3" placeholder="Aponte o que o grupo acertou e exatamente o que precisa ser corrigido antes da próxima entrega...">${esc(parecerAtual)}</textarea>
            <span class="pi2-hint" style="font-size:0.75rem;color:var(--text-dim);">A equipe terá acesso a este parecer para orientar as correções necessárias.</span>
          </div>
        </div>

        <div class="pi2-modal-footer">
          <button type="button" class="btn btn-outline" onclick="PI2.fecharModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary" style="background:var(--ifsc-green);color:#fff;" id="pi2-btn-submit-eval">
            <i class="fa-solid fa-floppy-disk"></i> Salvar Avaliação Completa & Rubricas
          </button>
        </div>
      </form>
    `;

    abrirModal(html, true);

    // Botão para computar nota sugerida com base em todas as rubricas e demandas
    var btnComputar = $('#pi2-btn-computar-nota-sugerida');
    if (btnComputar) {
      btnComputar.onclick = function () {
        var pontos = 0;
        // 1. Objetivo Geral (até 1,5 pts)
        var stGeral = $('#pi2-eval-geral-status') ? $('#pi2-eval-geral-status').value : 'ausente';
        if (stGeral === 'conforme') pontos += 1.5;
        else if (stGeral === 'ajustar') pontos += 0.8;

        // 2. Os 4 Degraus Metodológicos (até 4,0 pts = 1,0 cada)
        ['esp1', 'esp2', 'esp3', 'esp4'].forEach(function (k) {
          var el = $('#crit-' + k + '-status');
          var st = el ? el.value : 'ausente';
          if (st === 'conforme') pontos += 1.0;
          else if (st === 'ajustar') pontos += 0.5;
        });

        // 3. Entregas Técnicas de Artefatos (até 3,0 pts = 0,75 cada)
        ['artigo', 'github', 'diagrama', 'pitch'].forEach(function (k) {
          var el = $('#crit-' + k + '-status');
          var st = el ? el.value : 'ausente';
          if (st === 'conforme') pontos += 0.75;
          else if (st === 'ajustar') pontos += 0.35;
        });

        // 4. Demandas & Checkpoints (até 1,5 pts)
        if (demEquipe.length > 0) {
          pontos += (demConcluidas / demEquipe.length) * 1.5;
        } else {
          pontos += 1.5; // sem demandas pendentes no momento
        }

        var notaFinal = Math.min(10.0, Math.max(0.0, pontos)).toFixed(1);
        var notaFormatada = notaFinal.replace('.', ',');
        var notaInput = $('#pi2-eval-nota');
        if (notaInput) notaInput.value = notaFormatada;
        var stSelect = $('#pi2-eval-status');
        if (stSelect) stSelect.value = (Number(notaFinal) >= 7.0) ? 'aprovado' : 'ajustar';
        aviso('Nota consolidada calculada: ' + notaFormatada + ' (Objetivo Geral + 4 Degraus + Artefatos + Demandas).');
      };
    }

    var btnCopiarPares = $('#pi2-btn-copiar-pares');
    if (btnCopiarPares) {
      btnCopiarPares.onclick = function () {
        $$('.pi2-eval-participacao-input').forEach(function (inp) {
          var media = inp.getAttribute('data-media-pares');
          if (media && media !== '—') inp.value = media;
        });
        aviso('Notas de participação preenchidas com as médias atribuídas pelos colegas.');
      };
    }

    var form = $('#pi2-form-avaliar-objetivos');
    if (form) {
      form.onsubmit = function (e) {
        e.preventDefault();
        var btn = $('#pi2-btn-submit-eval');
        btn.disabled = true;
        btn.innerText = 'Salvando avaliação...';

        var participacaoMap = {};
        $$('.pi2-eval-participacao-input').forEach(function (inp) {
          var aId = inp.getAttribute('data-aluno-id');
          if (aId) participacaoMap[aId] = inp.value;
        });

        var criteriosObj = {
          geral_status: $('#pi2-eval-geral-status').value,
          geral_verbo: $('#crit-geral-verbo').checked,
          geral_produto: $('#crit-geral-produto').checked,
          geral_publico: $('#crit-geral-publico').checked,
          geral_proposito: $('#crit-geral-proposito').checked,
          esp1_status: $('#crit-esp1-status').value,
          esp1_obs: $('#crit-esp1-obs').value.trim(),
          esp2_status: $('#crit-esp2-status').value,
          esp2_obs: $('#crit-esp2-obs').value.trim(),
          esp3_status: $('#crit-esp3-status').value,
          esp3_obs: $('#crit-esp3-obs').value.trim(),
          esp4_status: $('#crit-esp4-status').value,
          esp4_obs: $('#crit-esp4-obs').value.trim(),
          artigo_status: $('#crit-artigo-status') ? $('#crit-artigo-status').value : 'conforme',
          artigo_obs: $('#crit-artigo-obs') ? $('#crit-artigo-obs').value.trim() : '',
          github_status: $('#crit-github-status') ? $('#crit-github-status').value : 'conforme',
          github_obs: $('#crit-github-obs') ? $('#crit-github-obs').value.trim() : '',
          diagrama_status: $('#crit-diagrama-status') ? $('#crit-diagrama-status').value : 'conforme',
          diagrama_obs: $('#crit-diagrama-obs') ? $('#crit-diagrama-obs').value.trim() : '',
          pitch_status: $('#crit-pitch-status') ? $('#crit-pitch-status').value : 'conforme',
          pitch_obs: $('#crit-pitch-obs') ? $('#crit-pitch-obs').value.trim() : '',
          participacao: participacaoMap
        };

        var payload = {
          projeto: projId,
          tipo: 'objetivos',
          nota: ($('#pi2-eval-nota').value || '').trim().replace('.', ','),
          status: $('#pi2-eval-status').value,
          criterios: criteriosObj,
          parecer: $('#pi2-eval-parecer').value.trim()
        };

        api('salvarAvaliacao', payload).then(function (res) {
          var idx = (PI2.avaliacoes || []).findIndex(function (a) { return Number(a.projeto) === Number(projId) && (a.tipo === 'objetivos' || !a.tipo); });
          var itemSalvo = {
            id: res.id || ('AV-' + projId + '-OBJETIVOS'),
            projeto: projId,
            tipo: 'objetivos',
            nota: payload.nota,
            status: payload.status,
            criterios: criteriosObj,
            parecer: payload.parecer,
            avaliador: (PI2.usuario && (PI2.usuario.nome || PI2.usuario.email)) || 'Docente'
          };
          if (idx >= 0) {
            PI2.avaliacoes[idx] = Object.assign(PI2.avaliacoes[idx], itemSalvo);
          } else {
            PI2.avaliacoes.push(itemSalvo);
          }

          aviso('Avaliação completa das rubricas salva com sucesso!');
          fecharModal();
          renderNotasTab();
          redesenhar();
        }).catch(function (err) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Avaliação Completa & Rubricas';
          aviso('Erro ao salvar avaliação: ' + (err.message || err), 'warning');
        });
      };
    }
  }

  // ============================ GESTÃO DE DEMANDAS / CHECKPOINTS ============================

  function abrirModalCriarDemanda(projPredefinido) {
    if (!PI2.usuario) return abrirLogin(function () { abrirModalCriarDemanda(projPredefinido); });
    if (!ehDocente()) {
      aviso('Apenas docentes podem criar demandas para os projetos.', 'warning');
      return;
    }

    var projAlvo = projPredefinido != null ? String(projPredefinido) : '*';

    var html = `
      <div style="margin-bottom:1.25rem;">
        <span class="proj-id-badge" style="background:rgba(59,130,246,0.15);color:var(--accent-blue);font-weight:700;">
          <i class="fa-solid fa-bullhorn"></i> ORIENTAÇÃO DOCENTE — PI-2
        </span>
        <h2 style="font-size:1.35rem;font-weight:700;margin-top:0.4rem;color:var(--text-main);">Criar Nova Demanda / Checkpoint</h2>
        <p style="color:var(--text-muted);font-size:0.85rem;">Defina metas específicas por projeto ou dispare para todos os 11 grupos simultaneamente.</p>
      </div>
      <form id="pi2-form-criar-demanda" class="pi2-modal-form">
        <div class="pi2-form-group">
          <label>Escopo da Demanda (Alvo) *</label>
          <select id="pi2-dem-projeto" required>
            <option value="*" ${projAlvo === '*' ? 'selected' : ''}>📣 TODOS OS PROJETOS (Broadcast Geral)</option>
            ${[1,2,3,4,5,6,7,8,9,10,11].map(function(num) {
              var p = (PI2.bruto || []).find(function(item) { return Number(item.id) === Number(num); }) || {};
              var rotulo = 'Projeto #' + doisDigitos(num);
              if (p.title) rotulo += ' — ' + p.title;
              if (p.authors) rotulo += ' (' + p.authors + ')';
              return `<option value="${num}" ${String(projAlvo) === String(num) ? 'selected' : ''}>${esc(rotulo)}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="pi2-form-group">
          <label>Título da Demanda / Meta *</label>
          <input type="text" id="pi2-dem-titulo" required placeholder="Ex: Entrega do Artigo Preliminar no Overleaf (Seção de Resultados)" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          <div class="pi2-form-group">
            <label>Data Limite / Prazo Sugerido</label>
            <input type="date" id="pi2-dem-prazo" />
          </div>
          <div class="pi2-form-group">
            <label>Pontos / Peso Avaliativo</label>
            <input type="text" id="pi2-dem-pontos" placeholder="Ex: 10,0 pts ou Peso 2" />
          </div>
        </div>
        <div class="pi2-form-group">
          <label>Critérios de Aceite & Rubrica Avaliada</label>
          <textarea id="pi2-dem-criterios" rows="2" placeholder="Ex: 1. Redação no template SBC; 2. Figura com 4 passos de discussão; 3. Sem links privados..."></textarea>
        </div>
        <div class="pi2-form-group">
          <label>Orientações Gerais</label>
          <textarea id="pi2-dem-desc" rows="3" placeholder="Descreva os requisitos para conclusão desta meta..."></textarea>
          <span class="pi2-hint" style="font-size:0.75rem;color:var(--text-dim);">Os estudantes cadastrados no escopo receberão uma notificação por e-mail.</span>
        </div>
        <div class="pi2-modal-footer">
          <button type="button" class="btn btn-outline" onclick="PI2.fecharModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary" style="background:var(--accent-blue);color:#fff;" id="pi2-btn-submit-dem">
            <i class="fa-solid fa-paper-plane"></i> Publicar & Notificar
          </button>
        </div>
      </form>
    `;

    abrirModal(html, true);

    var form = $('#pi2-form-criar-demanda');
    if (form) {
      form.onsubmit = function (e) {
        e.preventDefault();
        var btn = $('#pi2-btn-submit-dem');
        btn.disabled = true;
        btn.innerText = 'Disparando demanda e notificando por e-mail...';

        var payload = {
          projeto: $('#pi2-dem-projeto').value,
          titulo: $('#pi2-dem-titulo').value.trim(),
          prazo: $('#pi2-dem-prazo').value,
          pontos: ($('#pi2-dem-pontos') ? $('#pi2-dem-pontos').value.trim() : ''),
          criterios: ($('#pi2-dem-criterios') ? $('#pi2-dem-criterios').value.trim() : ''),
          descricao: $('#pi2-dem-desc').value.trim()
        };

        api('criarDemanda', payload).then(function (res) {
          var novaDem = {
            id: res.id || ('D' + Date.now().toString(36).toUpperCase()),
            data: new Date().toISOString(),
            projeto: payload.projeto,
            titulo: payload.titulo,
            descricao: payload.descricao,
            prazo: payload.prazo,
            criadoPor: (PI2.usuario && (PI2.usuario.nome || PI2.usuario.email)) || 'Docente',
            status: 'pendente',
            concluidaEm: '',
            evidencia: '',
            concluidaPor: '',
            pontos: payload.pontos,
            criterios: payload.criterios
          };
          PI2.demandas = PI2.demandas || [];
          PI2.demandas.unshift(novaDem);
          fecharModal();
          renderDemandasTab();
          redesenhar();

          if (res && res.totalEnviados > 0) {
            aviso('Demanda criada com sucesso e notificação disparada por e-mail para ' + res.totalEnviados + ' estudante(s)!', 'success');
          } else {
            aviso('Demanda cadastrada com sucesso! (Nenhum e-mail disparado: confira os integrantes ativos na aba membros da planilha privada).', 'info');
          }
        }).catch(function (err) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Publicar & Notificar';
          aviso('Erro ao criar demanda: ' + (err.message || err), 'warning');
        });
      };
    }
  }

  function concluirDemanda(demandaId) {
    if (!PI2.usuario) return abrirLogin(function () { concluirDemanda(demandaId); });

    var d = (PI2.demandas || []).find(function (item) { return item.id === demandaId; });
    if (!d) return aviso('Demanda não encontrada.', 'warning');

    if (!ehDocente() && !podeEditar(d.projeto)) {
      return aviso('Você não tem permissão para concluir demandas deste projeto.', 'warning');
    }

    var texto = prompt('Informe uma breve justificativa ou link de evidência da conclusão:');
    if (texto === null) return;

    api('concluirDemanda', { demandaId: demandaId, texto: texto, evidencia: texto }).then(function () {
      d.status = 'concluida';
      d.concluidaEm = new Date().toISOString();
      d.concluidaPor = (PI2.usuario && (PI2.usuario.nome || PI2.usuario.email)) || 'Estudante';
      d.evidencia = texto;
      aviso('Demanda marcada como concluída!');
      renderDemandasTab();
      redesenhar();
    }).catch(function (err) {
      aviso('Erro ao concluir demanda: ' + (err.message || err), 'warning');
    });
  }

  function removerDemanda(demandaId) {
    if (!ehDocente()) return;
    if (!confirm('Deseja realmente remover esta demanda?')) return;

    api('removerDemanda', { demandaId: demandaId }).then(function () {
      PI2.demandas = (PI2.demandas || []).filter(function (d) { return d.id !== demandaId; });
      aviso('Demanda removida.');
      renderDemandasTab();
      redesenhar();
    }).catch(function (err) {
      aviso('Erro ao remover demanda: ' + (err.message || err), 'warning');
    });
  }

  function calcularContadorPrazo(prazoStr, isConcluida) {
    if (isConcluida) {
      return { html: '<span class="pi2-countdown-badge concluida"><i class="fa-solid fa-circle-check"></i> Concluída</span>', status: 'concluida' };
    }
    if (!prazoStr) {
      return { html: '<span class="pi2-countdown-badge sem-prazo"><i class="fa-solid fa-calendar"></i> Sem prazo</span>', status: 'sem-prazo' };
    }

    var d = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(prazoStr)) {
      var partes = prazoStr.split('-');
      d = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]), 23, 59, 59);
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(prazoStr)) {
      var p = prazoStr.split('/');
      d = new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]), 23, 59, 59);
    } else {
      d = new Date(prazoStr);
      if (!isNaN(d.getTime()) && d.getHours() === 0 && d.getMinutes() === 0) {
        d.setHours(23, 59, 59);
      }
    }

    if (!d || isNaN(d.getTime())) {
      return { html: '<span class="pi2-countdown-badge sem-prazo"><i class="fa-solid fa-calendar"></i> ' + esc(prazoStr) + '</span>', status: 'normal' };
    }

    var agora = Date.now();
    var diffMs = d.getTime() - agora;

    if (diffMs <= 0) {
      var diffHorasPassadas = Math.floor(Math.abs(diffMs) / 3600000);
      var diasPassados = Math.floor(diffHorasPassadas / 24);
      var txtVenc = diasPassados > 0 ? (diasPassados + 'd atrás') : (diffHorasPassadas + 'h atrás');
      return {
        html: '<span class="pi2-countdown-badge vencido" title="Prazo expirado em ' + d.toLocaleDateString('pt-BR') + '"><i class="fa-solid fa-triangle-exclamation"></i> Prazo encerrado (' + txtVenc + ')</span>',
        status: 'vencido',
        diffMs: diffMs
      };
    }

    var totalSeg = Math.floor(diffMs / 1000);
    var dias = Math.floor(totalSeg / 86400);
    var horas = Math.floor((totalSeg % 86400) / 3600);
    var minutos = Math.floor((totalSeg % 3600) / 60);

    var txt = '';
    var classe = 'normal';

    if (dias > 1) {
      txt = '⏳ Restam ' + dias + ' dias e ' + horas + 'h';
      classe = 'normal';
    } else if (dias === 1) {
      txt = '⏳ Resta 1 dia e ' + horas + 'h';
      classe = 'normal';
    } else if (horas > 0) {
      txt = '⚡ Restam ' + horas + 'h ' + minutos + 'm';
      classe = 'urgente';
    } else {
      txt = '🔥 Restam ' + minutos + ' minutos!';
      classe = 'critico';
    }

    return {
      html: '<span class="pi2-countdown-badge ' + classe + '" title="Prazo limite: ' + d.toLocaleDateString('pt-BR') + ' às 23:59"><i class="fa-solid fa-stopwatch"></i> ' + txt + '</span>',
      status: classe,
      diffMs: diffMs
    };
  }

  function alterarPrazoDemanda(demandaId) {
    if (!ehDocente()) return;
    var d = (PI2.demandas || []).find(function (item) { return item.id === demandaId; });
    if (!d) return aviso('Demanda não encontrada.', 'warning');

    var dataAtualVal = '';
    if (d.prazo) {
      var dt = new Date(d.prazo);
      if (!isNaN(dt.getTime())) {
        var a = dt.getFullYear();
        var m = String(dt.getMonth() + 1).padStart(2, '0');
        var dia = String(dt.getDate()).padStart(2, '0');
        dataAtualVal = a + '-' + m + '-' + dia;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(d.prazo)) {
        dataAtualVal = d.prazo;
      }
    }

    var html = `
      <div style="padding:1.5rem;max-width:480px;background:var(--bg-card);border-radius:var(--radius-lg,12px);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;border-bottom:1px solid var(--border-color);padding-bottom:0.75rem;">
          <h3 style="margin:0;font-size:1.15rem;color:var(--text-main);display:flex;align-items:center;gap:0.5rem;">
            <i class="fa-solid fa-calendar-days" style="color:var(--accent-blue);"></i> Alterar Prazo da Demanda
          </h3>
          <button type="button" class="btn-fechar" onclick="PI2.fecharModal()" style="background:none;border:none;font-size:1.2rem;color:var(--text-muted);cursor:pointer;">&times;</button>
        </div>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem;">
          <strong style="color:var(--text-main);">${esc(d.titulo)}</strong>
        </p>
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.8rem;font-weight:600;margin-bottom:0.35rem;color:var(--text-main);">Novo Prazo / Data Limite</label>
          <input type="date" id="pi2-alt-novo-prazo" value="${dataAtualVal}" class="form-control" style="width:100%;padding:0.55rem;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);">
        </div>
        <div style="margin-bottom:1rem;">
          <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;color:var(--text-main);cursor:pointer;">
            <input type="checkbox" id="pi2-alt-notificar" checked>
            <span>Notificar estudantes sobre o novo prazo por e-mail</span>
          </label>
        </div>
        <div style="margin-bottom:1.25rem;">
          <label style="display:block;font-size:0.8rem;font-weight:600;margin-bottom:0.35rem;color:var(--text-main);">Mensagem explicativa / Orientação (opcional)</label>
          <textarea id="pi2-alt-msg" class="form-control" rows="2" placeholder="Ex: Prorrogado para que os grupos ajustem os objetivos específicos..." style="width:100%;padding:0.55rem;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);font-size:0.82rem;"></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;">
          <button type="button" class="btn btn-secondary" onclick="PI2.fecharModal()" style="padding:0.45rem 0.85rem;font-size:0.85rem;">Cancelar</button>
          <button type="button" id="pi2-btn-salvar-prazo" class="btn btn-primary" style="background:var(--accent-blue);color:#fff;padding:0.45rem 1rem;font-size:0.85rem;display:inline-flex;align-items:center;gap:0.4rem;">
            <i class="fa-solid fa-save"></i> Atualizar Prazo
          </button>
        </div>
      </div>
    `;

    abrirModal(html);

    var btnSalvar = document.getElementById('pi2-btn-salvar-prazo');
    if (btnSalvar) {
      btnSalvar.onclick = function () {
        var novoPrazo = (document.getElementById('pi2-alt-novo-prazo').value || '').trim();
        if (!novoPrazo) return aviso('Por favor, selecione uma data válida.', 'warning');
        var notificar = document.getElementById('pi2-alt-notificar').checked;
        var msg = (document.getElementById('pi2-alt-msg').value || '').trim();

        btnSalvar.disabled = true;
        btnSalvar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

        api('alterarPrazoDemanda', { demandaId: demandaId, novoPrazo: novoPrazo, notificar: notificar, mensagem: msg }).then(function (res) {
          d.prazo = novoPrazo;
          var avisoTxt = 'Prazo atualizado com sucesso!';
          if (res.totalEnviados > 0) avisoTxt += ' Notificação enviada para ' + res.totalEnviados + ' estudante(s).';
          aviso(avisoTxt, 'success');
          fecharModal();
          renderDemandasTab();
          redesenhar();
        }).catch(function (err) {
          btnSalvar.disabled = false;
          btnSalvar.innerHTML = '<i class="fa-solid fa-save"></i> Atualizar Prazo';
          aviso('Erro ao atualizar prazo: ' + (err.message || err), 'warning');
        });
      };
    }
  }

  function reenviarAlertaDemanda(demandaId) {
    if (!ehDocente()) return;
    var d = (PI2.demandas || []).find(function (item) { return item.id === demandaId; });
    if (!d) return aviso('Demanda não encontrada.', 'warning');

    var escopoTxt = d.projeto === '*' ? 'todos os estudantes da turma' : ('os integrantes do Projeto #' + doisDigitos(d.projeto));
    if (!confirm('Deseja reenviar o alerta/lembrete desta demanda por e-mail para ' + escopoTxt + '?')) return;

    aviso('Disparando lembrete por e-mail...', 'info');
    api('notificarDemanda', { demandaId: demandaId, tipo: 'lembrete' }).then(function (res) {
      aviso('Lembrete enviado com sucesso para ' + (res.totalEnviados || 0) + ' estudante(s)!', 'success');
    }).catch(function (err) {
      aviso('Erro ao enviar lembrete: ' + (err.message || err), 'warning');
    });
  }

  function abrirModalComunicado(demandaId) {
    if (!ehDocente()) return;
    var d = (PI2.demandas || []).find(function (item) { return item.id === demandaId; });
    if (!d) return aviso('Demanda não encontrada.', 'warning');

    var escopoTxt = d.projeto === '*' ? 'Geral (Todos os Projetos)' : ('Projeto #' + doisDigitos(d.projeto));

    var html = `
      <div style="padding:1.5rem;max-width:520px;background:var(--bg-card);border-radius:var(--radius-lg,12px);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;border-bottom:1px solid var(--border-color);padding-bottom:0.75rem;">
          <h3 style="margin:0;font-size:1.15rem;color:var(--text-main);display:flex;align-items:center;gap:0.5rem;">
            <i class="fa-solid fa-bullhorn" style="color:var(--accent-purple, #a855f7);"></i> Enviar Comunicado / Atualização
          </h3>
          <button type="button" class="btn-fechar" onclick="PI2.fecharModal()" style="background:none;border:none;font-size:1.2rem;color:var(--text-muted);cursor:pointer;">&times;</button>
        </div>
        <div style="background:var(--chip-bg);border:1px solid var(--border-color);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.82rem;">
          <div style="font-weight:700;color:var(--text-main);">${esc(d.titulo)}</div>
          <div style="color:var(--text-muted);font-size:0.75rem;margin-top:0.25rem;">
            <span><i class="fa-solid fa-users"></i> Escopo: ${escopoTxt}</span>
            ${d.prazo ? `<span style="margin-left:0.75rem;"><i class="fa-solid fa-calendar"></i> Prazo: ${esc(d.prazo)}</span>` : ''}
          </div>
        </div>
        <div style="margin-bottom:1.25rem;">
          <label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:0.35rem;color:var(--text-main);">Mensagem de Atualização ou Esclarecimento</label>
          <textarea id="pi2-comunicado-msg" class="form-control" rows="4" placeholder="Escreva aqui a mensagem ou esclarecimento para os estudantes..." style="width:100%;padding:0.65rem;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);font-size:0.85rem;line-height:1.45;"></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:0.5rem;">
          <button type="button" class="btn btn-secondary" onclick="PI2.fecharModal()" style="padding:0.45rem 0.85rem;font-size:0.85rem;">Cancelar</button>
          <button type="button" id="pi2-btn-enviar-comunicado" class="btn btn-primary" style="background:linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);color:#fff;padding:0.45rem 1.15rem;font-size:0.85rem;display:inline-flex;align-items:center;gap:0.4rem;border:none;">
            <i class="fa-solid fa-paper-plane"></i> Disparar Comunicado
          </button>
        </div>
      </div>
    `;

    abrirModal(html);

    var btnEnviar = document.getElementById('pi2-btn-enviar-comunicado');
    if (btnEnviar) {
      btnEnviar.onclick = function () {
        var msg = (document.getElementById('pi2-comunicado-msg').value || '').trim();
        if (!msg) return aviso('Por favor, digite a mensagem do comunicado.', 'warning');

        btnEnviar.disabled = true;
        btnEnviar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Disparando...';

        api('notificarDemanda', { demandaId: demandaId, tipo: 'comunicado', mensagem: msg }).then(function (res) {
          aviso('Comunicado enviado com sucesso para ' + (res.totalEnviados || 0) + ' estudante(s)!', 'success');
          fecharModal();
        }).catch(function (err) {
          btnEnviar.disabled = false;
          btnEnviar.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Disparar Comunicado';
          aviso('Erro ao disparar comunicado: ' + (err.message || err), 'warning');
        });
      };
    }
  }

  function renderDemandasTab() {
    var container = document.getElementById('tab-demandas');
    if (!container) return;
    PI2._demandasRenderizado = true;

    var demandas = PI2.demandas || [];
    var isDocente = ehDocente();

    if (demandas.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 3.5rem 1rem; background: var(--bg-card); border-radius: var(--radius-lg, 12px); border: 1px solid var(--border-color); color: var(--text-muted); margin-top: 1rem;">
          <i class="fa-solid fa-list-check" style="font-size: 2.5rem; margin-bottom: 0.75rem; color: var(--text-dim, var(--text-muted));"></i>
          <h3 style="color:var(--text-main);font-size:1.15rem;margin-bottom:0.35rem;">Nenhuma Demanda Ativa no Momento</h3>
          <p style="font-size:0.88rem;max-width:480px;margin:0 auto 1.25rem;">Os professores orientadores podem criar demandas e checkpoints para guiar as entregas e experimentos dos 11 grupos.</p>
          <button class="btn btn-primary" onclick="PI2.abrirModalCriarDemanda('*')" style="background:var(--accent-blue);color:#fff;display:inline-flex;align-items:center;gap:0.4rem;">
            <i class="fa-solid fa-bullhorn"></i> Criar Demanda / Broadcast
          </button>
        </div>
      `;
      return;
    }

    var pendentes = demandas.filter(function (d) { return d.status !== 'concluida'; });
    var concluidas = demandas.filter(function (d) { return d.status === 'concluida'; });

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;">
        <div>
          <h3 style="font-size:1.35rem;font-weight:700;color:var(--text-main);margin-bottom:0.25rem;">
            <i class="fa-solid fa-list-check" style="color:var(--accent-blue);"></i> Demandas & Checkpoints da Turma
          </h3>
          <p style="font-size:0.85rem;color:var(--text-muted);">
            Acompanhamento de metas direcionadas pelos orientadores (${pendentes.length} pendente${pendentes.length !== 1 ? 's' : ''}, ${concluidas.length} concluída${concluidas.length !== 1 ? 's' : ''}).
          </p>
        </div>
        <button class="btn btn-primary" onclick="PI2.abrirModalCriarDemanda('*')" style="background:var(--accent-blue);color:#fff;display:inline-flex;align-items:center;gap:0.4rem;">
          <i class="fa-solid fa-bullhorn"></i> Nova Demanda / Broadcast
        </button>
      </div>

      <div class="pi2-demandas-grid">
        ${demandas.map(function(d) {
          var isBroadcast = d.projeto === '*';
          var isDone = d.status === 'concluida';
          var podeConcluir = PI2.usuario && (isDocente || podeEditar(d.projeto));
          var contagem = calcularContadorPrazo(d.prazo, isDone);

          return `
            <div class="pi2-demanda-card ${isDone ? 'concluida' : ''}">
              <div>
                <div class="pi2-demanda-header">
                  <div style="display:flex;gap:0.35rem;align-items:center;flex-wrap:wrap;">
                    <span class="${isBroadcast ? 'pi2-badge-broadcast' : 'pi2-badge-projeto'}">
                      ${isBroadcast ? '<i class="fa-solid fa-bullhorn"></i> Geral (Turma)' : 'Projeto #' + doisDigitos(d.projeto)}
                    </span>
                    ${d.pontos ? `<span class="proj-id-badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;font-size:0.68rem;border:1px solid rgba(245,158,11,0.3);"><i class="fa-solid fa-star"></i> ${esc(d.pontos)}</span>` : ''}
                  </div>
                  <span class="status-tag ${isDone ? 'tag-ok' : 'tag-pendente'}">
                    ${isDone ? '<i class="fa-solid fa-check"></i> Concluída' : '<i class="fa-solid fa-clock"></i> Pendente'}
                  </span>
                </div>
                <h4 class="pi2-demanda-title">${esc(d.titulo)}</h4>
                <p class="pi2-demanda-desc">${esc(d.descricao || 'Sem descrição adicional.')}</p>
                ${d.criterios ? `
                  <div style="background:var(--chip-bg);border:1px solid var(--border-color);border-radius:6px;padding:0.45rem 0.65rem;margin-bottom:0.75rem;font-size:0.78rem;color:var(--text-muted);">
                    <strong style="color:var(--accent-blue);"><i class="fa-solid fa-list-check"></i> Critérios / Rubrica:</strong> ${esc(d.criterios)}
                  </div>
                ` : ''}
              </div>

              <div>
                <div class="pi2-demanda-meta">
                  <div style="display:flex;flex-direction:column;gap:0.3rem;">
                    <span class="pi2-demanda-prazo">
                      <i class="fa-solid fa-calendar-day"></i> ${d.prazo ? ('Prazo: ' + esc(d.prazo)) : 'Sem data limite'}
                    </span>
                    <div>${contagem.html}</div>
                  </div>
                  <span style="font-size:0.75rem;">Por: ${esc(d.criadoPor)}</span>
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;margin-top:0.75rem;padding-top:0.5rem;border-top:1px solid var(--border-color);">
                  <div style="display:flex;gap:0.3rem;align-items:center;">
                    ${(!isDone && podeConcluir) ? `
                      <button class="btn btn-outline" onclick="PI2.concluirDemanda('${esc(d.id)}')" style="color:var(--ifsc-green);border-color:rgba(34,197,94,0.3);font-size:0.75rem;padding:0.25rem 0.6rem;">
                        <i class="fa-solid fa-check-double"></i> Concluir
                      </button>
                    ` : ''}
                  </div>
                  ${isDocente ? `
                    <div style="display:flex;gap:0.3rem;align-items:center;flex-wrap:wrap;">
                      <button class="btn btn-outline" onclick="PI2.alterarPrazoDemanda('${esc(d.id)}')" style="color:var(--accent-blue);border-color:rgba(59,130,246,0.3);font-size:0.72rem;padding:0.25rem 0.5rem;" title="Alterar prazo / prorrogar meta">
                        <i class="fa-solid fa-calendar-plus"></i> Prazo
                      </button>
                      <button class="btn btn-outline" onclick="PI2.reenviarAlertaDemanda('${esc(d.id)}')" style="color:#f59e0b;border-color:rgba(245,158,11,0.3);font-size:0.72rem;padding:0.25rem 0.5rem;" title="Reenviar alerta por e-mail">
                        <i class="fa-solid fa-bell"></i> Alerta
                      </button>
                      <button class="btn btn-outline" onclick="PI2.abrirModalComunicado('${esc(d.id)}')" style="color:var(--text-main);border-color:var(--border-color);font-size:0.72rem;padding:0.25rem 0.5rem;" title="Enviar comunicado / esclarecimento">
                        <i class="fa-solid fa-bullhorn"></i> Comunicado
                      </button>
                      <button class="btn btn-outline" onclick="PI2.removerDemanda('${esc(d.id)}')" style="color:var(--ifsc-red);border-color:rgba(239,68,68,0.3);font-size:0.72rem;padding:0.25rem 0.5rem;" title="Excluir demanda">
                        <i class="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // Partida
  // ------------------------------------------------------------------
  // Utilitários compartilhados com os outros módulos (pi2-notas.js).
  PI2.interno = { esc: esc, urlSegura: urlSegura, $: $, $$: $$, api: api, aviso: aviso, abrirModal: abrirModal, fecharModal: fecharModal,
    cabecalho: cabecalho, aoEnviar: aoEnviar, ehDocente: ehDocente, doisDigitos: doisDigitos, dataBr: dataBr, haQuanto: haQuanto,
    projetoBruto: projetoBruto, registrosDo: registrosDo, pendente: pendente,
    renderNotasTab: renderNotasTab, abrirModalAvaliarObjetivos: abrirModalAvaliarObjetivos,
    filtrarTabelaNotas: filtrarTabelaNotas, filtrarNotasPorStatus: filtrarNotasPorStatus,
    renderDemandasTab: renderDemandasTab, abrirModalCriarDemanda: abrirModalCriarDemanda,
    concluirDemanda: concluirDemanda, removerDemanda: removerDemanda,
    alterarPrazoDemanda: alterarPrazoDemanda, reenviarAlertaDemanda: reenviarAlertaDemanda,
    abrirModalComunicado: abrirModalComunicado, calcularContadorPrazo: calcularContadorPrazo,
    trocarSubAbaNotas: trocarSubAbaNotas };

  PI2.renderNotasTab = renderNotasTab;
  PI2.trocarSubAbaNotas = trocarSubAbaNotas;
  PI2.abrirModalAvaliarObjetivos = abrirModalAvaliarObjetivos;
  PI2.filtrarTabelaNotas = filtrarTabelaNotas;
  PI2.filtrarNotasPorStatus = filtrarNotasPorStatus;
  PI2.renderDemandasTab = renderDemandasTab;
  PI2.abrirModalCriarDemanda = abrirModalCriarDemanda;
  PI2.concluirDemanda = concluirDemanda;
  PI2.removerDemanda = removerDemanda;
  PI2.alterarPrazoDemanda = alterarPrazoDemanda;
  PI2.reenviarAlertaDemanda = reenviarAlertaDemanda;
  PI2.abrirModalComunicado = abrirModalComunicado;
  PI2.calcularContadorPrazo = calcularContadorPrazo;
  PI2.fecharModal = fecharModal;

  // 1) Escapa imediatamente a cópia salva no HTML, antes do primeiro desenho.
  PI2.bruto = JSON.parse(JSON.stringify(projectsData));
  reescapar();

  // 2) Restaura imediatamente a sessão salva se ainda for válida (evita piscar como desconectado).
  var sessaoSalva = lerSessaoGuardada();
  if (loginConfigurado() && sessaoSalva.token) {
    var pSalvo = lerToken(sessaoSalva.token);
    if (pSalvo && pSalvo.exp * 1000 > Date.now() + 15000) {
      PI2.token = sessaoSalva.token;
      PI2.perfil = pSalvo;
      if (sessaoSalva.usuario) PI2.usuario = sessaoSalva.usuario;
      agendarRenovacao(pSalvo);
    }
  }

  // 3) Acrescenta os complementos a cada redesenho feito pelo código original.
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
    if ($('#tab-notas') && $('#tab-notas').classList.contains('active')) {
      renderNotasTab();
    }
    if ($('#tab-demandas') && $('#tab-demandas').classList.contains('active')) {
      renderDemandasTab();
    }
    if (tokenValido()) {
      api('whoami').then(function (d) {
        if (d.usuario) {
          PI2.usuario = d.usuario;
          guardarSessao(PI2.token, d.usuario);
          desenharAuth();
          redesenhar();
        }
      }).catch(function (e) {
        var msg = String(e && e.message || '');
        if (msg.indexOf('expir') >= 0 || msg.indexOf('inválid') >= 0) {
          sair(true);
        }
      });
    }
    carregar(true);
  });
})();
