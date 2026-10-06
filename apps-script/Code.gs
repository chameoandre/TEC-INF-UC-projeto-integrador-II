/**
 * PI-II (IFSC Garopaba) — backend do dashboard.
 *
 * O dashboard (GitHub Pages) nunca escreve na planilha. Ele envia o pedido para
 * este script junto com o token de login Google do usuário. O script confere o
 * token com o Google, descobre quem é a pessoa, verifica se ela pode mexer
 * naquele projeto e só então grava — registrando autor, data e valor anterior.
 *
 * Implantação: veja apps-script/README-IMPLANTACAO.md
 */

// ============================ CONFIGURAÇÃO ============================
var CONFIG = {
  // Planilha pública exibida pelo dashboard (aba Visao-geral).
  SHEET_ID: '1w7wAwPBdNTfh7lvynoP7x35S__lvRyuTjRqP26oEhNQ',
  ABA_PROJETOS: 'Visao-geral',

  // ID do cliente OAuth criado no Google Cloud (o mesmo do pi2-config.js).
  GOOGLE_CLIENT_ID: '827223670130-f312ur39hg8bamvbce5noc0iaajq8b1a.apps.googleusercontent.com',

  // Docentes: sempre têm acesso total, mesmo antes de existir a aba "membros".
  DOCENTES: [
    'andre.moraes@ifsc.edu.br',
    'karyna.landra@ifsc.edu.br',
    'nauber.gavski@ifsc.edu.br',
    'chameoandre@gmail.com'
  ],

  // Domínios que podem SOLICITAR acesso. Quem já está na aba "membros" como
  // ativo entra independentemente do domínio. Deixe [] para aceitar qualquer conta.
  DOMINIOS_PERMITIDOS: ['ifsc.edu.br', 'aluno.ifsc.edu.br'],

  MAX_TEXTO: 1500,
  MAX_CAMPO: 600,
  MAX_ENVIOS_POR_HORA: 12,
  AVANCOS_NA_PLANILHA: 6   // quantos registros recentes espelhar na coluna AVANÇOS
};

// Colunas da aba Visao-geral (1 = A).
var COL = {
  id: 1, title: 2, team: 3, objective: 4, github: 5, relatorio: 6, canva: 7, pitch: 8,
  relatedWorks: 9, exp1: 10, exp1res: 11, exp2: 12, exp2res: 13, exp3: 14, exp3res: 15,
  exp4: 16, exp4res: 17, paper1: 18, paper2: 19, paper3: 20, paper4: 21,
  advances: 22, nextSteps: 23, difficulties: 24, techs: 25, observations: 26
};
var CAMPOS_ALUNO = ['objective', 'github', 'relatorio', 'canva', 'pitch', 'relatedWorks',
  'exp1', 'exp1res', 'exp2', 'exp2res', 'exp3', 'exp3res', 'exp4', 'exp4res', 'techs'];
var CAMPOS_DOCENTE = CAMPOS_ALUNO.concat(['title', 'team', 'paper1', 'paper2', 'paper3', 'paper4', 'observations']);
var CAMPOS_URL = ['github', 'relatorio', 'canva', 'pitch'];
var TIPOS = ['avanco', 'experimento', 'artigo', 'dificuldade', 'outro'];

var CAB_MEMBROS = ['email', 'nome', 'projetos', 'papel', 'status', 'solicitado_em', 'decidido_por'];
var CAB_REGISTROS = ['id', 'data', 'projeto', 'email', 'autor', 'tipo', 'texto', 'evidencia', 'experimento',
  'proximos_passos', 'dificuldades', 'oculto', 'devolutiva', 'devolutiva_autor', 'devolutiva_data'];
var CAB_ALTERACOES = ['data', 'projeto', 'email', 'autor', 'campo', 'valor_anterior', 'valor_novo'];

// ============================ INSTALAÇÃO ============================

/** Rode UMA vez pelo editor (menu Executar). Cria a planilha privada de controle. */
function instalar() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CONTROLE_ID');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('PI2-2026 — controle de acessos e registros (PRIVADO)');
    props.setProperty('CONTROLE_ID', ss.getId());
  }
  var membros = garantirAba_(ss, 'membros', CAB_MEMBROS);
  garantirAba_(ss, 'registros', CAB_REGISTROS);
  garantirAba_(ss, 'alteracoes', CAB_ALTERACOES);
  var padrao = ss.getSheetByName('Sheet1') || ss.getSheetByName('Página1') || ss.getSheetByName('Planilha1');
  if (padrao && ss.getSheets().length > 1) ss.deleteSheet(padrao);

  if (membros.getLastRow() < 2) {
    var agora = new Date().toISOString();
    CONFIG.DOCENTES.forEach(function (e) {
      membros.appendRow([e, '', '*', 'docente', 'ativo', agora, 'instalação']);
    });
  }
  importarLegado_(ss);
  Logger.log('Planilha de controle pronta: ' + ss.getUrl());
  return ss.getUrl();
}

/** Guarda o texto que já estava na coluna AVANÇOS como registro "legado", para nada se perder. */
function importarLegado_(ss) {
  var reg = ss.getSheetByName('registros');
  if (reg.getLastRow() > 1) return;
  var projetos = lerProjetos_().projetos;
  var linhas = [];
  projetos.forEach(function (p) {
    if (!p.advances) return;
    linhas.push([novoId_(), '', p.id, '', 'Planilha (anterior ao novo sistema)', 'legado',
      seguro_(p.advances), '', '', seguro_(p.nextSteps), seguro_(p.difficulties), '', '', '', '']);
  });
  if (linhas.length) reg.getRange(2, 1, linhas.length, CAB_REGISTROS.length).setValues(linhas);
}

function garantirAba_(ss, nome, cabecalho) {
  var aba = ss.getSheetByName(nome) || ss.insertSheet(nome);
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
    aba.setFrozenRows(1);
  }
  return aba;
}

// ============================ ENTRADAS HTTP ============================

function doGet(e) {
  try {
    return json_(dadosPublicos_());
  } catch (err) {
    return json_({ ok: false, erro: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    var req = JSON.parse((e.postData && e.postData.contents) || '{}');
    var usuario = autenticar_(req.idToken);
    var acoes = {
      whoami: function () { return {}; },
      solicitarAcesso: solicitarAcesso_,
      registrar: registrar_,
      atualizarFicha: atualizarFicha_,
      painel: painel_,
      decidirAcesso: decidirAcesso_,
      salvarMembro: salvarMembro_,
      devolutiva: devolutiva_,
      ocultar: ocultar_,
      notasPainel: estadoNotasDocente_,
      salvarPesos: salvarPesos_,
      salvarQuesito: salvarQuesito_,
      lancarNota: lancarNota_,
      salvarAlunos: salvarAlunos_,
      importarAlunos: importarAlunos_,
      publicarNotas: publicarNotas_,
      minhasNotas: minhasNotas_
    };
    var fn = acoes[req.acao];
    if (!fn) throw new Error('Ação desconhecida.');
    var out = fn(usuario, req) || {};
    out.ok = true;
    out.usuario = publicoUsuario_(usuario);
    return json_(out);
  } catch (err) {
    return json_({ ok: false, erro: String(err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================ AUTENTICAÇÃO ============================

/** Confere o token de login com o Google e devolve {email, nome, papel, projetos, status}. */
function autenticar_(idToken) {
  if (!idToken || typeof idToken !== 'string') throw new Error('Faça login para continuar.');
  var cache = CacheService.getScriptCache();
  var chave = 'tok_' + hash_(idToken);
  var info = null;
  var emCache = cache.get(chave);
  if (emCache) {
    info = JSON.parse(emCache);
  } else {
    var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('Sessão inválida ou expirada. Entre novamente.');
    info = JSON.parse(resp.getContentText());
    if (info.aud !== CONFIG.GOOGLE_CLIENT_ID) throw new Error('Login emitido para outro aplicativo.');
    if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') throw new Error('Emissor de login inválido.');
    if (String(info.email_verified) !== 'true') throw new Error('E-mail da conta Google não verificado.');
    cache.put(chave, JSON.stringify({ email: info.email, name: info.name, exp: info.exp }), 300);
  }
  if (Number(info.exp) * 1000 < Date.now()) throw new Error('Sessão expirada. Entre novamente.');

  var email = String(info.email || '').toLowerCase();
  var usuario = { email: email, nome: info.name || email.split('@')[0], papel: 'visitante', projetos: [], status: 'sem_cadastro' };

  if (CONFIG.DOCENTES.indexOf(email) >= 0) {
    usuario.papel = 'docente'; usuario.status = 'ativo'; usuario.projetos = ['*'];
    return usuario;
  }
  var m = buscarMembro_(email);
  if (m) {
    usuario.status = m.status;
    usuario.pedido = m.projetos;
    if (m.status === 'ativo') {
      usuario.papel = m.papel === 'docente' ? 'docente' : 'aluno';
      usuario.projetos = m.papel === 'docente' ? ['*'] : m.projetos;
    }
  }
  usuario.dominioOk = dominioPermitido_(email);
  return usuario;
}

function publicoUsuario_(u) {
  return { email: u.email, nome: u.nome, papel: u.papel, projetos: u.projetos, status: u.status, pedido: u.pedido || [], dominioOk: u.dominioOk !== false };
}

function dominioPermitido_(email) {
  if (!CONFIG.DOMINIOS_PERMITIDOS.length) return true;
  var dominio = email.split('@')[1] || '';
  return CONFIG.DOMINIOS_PERMITIDOS.indexOf(dominio) >= 0;
}

function podeEditar_(usuario, projetoId) {
  if (usuario.status !== 'ativo') return false;
  if (usuario.papel === 'docente') return true;
  return usuario.projetos.indexOf(Number(projetoId)) >= 0;
}

function exigirDocente_(usuario) {
  if (usuario.papel !== 'docente') throw new Error('Ação restrita aos docentes.');
}

function exigirEdicao_(usuario, projetoId) {
  if (usuario.status === 'pendente') throw new Error('Seu acesso ainda aguarda aprovação de um docente.');
  if (!podeEditar_(usuario, projetoId)) throw new Error('Você não está cadastrado neste projeto.');
}

function limitar_(usuario) {
  var cache = CacheService.getScriptCache();
  var chave = 'rate_' + hash_(usuario.email);
  var n = Number(cache.get(chave) || 0);
  if (n >= CONFIG.MAX_ENVIOS_POR_HORA) throw new Error('Muitos envios em pouco tempo. Tente novamente mais tarde.');
  cache.put(chave, String(n + 1), 3600);
}

// ============================ AÇÕES ============================

function solicitarAcesso_(usuario, req) {
  if (usuario.papel === 'docente') return {};
  if (!usuario.dominioOk) throw new Error('Use sua conta institucional (@' + CONFIG.DOMINIOS_PERMITIDOS.join(' ou @') + ').');
  var projeto = Number(req.projeto);
  if (!linhaDoProjeto_(projeto) && projeto !== 11) throw new Error('Projeto não encontrado.');
  if (usuario.status === 'ativo') throw new Error('Você já tem acesso. Para mudar de grupo, fale com um docente.');
  return comTrava_(function () {
    var aba = controle_().getSheetByName('membros');
    var m = buscarMembro_(usuario.email);
    var linha = [usuario.email, seguro_(usuario.nome), String(projeto), 'aluno', 'pendente', new Date().toISOString(), ''];
    if (m) aba.getRange(m.linha, 1, 1, linha.length).setValues([linha]);
    else aba.appendRow(linha);
    usuario.status = 'pendente'; usuario.pedido = [projeto];
    return {};
  });
}

function registrar_(usuario, req) {
  var projeto = Number(req.projeto);
  exigirEdicao_(usuario, projeto);
  limitar_(usuario);
  var tipo = TIPOS.indexOf(req.tipo) >= 0 ? req.tipo : 'avanco';
  var texto = texto_(req.texto, CONFIG.MAX_TEXTO);
  if (texto.length < 15) throw new Error('Descreva o avanço com um pouco mais de detalhe (mínimo de 15 caracteres).');
  var evidencia = url_(req.evidencia, 'Link de evidência');
  var experimento = Math.max(0, Math.min(4, Number(req.experimento) || 0));
  var proximos = texto_(req.proximosPassos, CONFIG.MAX_CAMPO);
  var dificuldades = texto_(req.dificuldades, CONFIG.MAX_CAMPO);

  return comTrava_(function () {
    var aba = controle_().getSheetByName('registros');
    var id = novoId_();
    aba.appendRow([id, new Date().toISOString(), projeto, usuario.email, seguro_(usuario.nome), tipo,
      seguro_(texto), evidencia, experimento || '', seguro_(proximos), seguro_(dificuldades), '', '', '', '']);
    espelharNaPlanilha_(projeto, proximos, dificuldades);
    return { id: id };
  });
}

/** Mantém as colunas AVANÇOS / PRÓXIMOS PASSOS / DIFICULDADES da planilha pública em dia. */
function espelharNaPlanilha_(projeto, proximos, dificuldades) {
  var linha = linhaDoProjeto_(projeto);
  if (!linha) return;
  var aba = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.ABA_PROJETOS);
  var recentes = lerRegistros_().filter(function (r) { return r.projeto === projeto && !r.oculto && r.tipo !== 'legado'; })
    .slice(0, CONFIG.AVANCOS_NA_PLANILHA)
    .map(function (r) { return '[' + dataCurta_(r.data) + '] ' + r.texto; });
  if (recentes.length) aba.getRange(linha, COL.advances).setValue(seguro_(recentes.join('\n')));
  if (proximos) aba.getRange(linha, COL.nextSteps).setValue(seguro_(proximos));
  if (dificuldades) aba.getRange(linha, COL.difficulties).setValue(seguro_(dificuldades));
}

function atualizarFicha_(usuario, req) {
  var projeto = Number(req.projeto);
  exigirEdicao_(usuario, projeto);
  limitar_(usuario);
  var permitidos = usuario.papel === 'docente' ? CAMPOS_DOCENTE : CAMPOS_ALUNO;
  var campos = req.campos || {};
  return comTrava_(function () {
    var linha = linhaDoProjeto_(projeto);
    if (!linha) throw new Error('Este projeto não tem linha na planilha; fale com um docente.');
    var aba = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.ABA_PROJETOS);
    var atuais = aba.getRange(linha, 1, 1, COL.observations).getDisplayValues()[0];
    var log = [];
    var agora = new Date().toISOString();
    Object.keys(campos).forEach(function (campo) {
      if (permitidos.indexOf(campo) < 0) return;
      var novo = texto_(campos[campo], CONFIG.MAX_TEXTO);
      if (CAMPOS_URL.indexOf(campo) >= 0) novo = url_(novo, campo, true);
      var antigo = String(atuais[COL[campo] - 1] || '').trim();
      if (novo === antigo) return;
      aba.getRange(linha, COL[campo]).setValue(seguro_(novo));
      log.push([agora, projeto, usuario.email, seguro_(usuario.nome), campo, seguro_(antigo), seguro_(novo)]);
    });
    if (log.length) {
      var alt = controle_().getSheetByName('alteracoes');
      alt.getRange(alt.getLastRow() + 1, 1, log.length, CAB_ALTERACOES.length).setValues(log);
    }
    return { alterados: log.length };
  });
}

function painel_(usuario) {
  exigirDocente_(usuario);
  var ss = controle_();
  var membros = lerAba_(ss.getSheetByName('membros')).map(function (m) {
    return { email: m.email, nome: m.nome, projetos: String(m.projetos), papel: m.papel, status: m.status, solicitadoEm: m.solicitado_em };
  });
  var alteracoes = lerAba_(ss.getSheetByName('alteracoes')).slice(-40).reverse().map(function (a) {
    return { data: a.data, projeto: Number(a.projeto), autor: a.autor, campo: a.campo, de: a.valor_anterior, para: a.valor_novo };
  });
  return { membros: membros, alteracoes: alteracoes, planilhaControle: ss.getUrl(),
    planilhaPublica: 'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID };
}

function decidirAcesso_(usuario, req) {
  exigirDocente_(usuario);
  var email = String(req.email || '').toLowerCase();
  return comTrava_(function () {
    var m = buscarMembro_(email);
    if (!m) throw new Error('Solicitação não encontrada.');
    var aba = controle_().getSheetByName('membros');
    aba.getRange(m.linha, 5).setValue(req.aprovar ? 'ativo' : 'recusado');
    aba.getRange(m.linha, 7).setValue(usuario.email);
    return painel_(usuario);
  });
}

function salvarMembro_(usuario, req) {
  exigirDocente_(usuario);
  var email = String(req.email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('E-mail inválido.');
  var papel = req.papel === 'docente' ? 'docente' : 'aluno';
  var projetos = String(req.projetos || '').split(/[,;\s]+/).filter(function (x) { return /^\d+$/.test(x); }).join(',');
  if (papel === 'aluno' && !projetos && req.status !== 'recusado') throw new Error('Informe o número do projeto.');
  var status = ['ativo', 'pendente', 'recusado'].indexOf(req.status) >= 0 ? req.status : 'ativo';
  return comTrava_(function () {
    var aba = controle_().getSheetByName('membros');
    var m = buscarMembro_(email);
    var linha = [email, seguro_(texto_(req.nome, 120)) || (m ? m.nome : ''), papel === 'docente' ? '*' : projetos, papel, status,
      m ? m.solicitadoEm : new Date().toISOString(), usuario.email];
    if (m) aba.getRange(m.linha, 1, 1, linha.length).setValues([linha]);
    else aba.appendRow(linha);
    return painel_(usuario);
  });
}

function devolutiva_(usuario, req) {
  exigirDocente_(usuario);
  var texto = texto_(req.texto, CONFIG.MAX_CAMPO);
  return comTrava_(function () {
    var aba = controle_().getSheetByName('registros');
    var linha = linhaDoRegistro_(aba, req.id);
    aba.getRange(linha, 13, 1, 3).setValues([[seguro_(texto), texto ? seguro_(usuario.nome) : '', texto ? new Date().toISOString() : '']]);
    return {};
  });
}

function ocultar_(usuario, req) {
  exigirDocente_(usuario);
  return comTrava_(function () {
    var aba = controle_().getSheetByName('registros');
    var linha = linhaDoRegistro_(aba, req.id);
    aba.getRange(linha, 12).setValue(req.oculto ? 'sim' : '');
    var projeto = Number(aba.getRange(linha, 3).getValue());
    espelharNaPlanilha_(projeto, '', '');
    return {};
  });
}

// ============================ LEITURA ============================

function dadosPublicos_() {
  var lidos = lerProjetos_();
  var registros = [];
  if (PropertiesService.getScriptProperties().getProperty('CONTROLE_ID')) {
    registros = lerRegistros_().filter(function (r) { return !r.oculto; }).map(function (r) {
      return { id: r.id, data: r.data, projeto: r.projeto, autor: nomeCurto_(r.autor), tipo: r.tipo, texto: r.texto,
        evidencia: r.evidencia, experimento: r.experimento, proximosPassos: r.proximos, dificuldades: r.dificuldades,
        devolutiva: r.devolutiva ? { texto: r.devolutiva, autor: nomeCurto_(r.devolutivaAutor), data: r.devolutivaData } : null };
    });
  }
  return { ok: true, geradoEm: new Date().toISOString(), projetos: lidos.projetos, registros: registros };
}

function lerProjetos_() {
  var aba = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.ABA_PROJETOS);
  var linhas = aba.getDataRange().getDisplayValues();
  return { projetos: linhasParaProjetos(linhas) };
}

function linhaDoProjeto_(projeto) {
  var aba = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.ABA_PROJETOS);
  var ids = aba.getRange(1, 1, aba.getLastRow(), 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) {
    if (/^\d+$/.test(ids[i][0].trim()) && Number(ids[i][0]) === Number(projeto)) return i + 1;
  }
  return 0;
}

/** Registros do mais novo para o mais antigo. */
function lerRegistros_() {
  var linhas = lerAba_(controle_().getSheetByName('registros'));
  var out = linhas.map(function (r) {
    return { id: String(r.id), data: String(r.data || ''), projeto: Number(r.projeto), email: r.email, autor: String(r.autor || ''),
      tipo: String(r.tipo || 'avanco'), texto: String(r.texto || ''), evidencia: String(r.evidencia || ''),
      experimento: Number(r.experimento) || 0, proximos: String(r.proximos_passos || ''), dificuldades: String(r.dificuldades || ''),
      oculto: String(r.oculto || '') !== '', devolutiva: String(r.devolutiva || ''), devolutivaAutor: String(r.devolutiva_autor || ''),
      devolutivaData: String(r.devolutiva_data || '') };
  });
  out.sort(function (a, b) { return a.data < b.data ? 1 : (a.data > b.data ? -1 : 0); });
  return out;
}

function buscarMembro_(email) {
  if (!PropertiesService.getScriptProperties().getProperty('CONTROLE_ID')) return null;
  var linhas = lerAba_(controle_().getSheetByName('membros'));
  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i].email).toLowerCase().trim() === email) {
      return { linha: i + 2, nome: linhas[i].nome, papel: String(linhas[i].papel).trim(), status: String(linhas[i].status).trim(),
        solicitadoEm: linhas[i].solicitado_em,
        projetos: String(linhas[i].projetos).split(/[,;\s]+/).filter(function (x) { return /^\d+$/.test(x); }).map(Number) };
    }
  }
  return null;
}

function linhaDoRegistro_(aba, id) {
  var ids = aba.getRange(1, 1, Math.max(aba.getLastRow(), 1), 1).getDisplayValues();
  for (var i = 1; i < ids.length; i++) if (ids[i][0] === String(id)) return i + 1;
  throw new Error('Registro não encontrado.');
}

function lerAba_(aba) {
  if (aba.getLastRow() < 2) return [];
  var v = aba.getDataRange().getDisplayValues();
  var cab = v[0];
  return v.slice(1).map(function (linha) {
    var o = {};
    cab.forEach(function (c, i) { o[c] = linha[i]; });
    return o;
  });
}

function controle_() {
  var id = PropertiesService.getScriptProperties().getProperty('CONTROLE_ID');
  if (!id) throw new Error('Backend ainda não instalado: rode a função instalar() no editor do Apps Script.');
  return SpreadsheetApp.openById(id);
}

// ============================ UTILITÁRIOS ============================

function comTrava_(fn) {
  var trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try { return fn(); } finally { trava.releaseLock(); }
}

function texto_(v, max) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

/** Impede que um texto seja interpretado como fórmula pela planilha. */
function seguro_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function url_(v, rotulo, aceitaPendente) {
  var s = texto_(v, 500);
  if (!s) return '';
  if (aceitaPendente && s.toUpperCase() === 'PENDENTE') return 'PENDENTE';
  if (!/^https:\/\/[^\s<>"']+$/i.test(s)) throw new Error(rotulo + ': informe um endereço completo começando com https://');
  if (/overleaf\.com\/project\//i.test(s)) throw new Error(rotulo + ': este é o link interno do Overleaf. Use Share → "Turn on link sharing" e cole o link de leitura (…/read/…).');
  return s;
}

function nomeCurto_(nome) {
  var partes = String(nome || '').trim().split(/\s+/);
  if (partes.length < 2 || /\(/.test(nome)) return String(nome || '');
  return partes[0] + ' ' + partes[partes.length - 1].charAt(0) + '.';
}

function dataCurta_(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return '';
  return Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM');
}

function novoId_() { return Utilities.getUuid().slice(0, 13); }

function hash_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)).slice(0, 40);
}

// ====================================================================
// NOTAS — quesitos, alunos, lançamentos, pesos, publicação e nota final.
// Tudo fica na planilha de controle (privada). Nada daqui sai no GET público.
//
// Nota final do aluno = média ponderada de quatro componentes:
//   Entregas      média ponderada dos quesitos (nota do grupo, ou do aluno se o quesito for individual)
//   Participação  0 a 10, por aluno
//   Frequência    percentual de presença / 10, por aluno
//   Pontualidade  10 × (entregas no prazo ÷ entregas com situação marcada), pelo grupo
// Componente ainda sem dado fica fora da conta e a nota aparece como "parcial".
// ====================================================================

var CAB_QUESITOS = ['id', 'nome', 'peso', 'prazo', 'escopo', 'publicado', 'ativo'];
var CAB_ALUNOS = ['id', 'nome', 'projeto', 'email', 'participacao', 'frequencia', 'ativo'];
var CAB_NOTAS = ['quesito', 'alvo', 'nota', 'situacao', 'comentario', 'docente', 'data'];
var CAB_CONFIG = ['chave', 'valor'];
var CAB_NOTAS_HIST = ['data', 'docente', 'item', 'alvo', 'de', 'para'];
var COMPONENTES = ['entregas', 'participacao', 'frequencia', 'pontualidade'];
var PESOS_PADRAO = { entregas: 60, participacao: 15, frequencia: 10, pontualidade: 15 };
var SITUACOES = ['', 'no_prazo', 'atrasado', 'nao_entregue'];
var QUESITOS_INICIAIS = ['Submissão SNCT (FEPE)', 'Paper SEPEI', 'Trabalhos relacionados',
  'Experimentos (4 definidos e com resultados)', 'Pitch em vídeo', 'Diagrama do projeto', 'Submissão COTB'];

/** Abre (ou cria) uma aba de notas. As células são texto puro, para a planilha não reformatar números e datas. */
function abaNotas_(nome, cabecalho) {
  var ss = controle_();
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.getRange(1, 1, aba.getMaxRows(), cabecalho.length).setNumberFormat('@');
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
    aba.setFrozenRows(1);
  }
  return aba;
}

/** Converte "7,5" ou "7.5" em número; vazio ou inválido vira null. */
function num_(v) {
  var s = String(v == null ? '' : v).trim().replace(',', '.');
  if (s === '') return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

function lerConfigNotas_() {
  var linhas = lerAba_(abaNotas_('config', CAB_CONFIG));
  var cfg = {};
  linhas.forEach(function (l) { cfg[l.chave] = l.valor; });
  var pesos = {};
  COMPONENTES.forEach(function (c) {
    var v = num_(cfg['peso_' + c]);
    pesos[c] = v === null ? PESOS_PADRAO[c] : v;
  });
  return { pesos: pesos, finalPublicado: cfg.final_publicado === 'sim', semeado: cfg.quesitos_semeados === 'sim' };
}

function gravarConfig_(chave, valor) {
  var aba = abaNotas_('config', CAB_CONFIG);
  var linhas = lerAba_(aba);
  for (var i = 0; i < linhas.length; i++) {
    if (linhas[i].chave === chave) { aba.getRange(i + 2, 2).setValue(String(valor)); return; }
  }
  aba.appendRow([chave, String(valor)]);
}

function lerEstadoNotas_() {
  var cfg = lerConfigNotas_();
  var abaQ = abaNotas_('quesitos', CAB_QUESITOS);
  if (!cfg.semeado) {
    if (abaQ.getLastRow() < 2) {
      QUESITOS_INICIAIS.forEach(function (nome, i) { abaQ.appendRow(['q' + (i + 1), nome, '1', '', 'grupo', '', 'sim']); });
    }
    gravarConfig_('quesitos_semeados', 'sim');
  }
  var quesitos = lerAba_(abaQ).map(function (q, i) {
    return { linha: i + 2, id: String(q.id), nome: String(q.nome), peso: num_(q.peso) || 0, prazo: String(q.prazo || ''),
      escopo: q.escopo === 'individual' ? 'individual' : 'grupo', publicado: q.publicado === 'sim', ativo: q.ativo !== 'nao' };
  });
  var alunos = lerAba_(abaNotas_('alunos', CAB_ALUNOS)).map(function (a, i) {
    return { linha: i + 2, id: String(a.id), nome: String(a.nome), projeto: Number(a.projeto) || 0, email: String(a.email || '').toLowerCase().trim(),
      participacao: num_(a.participacao), frequencia: num_(a.frequencia), ativo: a.ativo !== 'nao' };
  });
  var notas = {};
  lerAba_(abaNotas_('notas', CAB_NOTAS)).forEach(function (n, i) {
    notas[n.quesito + '|' + n.alvo] = { linha: i + 2, quesito: String(n.quesito), alvo: String(n.alvo), nota: num_(n.nota),
      situacao: SITUACOES.indexOf(n.situacao) >= 0 ? n.situacao : '', comentario: String(n.comentario || ''),
      docente: String(n.docente || ''), data: String(n.data || '') };
  });
  return { pesos: cfg.pesos, finalPublicado: cfg.finalPublicado, quesitos: quesitos, alunos: alunos, notas: notas };
}

/** Nota efetiva de um lançamento: "não entregue" sem nota digitada vale zero. */
function notaEfetiva_(l) {
  if (!l) return null;
  if (l.nota !== null) return l.nota;
  return l.situacao === 'nao_entregue' ? 0 : null;
}

function arred_(n) { return n === null ? null : Math.round((n + 1e-9) * 100) / 100; }

/** Calcula os quatro componentes e a nota final de um aluno. `soPublicados` restringe aos quesitos publicados. */
function calcularAluno_(estado, aluno, soPublicados) {
  var somaPeso = 0, somaNota = 0, avaliados = 0, total = 0, comSituacao = 0, noPrazo = 0;
  estado.quesitos.forEach(function (q) {
    if (!q.ativo || q.peso <= 0) return;
    if (soPublicados && !q.publicado) return;
    total++;
    var alvo = q.escopo === 'individual' ? 'A' + aluno.id : 'P' + aluno.projeto;
    var l = estado.notas[q.id + '|' + alvo];
    var n = notaEfetiva_(l);
    if (n !== null) { somaPeso += q.peso; somaNota += q.peso * n; avaliados++; }
    if (l && l.situacao) { comSituacao++; if (l.situacao === 'no_prazo') noPrazo++; }
  });
  var comp = {
    entregas: somaPeso > 0 ? somaNota / somaPeso : null,
    participacao: aluno.participacao,
    frequencia: aluno.frequencia === null ? null : Math.max(0, Math.min(100, aluno.frequencia)) / 10,
    pontualidade: comSituacao > 0 ? 10 * noPrazo / comSituacao : null
  };
  var pesoUsado = 0, soma = 0, faltando = [];
  COMPONENTES.forEach(function (c) {
    if (estado.pesos[c] <= 0) return;
    if (comp[c] === null) { faltando.push(c); return; }
    pesoUsado += estado.pesos[c]; soma += estado.pesos[c] * comp[c];
  });
  return {
    id: aluno.id, nome: aluno.nome, projeto: aluno.projeto,
    entregas: arred_(comp.entregas), participacao: arred_(comp.participacao), frequencia: arred_(comp.frequencia),
    pontualidade: arred_(comp.pontualidade), final: pesoUsado > 0 ? arred_(soma / pesoUsado) : null,
    quesitosAvaliados: avaliados, quesitosTotal: total, faltando: faltando,
    parcial: faltando.length > 0 || avaliados < total
  };
}

/** Estado completo para o painel docente. */
function estadoNotasDocente_(usuario) {
  exigirDocente_(usuario);
  var e = lerEstadoNotas_();
  var membros = lerAba_(controle_().getSheetByName('membros')).filter(function (m) { return m.papel !== 'docente'; })
    .map(function (m) { return { email: String(m.email).toLowerCase(), nome: m.nome, projetos: String(m.projetos), status: m.status }; });
  return { notas: {
    pesos: e.pesos, finalPublicado: e.finalPublicado,
    quesitos: e.quesitos.map(function (q) { return { id: q.id, nome: q.nome, peso: q.peso, prazo: q.prazo, escopo: q.escopo, publicado: q.publicado, ativo: q.ativo }; }),
    alunos: e.alunos.map(function (a) { return { id: a.id, nome: a.nome, projeto: a.projeto, email: a.email, participacao: a.participacao, frequencia: a.frequencia, ativo: a.ativo }; }),
    lancamentos: Object.keys(e.notas).map(function (k) { var n = e.notas[k]; return { quesito: n.quesito, alvo: n.alvo, nota: n.nota, situacao: n.situacao, comentario: n.comentario, docente: nomeCurto_(n.docente), data: n.data }; }),
    fechamento: e.alunos.filter(function (a) { return a.ativo; }).map(function (a) { return calcularAluno_(e, a, false); }),
    membros: membros
  } };
}

function historicoNotas_(usuario, linhas) {
  if (!linhas.length) return;
  var aba = abaNotas_('notas_historico', CAB_NOTAS_HIST);
  var agora = new Date().toISOString();
  var dados = linhas.map(function (l) { return [agora, usuario.email, seguro_(l[0]), seguro_(l[1]), seguro_(l[2]), seguro_(l[3])]; });
  aba.getRange(aba.getLastRow() + 1, 1, dados.length, CAB_NOTAS_HIST.length).setValues(dados);
}

function notaValida_(v, rotulo, max) {
  var n = num_(v);
  if (n === null) {
    if (String(v == null ? '' : v).trim() !== '') throw new Error(rotulo + ': valor inválido.');
    return null;
  }
  if (n < 0 || n > max) throw new Error(rotulo + ': use um valor de 0 a ' + max + '.');
  return Math.round(n * 100) / 100;
}

function txt_(n) { return n === null || n === undefined ? '' : String(n); }

function salvarPesos_(usuario, req) {
  exigirDocente_(usuario);
  var p = req.pesos || {}, soma = 0, novos = {};
  COMPONENTES.forEach(function (c) {
    var v = notaValida_(p[c], 'Peso de ' + c, 100);
    if (v === null) throw new Error('Informe o peso de ' + c + '.');
    novos[c] = v; soma += v;
  });
  if (Math.abs(soma - 100) > 0.01) throw new Error('Os quatro pesos precisam somar 100. A soma atual é ' + soma + '.');
  return comTrava_(function () {
    var antes = lerConfigNotas_().pesos, hist = [];
    COMPONENTES.forEach(function (c) {
      if (antes[c] !== novos[c]) { gravarConfig_('peso_' + c, novos[c]); hist.push(['peso ' + c, '', antes[c], novos[c]]); }
    });
    historicoNotas_(usuario, hist);
    return estadoNotasDocente_(usuario);
  });
}

function salvarQuesito_(usuario, req) {
  exigirDocente_(usuario);
  var nome = texto_(req.nome, 120);
  if (!nome) throw new Error('Dê um nome à avaliação.');
  var peso = notaValida_(req.peso, 'Peso', 1000);
  if (peso === null || peso <= 0) throw new Error('Informe um peso maior que zero.');
  var prazo = texto_(req.prazo, 10);
  if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) throw new Error('Prazo inválido.');
  var escopo = req.escopo === 'individual' ? 'individual' : 'grupo';
  return comTrava_(function () {
    var e = lerEstadoNotas_(), aba = abaNotas_('quesitos', CAB_QUESITOS);
    var atual = e.quesitos.filter(function (q) { return q.id === String(req.id || ''); })[0];
    if (req.id && !atual) throw new Error('Avaliação não encontrada.');
    if (atual) {
      if (atual.escopo !== escopo && Object.keys(e.notas).some(function (k) { return e.notas[k].quesito === atual.id; })) {
        throw new Error('Esta avaliação já tem notas lançadas; não é possível trocar entre grupo e individual.');
      }
      aba.getRange(atual.linha, 2, 1, 4).setValues([[seguro_(nome), txt_(peso), prazo, escopo]]);
      aba.getRange(atual.linha, 7).setValue(req.ativo === false ? 'nao' : 'sim');
      historicoNotas_(usuario, [['avaliação ' + atual.id, '', atual.nome + ' (peso ' + atual.peso + (atual.ativo ? '' : ', inativa') + ')', nome + ' (peso ' + peso + (req.ativo === false ? ', inativa' : '') + ')']]);
    } else {
      var id = 'q' + novoId_().replace(/-/g, '').slice(0, 8);
      aba.appendRow([id, seguro_(nome), txt_(peso), prazo, escopo, '', 'sim']);
      historicoNotas_(usuario, [['avaliação ' + id, '', '', nome + ' (peso ' + peso + ')']]);
    }
    return estadoNotasDocente_(usuario);
  });
}

function lancarNota_(usuario, req) {
  exigirDocente_(usuario);
  var nota = notaValida_(req.nota, 'Nota', 10);
  var situacao = SITUACOES.indexOf(req.situacao) >= 0 ? req.situacao : '';
  var comentario = texto_(req.comentario, CONFIG.MAX_CAMPO);
  var alvo = String(req.alvo || '');
  return comTrava_(function () {
    var e = lerEstadoNotas_();
    var q = e.quesitos.filter(function (x) { return x.id === String(req.quesito); })[0];
    if (!q) throw new Error('Avaliação não encontrada.');
    if (q.escopo === 'grupo') {
      if (!/^P\d+$/.test(alvo)) throw new Error('Esta avaliação é lançada por grupo.');
    } else if (!e.alunos.some(function (a) { return 'A' + a.id === alvo; })) throw new Error('Aluno não encontrado.');
    var aba = abaNotas_('notas', CAB_NOTAS);
    var atual = e.notas[q.id + '|' + alvo];
    var linha = [q.id, alvo, txt_(nota), situacao, seguro_(comentario), usuario.nome, new Date().toISOString()];
    if (atual) aba.getRange(atual.linha, 1, 1, linha.length).setValues([linha]);
    else aba.appendRow(linha);
    var de = atual ? txt_(atual.nota) + (atual.situacao ? ' / ' + atual.situacao : '') : '';
    var para = txt_(nota) + (situacao ? ' / ' + situacao : '');
    if (de !== para || (atual ? atual.comentario : '') !== comentario) historicoNotas_(usuario, [[q.nome, alvo, de, para]]);
    return estadoNotasDocente_(usuario);
  });
}

/** Grava vários alunos de uma vez (cadastro, e-mail, participação, frequência). */
function salvarAlunos_(usuario, req) {
  exigirDocente_(usuario);
  var lista = req.alunos || [];
  if (!lista.length) throw new Error('Nada para salvar.');
  return comTrava_(function () {
    var e = lerEstadoNotas_(), aba = abaNotas_('alunos', CAB_ALUNOS), hist = [];
    var emails = {};
    e.alunos.forEach(function (a) { if (a.email) emails[a.email] = a.id; });
    lista.forEach(function (d) {
      var atual = e.alunos.filter(function (a) { return a.id === String(d.id || ''); })[0];
      if (d.id && !atual) throw new Error('Aluno não encontrado.');
      var nome = texto_(d.nome, 120);
      if (!nome) throw new Error('Há um aluno sem nome.');
      var projeto = Number(d.projeto);
      if (!(projeto >= 1 && projeto <= 99)) throw new Error(nome + ': informe o número do projeto.');
      var email = String(d.email || '').toLowerCase().trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(nome + ': e-mail inválido.');
      var id = atual ? atual.id : 'a' + novoId_().replace(/-/g, '').slice(0, 8);
      if (email && emails[email] && emails[email] !== id) throw new Error(nome + ': este e-mail já está ligado a outro aluno.');
      if (atual && atual.email && atual.email !== email) delete emails[atual.email];
      if (email) emails[email] = id;
      var part = notaValida_(d.participacao, nome + ' — participação', 10);
      var freq = notaValida_(d.frequencia, nome + ' — frequência (%)', 100);
      var linha = [id, seguro_(nome), String(projeto), email, txt_(part), txt_(freq), d.ativo === false ? 'nao' : 'sim'];
      if (atual) {
        aba.getRange(atual.linha, 1, 1, linha.length).setValues([linha]);
        if (atual.participacao !== part) hist.push(['participação', 'A' + id + ' ' + nome, txt_(atual.participacao), txt_(part)]);
        if (atual.frequencia !== freq) hist.push(['frequência', 'A' + id + ' ' + nome, txt_(atual.frequencia), txt_(freq)]);
        if (atual.projeto !== projeto) hist.push(['projeto', 'A' + id + ' ' + nome, atual.projeto, projeto]);
      } else {
        aba.appendRow(linha);
        hist.push(['aluno cadastrado', 'A' + id + ' ' + nome, '', 'projeto ' + projeto]);
      }
    });
    historicoNotas_(usuario, hist);
    return estadoNotasDocente_(usuario);
  });
}

/** Importa a lista da turma: uma linha por aluno, no formato "Nome; número do projeto". */
function importarAlunos_(usuario, req) {
  exigirDocente_(usuario);
  var linhas = String(req.texto || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  if (!linhas.length) throw new Error('Cole a lista com uma linha por aluno.');
  var novos = [];
  linhas.forEach(function (l, i) {
    var m = /^(.*?)[;\t,]\s*#?(\d{1,2})\s*$/.exec(l);
    if (!m || !m[1].trim()) throw new Error('Linha ' + (i + 1) + ' fora do formato "Nome; número do projeto": ' + l.slice(0, 60));
    novos.push({ nome: m[1].trim(), projeto: Number(m[2]) });
  });
  var e = lerEstadoNotas_();
  var chave = function (nome, projeto) { return nome.toLowerCase().replace(/\s+/g, ' ') + '|' + projeto; };
  var existentes = {};
  e.alunos.forEach(function (a) { existentes[chave(a.nome, a.projeto)] = true; });
  var inserir = novos.filter(function (n) {
    var k = chave(n.nome, n.projeto);
    if (existentes[k]) return false;
    existentes[k] = true; return true;
  });
  if (!inserir.length) { var r0 = estadoNotasDocente_(usuario); r0.importados = 0; return r0; }
  var r = salvarAlunos_(usuario, { alunos: inserir });
  r.importados = inserir.length;
  return r;
}

function publicarNotas_(usuario, req) {
  exigirDocente_(usuario);
  var publicar = !!req.publicar;
  return comTrava_(function () {
    if (req.final) {
      gravarConfig_('final_publicado', publicar ? 'sim' : 'nao');
      historicoNotas_(usuario, [['publicação', 'nota final', '', publicar ? 'publicada' : 'recolhida']]);
    } else {
      var e = lerEstadoNotas_();
      var q = e.quesitos.filter(function (x) { return x.id === String(req.quesito); })[0];
      if (!q) throw new Error('Avaliação não encontrada.');
      abaNotas_('quesitos', CAB_QUESITOS).getRange(q.linha, 6).setValue(publicar ? 'sim' : '');
      historicoNotas_(usuario, [['publicação', q.nome, '', publicar ? 'publicada' : 'recolhida']]);
    }
    return estadoNotasDocente_(usuario);
  });
}

/** Visão do aluno: só as próprias notas, e só o que já foi publicado. */
function minhasNotas_(usuario) {
  var e = lerEstadoNotas_();
  var aluno = e.alunos.filter(function (a) { return a.ativo && a.email && a.email === usuario.email; })[0];
  if (!aluno) return { minhas: { vinculado: false } };
  var avaliacoes = [];
  e.quesitos.forEach(function (q) {
    if (!q.ativo || !q.publicado) return;
    var l = e.notas[q.id + '|' + (q.escopo === 'individual' ? 'A' + aluno.id : 'P' + aluno.projeto)];
    avaliacoes.push({ nome: q.nome, peso: q.peso, prazo: q.prazo, escopo: q.escopo, nota: notaEfetiva_(l),
      situacao: l ? l.situacao : '', comentario: l ? l.comentario : '' });
  });
  var out = { vinculado: true, nome: aluno.nome, projeto: aluno.projeto, avaliacoes: avaliacoes, finalPublicado: e.finalPublicado };
  if (e.finalPublicado) { out.final = calcularAluno_(e, aluno, false); out.pesos = e.pesos; }
  return { minhas: out };
}

// ====================================================================
// Conversão linhas da planilha -> projetos.
// ATENÇÃO: este bloco é idêntico ao de 2026-2/pi2-live.js. Ao mudar um, mude o outro.
// ====================================================================
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
