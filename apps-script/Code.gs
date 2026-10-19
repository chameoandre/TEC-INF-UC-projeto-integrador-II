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

  MAX_TEXTO: 3000,
  MAX_CAMPO: 600,
  MAX_ENVIOS_POR_HORA: 12,
  AVANCOS_NA_PLANILHA: 6,  // quantos registros recentes espelhar na coluna AVANÇOS
  NOTIFICAR_EMAIL: true    // Ativar envio de e-mails em novas demandas
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
var CAB_AVALIACOES = ['id', 'atualizado_em', 'projeto', 'tipo', 'nota', 'status', 'criterios', 'parecer', 'avaliador'];
var CAB_DEMANDAS = ['id', 'data', 'projeto', 'titulo', 'descricao', 'prazo', 'criado_por', 'status', 'concluida_em', 'evidencia', 'concluida_por', 'pontos', 'criterios'];

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
    MEMO.controleId = ss.getId();
  }
  var membros = garantirAba_(ss, 'membros', CAB_MEMBROS);
  garantirAba_(ss, 'registros', CAB_REGISTROS);
  garantirAba_(ss, 'alteracoes', CAB_ALTERACOES);
  garantirAba_(ss, 'avaliacoes', CAB_AVALIACOES);
  garantirAba_(ss, 'demandas', CAB_DEMANDAS);
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
      salvarLink: salvarLink_,
      removerLink: removerLink_,
      linksProjeto: linksProjeto_,
      decidirLink: decidirLink_,
      notasPainel: estadoNotasDocente_,
      salvarPesos: salvarPesos_,
      salvarQuesito: salvarQuesito_,
      lancarNota: lancarNota_,
      salvarAlunos: salvarAlunos_,
      importarAlunos: importarAlunos_,
      publicarNotas: publicarNotas_,
      abrirPares: abrirPares_,
      salvarRegra: salvarRegra_,
      avaliarParticipacao: avaliarParticipacao_,
      minhasNotas: minhasNotas_,
      salvarAvaliacao: salvarAvaliacao_,
      avaliarObjetivos: salvarAvaliacao_,
      criarDemanda: criarDemanda_,
      concluirDemanda: concluirDemanda_,
      removerDemanda: removerDemanda_,
      alterarPrazoDemanda: alterarPrazoDemanda_,
      notificarDemanda: notificarDemanda_
    };
    var fn = acoes[req.acao];
    if (!fn) throw new Error('Ação desconhecida.');
    var out = fn(usuario, req) || {};
    out.ok = true;
    out.usuario = publicoUsuario_(usuario);
    if (usuario.papel === 'docente' && (req.acao === 'whoami' || req.acao === 'painel' || req.acao === 'decidirLink' || req.acao === 'decidirAcesso')) out.usuario.pendencias = pendencias_();
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
    if (req.demandaId) {
      concluirDemandaSilenciosa_(usuario, req.demandaId, texto, evidencia);
    }
    return { id: id };
  });
}

/** Mantém as colunas AVANÇOS / PRÓXIMOS PASSOS / DIFICULDADES da planilha pública em dia. */
function espelharNaPlanilha_(projeto, proximos, dificuldades) {
  var linha = linhaDoProjeto_(projeto);
  if (!linha) return;
  var aba = publica_().getSheetByName(CONFIG.ABA_PROJETOS);
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
    var aba = publica_().getSheetByName(CONFIG.ABA_PROJETOS);
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
  return { membros: membros, alteracoes: alteracoes, linksPendentes: linksPendentes_(), planilhaControle: ss.getUrl(),
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
  if (controleId_()) {
    registros = lerRegistros_().filter(function (r) { return !r.oculto; }).map(function (r) {
      return { id: r.id, data: r.data, projeto: r.projeto, autor: nomeCurto_(r.autor), tipo: r.tipo, texto: r.texto,
        evidencia: r.evidencia, experimento: r.experimento, proximosPassos: r.proximos, dificuldades: r.dificuldades,
        devolutiva: r.devolutiva ? { texto: r.devolutiva, autor: nomeCurto_(r.devolutivaAutor), data: r.devolutivaData } : null };
    });
  }
  return {
    ok: true,
    geradoEm: new Date().toISOString(),
    projetos: lidos.projetos,
    registros: registros,
    links: controleId_() ? linksPublicos_() : [],
    avaliacoes: lerAvaliacoesPublicas_(),
    demandas: controleId_() ? lerDemandasPublicas_() : []
  };
}

// ============================ AVALIAÇÕES & RUBRICAS (ROTEIRO 1) ============================

function salvarAvaliacao_(usuario, body) {
  exigirDocente_(usuario);
  var projId = Number(body.projeto || body.projetoId);
  if (!projId || isNaN(projId)) throw new Error('Projeto inválido.');

  var tipo = seguro_(texto_(body.tipo || 'objetivos', 50));
  var nota = seguro_(texto_(String(body.nota != null ? body.nota : ''), 10));
  var status = seguro_(texto_(body.status || 'pendente', 30));
  var criterios = typeof body.criterios === 'object' ? JSON.stringify(body.criterios) : String(body.criterios || '{}');
  var parecer = seguro_(texto_(body.parecer, CONFIG.MAX_TEXTO));
  var avaliador = nomeCurto_(usuario.nome || usuario.email);
  var agora = new Date().toISOString();
  var id = 'AV-' + projId + '-' + tipo.toUpperCase();

  var ss = controle_();
  var aba = garantirAba_(ss, 'avaliacoes', CAB_AVALIACOES);
  var dados = aba.getDataRange().getValues();
  var linhaEncontrada = -1;

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) === id || (Number(dados[i][2]) === projId && String(dados[i][3]) === tipo)) {
      linhaEncontrada = i + 1;
      break;
    }
  }

  var linha = [id, agora, projId, tipo, nota, status, criterios, parecer, avaliador];

  if (linhaEncontrada > 1) {
    aba.getRange(linhaEncontrada, 1, 1, CAB_AVALIACOES.length).setValues([linha]);
  } else {
    aba.appendRow(linha);
  }

  return { ok: true, id: id, projeto: projId, tipo: tipo, nota: nota, status: status };
}

function lerAvaliacoesPublicas_() {
  if (!controleId_()) return [];
  var ss = controle_();
  var aba = ss.getSheetByName('avaliacoes');
  if (!aba || aba.getLastRow() < 2) return [];

  var dados = aba.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < dados.length; i++) {
    var rawCriterios = String(dados[i][6] || '{}');
    var criteriosObj = {};
    try {
      criteriosObj = JSON.parse(rawCriterios);
    } catch (e) {
      criteriosObj = {};
    }

    list.push({
      id: String(dados[i][0]),
      atualizadoEm: String(dados[i][1]),
      projeto: Number(dados[i][2]),
      tipo: String(dados[i][3]),
      nota: String(dados[i][4]),
      status: String(dados[i][5]),
      criterios: criteriosObj,
      parecer: String(dados[i][7] || ''),
      avaliador: String(dados[i][8] || '')
    });
  }
  return list;
}

// ============================ GESTÃO DE DEMANDAS / CHECKPOINTS ============================

function criarDemanda_(usuario, body) {
  exigirDocente_(usuario);

  var projeto = String(body.projeto || '*').trim(); // '*' = todos os projetos
  var titulo = seguro_(body.titulo, 150);
  var descricao = seguro_(body.descricao, CONFIG.MAX_TEXTO);
  var prazo = seguro_(body.prazo, 30); // ex: '2026-10-25'
  var pontos = seguro_(body.pontos, 30); // ex: '10,0' ou 'Peso 2'
  var criterios = seguro_(body.criterios, CONFIG.MAX_TEXTO);

  if (!titulo) throw new Error('Informe o título da demanda.');

  var id = 'D' + Date.now().toString(36).toUpperCase();
  var agora = new Date().toISOString();
  var autor = nomeCurto_(usuario.nome) || usuario.email;

  var ss = controle_();
  var aba = garantirAba_(ss, 'demandas', CAB_DEMANDAS);
  aba.appendRow([id, agora, projeto, titulo, descricao, prazo, autor, 'pendente', '', '', '', pontos, criterios]);

  // Disparar e-mails para os estudantes
  if (CONFIG.NOTIFICAR_EMAIL) {
    enviarEmailDemanda_(projeto, titulo, descricao, prazo, autor);
  }

  return { ok: true, id: id };
}

function concluirDemanda_(usuario, body) {
  var demandaId = String(body.demandaId || '').trim();
  if (!demandaId) throw new Error('Demanda não informada.');

  var ss = controle_();
  var aba = garantirAba_(ss, 'demandas', CAB_DEMANDAS);
  var dados = aba.getDataRange().getValues();
  var achou = false;

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) === demandaId) {
      var projDemanda = String(dados[i][2]);
      if (usuario.papel !== 'docente' && !podeEditar_(usuario, projDemanda)) {
        throw new Error('Você não tem permissão para concluir demandas deste projeto.');
      }
      var agora = new Date().toISOString();
      var autor = nomeCurto_(usuario.nome) || usuario.email;
      var evidencia = url_(body.evidencia, 'Evidência') || seguro_(body.texto, 300);

      aba.getRange(i + 1, 8).setValue('concluida');
      aba.getRange(i + 1, 9).setValue(agora);
      aba.getRange(i + 1, 10).setValue(evidencia);
      aba.getRange(i + 1, 11).setValue(autor);
      achou = true;
      break;
    }
  }

  if (!achou) throw new Error('Demanda não encontrada.');
  return { ok: true, demandaId: demandaId };
}

function concluirDemandaSilenciosa_(usuario, demandaId, texto, evidencia) {
  try {
    var ss = controle_();
    var aba = ss.getSheetByName('demandas');
    if (!aba) return;
    var dados = aba.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][0]) === String(demandaId)) {
        aba.getRange(i + 1, 8).setValue('concluida');
        aba.getRange(i + 1, 9).setValue(new Date().toISOString());
        aba.getRange(i + 1, 10).setValue(evidencia || texto);
        aba.getRange(i + 1, 11).setValue(nomeCurto_(usuario.nome) || usuario.email);
        break;
      }
    }
  } catch (e) {
    Logger.log('Erro ao concluir demanda silenciosa: ' + e);
  }
}

function removerDemanda_(usuario, req) {
  exigirDocente_(usuario);
  var demandaId = String(req.demandaId || req.id || '').trim();
  if (!demandaId) throw new Error('Demanda não informada.');
  var ss = controle_();
  var aba = ss.getSheetByName('demandas');
  if (!aba) return { ok: true };
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) === String(demandaId)) {
      aba.deleteRow(i + 1);
      return { ok: true, removido: demandaId };
    }
  }
  return { ok: true };
}

function alterarPrazoDemanda_(usuario, body) {
  exigirDocente_(usuario);
  var demandaId = String(body.demandaId || body.id || '').trim();
  var novoPrazo = seguro_(body.prazo || body.novoPrazo || '', 30);
  var notificar = Boolean(body.notificar);
  var mensagem = seguro_(body.mensagem || '', CONFIG.MAX_TEXTO);

  if (!demandaId) throw new Error('Demanda não informada.');
  if (!novoPrazo) throw new Error('Informe o novo prazo.');

  var ss = controle_();
  var aba = ss.getSheetByName('demandas');
  if (!aba) throw new Error('Aba demandas não encontrada.');
  var dados = aba.getDataRange().getValues();
  var dem = null;

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]).toUpperCase() === demandaId.toUpperCase()) {
      aba.getRange(i + 1, 6).setValue(novoPrazo);
      dem = {
        id: dados[i][0],
        projeto: dados[i][2],
        titulo: dados[i][3],
        descricao: dados[i][4],
        prazoAnterior: dados[i][5],
        novoPrazo: novoPrazo,
        criadoPor: dados[i][6],
        pontos: dados[i][11],
        criterios: dados[i][12]
      };
      break;
    }
  }

  if (!dem) throw new Error('Demanda não encontrada.');

  var totalEnviados = 0;
  if (notificar) {
    totalEnviados = enviarNotificacaoDemandaCustom_(dem, 'prazo', mensagem, nomeCurto_(usuario.nome) || usuario.email);
  }

  return { ok: true, id: demandaId, novoPrazo: novoPrazo, totalEnviados: totalEnviados };
}

function notificarDemanda_(usuario, body) {
  exigirDocente_(usuario);
  var demandaId = String(body.demandaId || body.id || '').trim();
  var tipo = String(body.tipo || 'lembrete'); // 'lembrete' | 'comunicado'
  var mensagem = seguro_(body.mensagem || '', CONFIG.MAX_TEXTO);

  if (!demandaId) throw new Error('Demanda não informada.');

  var ss = controle_();
  var aba = ss.getSheetByName('demandas');
  if (!aba) throw new Error('Aba demandas não encontrada.');
  var dados = aba.getDataRange().getValues();
  var dem = null;

  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]).toUpperCase() === demandaId.toUpperCase()) {
      dem = {
        id: dados[i][0],
        projeto: dados[i][2],
        titulo: dados[i][3],
        descricao: dados[i][4],
        prazo: dados[i][5],
        criadoPor: dados[i][6],
        pontos: dados[i][11],
        criterios: dados[i][12]
      };
      break;
    }
  }

  if (!dem) throw new Error('Demanda não encontrada.');

  var totalEnviados = enviarNotificacaoDemandaCustom_(dem, tipo, mensagem, nomeCurto_(usuario.nome) || usuario.email);
  return { ok: true, id: demandaId, tipo: tipo, totalEnviados: totalEnviados };
}

function montarHtmlEmailDemanda_(params) {
  var tipo = params.tipo || 'nova';
  var titulo = params.titulo || '';
  var escopoTxt = params.escopoTxt || 'Geral (Turma)';
  var prazo = params.prazo || '';
  var prazoAnterior = params.prazoAnterior || '';
  var pontos = params.pontos || '';
  var criterios = params.criterios || '';
  var descricao = params.descricao || '';
  var mensagem = params.mensagem || '';
  var autor = params.autor || 'Equipe Docente';
  var dashboardUrl = 'https://chameoandre.github.io/TEC-INF-UC-projeto-integrador-II/2026-2/';

  // Paleta de cores por tipo
  var corHeader = '#16a34a'; // Verde IFSC padrão
  var tituloHeader = '🎯 Nova Demanda & Checkpoint Docente';
  var introTexto = 'A equipe docente de Projeto Integrador II registrou uma nova meta avaliativa para você e seu grupo:';

  if (tipo === 'lembrete') {
    corHeader = '#d97706'; // Âmbar
    tituloHeader = '⏳ Lembrete de Prazo: Demanda Pendente';
    introTexto = 'Este é um lembrete docente referente à demanda em andamento da sua equipe. Confiram o prazo e as entregas pendentes:';
  } else if (tipo === 'comunicado') {
    corHeader = '#7c3aed'; // Roxo
    tituloHeader = '📢 Comunicado da Equipe Docente';
    introTexto = 'A equipe docente enviou uma orientação/comunicado complementar vinculado à seguinte demanda:';
  } else if (tipo === 'prazo') {
    corHeader = '#0284c7'; // Azul Oceano
    tituloHeader = '📅 Atualização de Prazo de Entrega';
    introTexto = 'O prazo da seguinte demanda foi atualizado pelos professores orientadores:';
  }

  var html = '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; color: #1e293b; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff;">' +
    '<div style="background: ' + corHeader + '; padding: 22px 26px; color: #ffffff;">' +
      '<h2 style="margin: 0; font-size: 1.25rem; font-weight: 700; letter-spacing: -0.01em;">' + tituloHeader + '</h2>' +
      '<p style="margin: 4px 0 0; font-size: 0.85rem; opacity: 0.92;">Projeto Integrador II • Técnico em Informática • IFSC Garopaba</p>' +
    '</div>' +
    '<div style="padding: 26px;">' +
      '<p style="margin-top: 0; font-size: 1rem; color: #0f172a;">Olá, estudantes do <strong>' + escopoTxt + '</strong>,</p>' +
      '<p style="color: #475569; font-size: 0.95rem; margin-bottom: 20px;">' + introTexto + '</p>' +

      '<div style="background: #f8fafc; border-left: 4px solid ' + corHeader + '; border-radius: 8px; padding: 14px 18px; margin: 18px 0; font-size: 0.92rem; border-top: 1px solid #f1f5f9; border-right: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9;">' +
        '<div style="font-size: 1.05rem; font-weight: 700; color: #0f172a; margin-bottom: 6px;">' + titulo + '</div>' +
        '<div style="display: flex; flex-wrap: wrap; gap: 12px; color: #475569; font-size: 0.85rem; margin-top: 4px;">' +
          '<div><strong>📋 Escopo:</strong> ' + escopoTxt + '</div>' +
          (prazo ? ('<div><strong>📅 Prazo Limite:</strong> <span style="color: #b45309; font-weight: 700;">' + prazo + '</span></div>') : '') +
          (prazoAnterior ? ('<div style="color: #94a3b8; font-size: 0.8rem;">(Prazo anterior: ' + prazoAnterior + ')</div>') : '') +
          (pontos ? ('<div><strong>⭐ Pontuação / Peso:</strong> ' + pontos + '</div>') : '') +
        '</div>' +
      '</div>';

  if (mensagem) {
    html += '<div style="margin-top: 20px;">' +
      '<h3 style="color: #475569; font-size: 0.95rem; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">💬 Mensagem & Esclarecimento Docente (' + autor + '):</h3>' +
      '<div style="background: #eff6ff; border: 1px solid #bfdbfe; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 14px 16px; font-size: 0.92rem; color: #1e3a8a; white-space: pre-line; line-height: 1.55;">' +
        mensagem +
      '</div>' +
    '</div>';
  }

  if (criterios) {
    html += '<div style="margin-top: 20px;">' +
      '<h3 style="color: #166534; font-size: 0.95rem; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">📋 Critérios de Aceite & Rubrica Formativa:</h3>' +
      '<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 4px solid #22c55e; border-radius: 8px; padding: 14px 16px; font-size: 0.92rem; color: #14532d; white-space: pre-line; line-height: 1.55;">' +
        criterios +
      '</div>' +
    '</div>';
  }

  if (descricao) {
    html += '<div style="margin-top: 20px;">' +
      '<h3 style="color: #0e7490; font-size: 0.95rem; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">📝 Detalhes e Orientações Técnicas:</h3>' +
      '<div style="background: #ecfeff; border: 1px solid #a5f3fc; border-left: 4px solid #06b6d4; border-radius: 8px; padding: 14px 16px; font-size: 0.9rem; color: #155e75; white-space: pre-line; line-height: 1.55;">' +
        descricao +
      '</div>' +
    '</div>';
  }

  html += '<div style="margin-top: 28px; padding: 20px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; text-align: center;">' +
      '<p style="margin: 0 0 10px; font-size: 0.88rem; color: #64748b;">Acompanhe o andamento e registre o avanço pelo dashboard da disciplina:</p>' +
      '<a href="' + dashboardUrl + '" target="_blank" style="display: inline-block; background: #16a34a; color: #ffffff; text-decoration: none; font-weight: 700; padding: 10px 22px; border-radius: 6px; font-size: 0.92rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">' +
        '🚀 Acessar Dashboard do Projeto Integrador II' +
      '</a>' +
    '</div>' +

    '<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 26px 0 16px;">' +
    '<p style="font-size: 0.82rem; color: #64748b; margin: 0; line-height: 1.5;">' +
      '<strong>Equipe Docente — Projeto Integrador II</strong><br>' +
      'Prof. André Moraes • Profa. Karyna Landra • Prof. Nauber Gavski<br>' +
      'Instituto Federal de Santa Catarina (IFSC) — Câmpus Garopaba' +
    '</p>' +
  '</div>' +
'</div>';

  return html;
}

function enviarNotificacaoDemandaCustom_(dem, tipo, mensagem, autor) {
  var emailsDestino = [];
  var ss = controle_();
  var abaMembros = ss.getSheetByName('membros');
  if (!abaMembros) return 0;
  var membros = abaMembros.getDataRange().getValues();

  var projStr = String(dem.projeto).trim();
  for (var i = 1; i < membros.length; i++) {
    var e = String(membros[i][0] || '').toLowerCase().trim();
    var projs = String(membros[i][2] || '').split(',').map(function (s) { return s.trim(); });
    var status = membros[i][4];
    if (status === 'ativo' && e.indexOf('@') > 0) {
      if (projStr === '*' || projs.indexOf(projStr) >= 0 || projs.indexOf('*') >= 0) {
        if (emailsDestino.indexOf(e) === -1) {
          emailsDestino.push(e);
        }
      }
    }
  }

  if (!emailsDestino.length) return 0;

  var escopoTxt = projStr === '*' ? 'Geral (Todos os Projetos)' : ('Projeto #' + projStr);
  var assunto = '';
  var corpoTexto = '';

  if (tipo === 'prazo') {
    assunto = '[PI-2 ALTERAÇÃO DE PRAZO] ' + dem.titulo + ' [' + escopoTxt + ']';
    corpoTexto = 'Olá,\n\nA equipe docente atualizou o prazo da demanda:\n\n' +
      'Demanda: ' + dem.titulo + '\nEscopo: ' + escopoTxt + '\nNOVO PRAZO: ' + dem.novoPrazo + '\n' +
      (mensagem ? ('Mensagem: ' + mensagem + '\n') : '') +
      '\nDashboard: https://chameoandre.github.io/TEC-INF-UC-projeto-integrador-II/2026-2/\n';
  } else if (tipo === 'comunicado') {
    assunto = '[PI-2 COMUNICADO] ' + dem.titulo + ' [' + escopoTxt + ']';
    corpoTexto = 'Olá,\n\nA equipe docente enviou um comunicado sobre a demanda:\n\n' +
      'Demanda: ' + dem.titulo + '\nEscopo: ' + escopoTxt + '\n' +
      'Mensagem: ' + (mensagem || '(Sem mensagem adicional)') + '\n\n' +
      'Dashboard: https://chameoandre.github.io/TEC-INF-UC-projeto-integrador-II/2026-2/\n';
  } else {
    // lembrete
    assunto = '[PI-2 LEMBRETE] Prazo de Demanda: ' + dem.titulo + ' [' + escopoTxt + ']';
    corpoTexto = 'Olá,\n\nEste é um lembrete docente referente à demanda em andamento:\n\n' +
      'Demanda: ' + dem.titulo + '\nEscopo: ' + escopoTxt + '\nPrazo: ' + (dem.prazo || 'Sem data limite') + '\n' +
      (mensagem ? ('Mensagem: ' + mensagem + '\n') : '') +
      '\nDashboard: https://chameoandre.github.io/TEC-INF-UC-projeto-integrador-II/2026-2/\n';
  }

  var htmlBody = montarHtmlEmailDemanda_({
    tipo: tipo,
    titulo: dem.titulo,
    escopoTxt: escopoTxt,
    prazo: dem.novoPrazo || dem.prazo,
    prazoAnterior: dem.prazoAnterior,
    pontos: dem.pontos,
    criterios: dem.criterios,
    descricao: dem.descricao,
    mensagem: mensagem,
    autor: autor
  });

  emailsDestino.forEach(function (to) {
    try {
      GmailApp.sendEmail(to, assunto, corpoTexto, {
        htmlBody: htmlBody,
        name: 'Projeto Integrador II • IFSC Garopaba'
      });
    } catch (err) {
      Logger.log('Erro ao enviar para ' + to + ': ' + err);
    }
  });

  return emailsDestino.length;
}

function lerDemandasPublicas_() {
  var ss = controle_();
  var aba = ss.getSheetByName('demandas');
  if (!aba || aba.getLastRow() < 2) return [];
  var dados = aba.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < dados.length; i++) {
    list.push({
      id: String(dados[i][0]),
      data: String(dados[i][1]),
      projeto: String(dados[i][2]),
      titulo: String(dados[i][3]),
      descricao: String(dados[i][4]),
      prazo: String(dados[i][5]),
      criadoPor: String(dados[i][6]),
      status: String(dados[i][7] || 'pendente'),
      concluidaEm: String(dados[i][8] || ''),
      evidencia: String(dados[i][9] || ''),
      concluidaPor: String(dados[i][10] || ''),
      pontos: String(dados[i][11] || ''),
      criterios: String(dados[i][12] || '')
    });
  }
  return list.reverse();
}

function enviarEmailDemanda_(projeto, titulo, descricao, prazo, autor) {
  try {
    var emailsDestino = [];
    var ss = controle_();
    var abaMembros = ss.getSheetByName('membros');
    if (!abaMembros) return;
    var membros = abaMembros.getDataRange().getValues();

    for (var i = 1; i < membros.length; i++) {
      var e = String(membros[i][0] || '').toLowerCase().trim();
      var projs = String(membros[i][2] || '').split(',').map(function (s) { return s.trim(); });
      var status = membros[i][4];
      if (status === 'ativo' && e.indexOf('@') > 0) {
        if (projeto === '*' || projs.indexOf(String(projeto)) >= 0 || projs.indexOf('*') >= 0) {
          if (emailsDestino.indexOf(e) === -1) {
            emailsDestino.push(e);
          }
        }
      }
    }

    if (!emailsDestino.length) return;

    var escopoTxt = projeto === '*' ? 'Geral (Todos os Projetos)' : ('Projeto #' + projeto);
    var assunto = '[PI-2] Nova Demanda Docente: ' + titulo + ' [' + escopoTxt + ']';
    var corpoTexto = 'Olá,\n\nA equipe docente registrou uma nova demanda para você:\n\n' +
      'Título: ' + titulo + '\nEscopo: ' + escopoTxt + '\nPrazo: ' + (prazo || 'Sem data limite') + '\n\n' +
      'Dashboard: https://chameoandre.github.io/TEC-INF-UC-projeto-integrador-II/2026-2/\n';

    var htmlBody = montarHtmlEmailDemanda_({
      tipo: 'nova',
      titulo: titulo,
      escopoTxt: escopoTxt,
      prazo: prazo,
      criterios: '',
      descricao: descricao,
      mensagem: '',
      autor: autor
    });

    emailsDestino.forEach(function (to) {
      try {
        GmailApp.sendEmail(to, assunto, corpoTexto, {
          htmlBody: htmlBody,
          name: 'Projeto Integrador II • IFSC Garopaba'
        });
      } catch (err) {
        Logger.log('Erro ao enviar para ' + to + ': ' + err);
      }
    });
  } catch (err) {
    Logger.log('Erro ao enviar e-mail de demanda: ' + err);
  }
}

function lerProjetos_() {
  var aba = publica_().getSheetByName(CONFIG.ABA_PROJETOS);
  var linhas = aba.getDataRange().getDisplayValues();
  return { projetos: linhasParaProjetos(linhas) };
}

function linhaDoProjeto_(projeto) {
  var aba = publica_().getSheetByName(CONFIG.ABA_PROJETOS);
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
  if (!controleId_()) return null;
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

// Abrir uma planilha é a operação mais lenta do Apps Script. Cada execução abre cada planilha
// uma única vez e reaproveita; estas variáveis valem só durante a execução em curso.
var MEMO = { controle: null, publica: null, controleId: undefined, abas: {}, esquema: null };

function controleId_() {
  if (MEMO.controleId === undefined) MEMO.controleId = PropertiesService.getScriptProperties().getProperty('CONTROLE_ID') || '';
  return MEMO.controleId;
}

function controle_() {
  if (MEMO.controle) return MEMO.controle;
  var id = controleId_();
  if (!id) throw new Error('Backend ainda não instalado: rode a função instalar() no editor do Apps Script.');
  MEMO.controle = SpreadsheetApp.openById(id);
  return MEMO.controle;
}

function publica_() {
  if (!MEMO.publica) MEMO.publica = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  return MEMO.publica;
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
  if (/overleaf\.com\//i.test(s) && !/overleaf\.com\/read\//i.test(s)) throw new Error(rotulo + ': este é o link de EDIÇÃO do Overleaf; quem abrir pode alterar o artigo. Em Share, copie o link "Anyone with this link can view" (…/read/…).');
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
// LINKS EXTRAS — cada projeto pode ter, além dos links fixos da ficha (GitHub, Overleaf,
// diagrama, pitch), uma lista livre de links com nome. Ficam na aba "links" da planilha
// de controle; o GET público devolve só nome e endereço.
// ====================================================================
var CAB_LINKS = ['id', 'projeto', 'nome', 'url', 'email', 'autor', 'data', 'removido', 'status', 'decidido_por'];
var MAX_LINKS_POR_PROJETO = 12;

/**
 * Link incluído por aluno nasce "pendente" e só aparece no site depois que um docente aprova.
 * Link incluído por docente já nasce aprovado. Linhas antigas, sem status, contam como aprovadas.
 */
function lerLinks_() {
  return lerAba_(abaNotas_('links', CAB_LINKS)).map(function (l, i) {
    return { linha: i + 2, id: String(l.id), projeto: Number(l.projeto), nome: String(l.nome), url: String(l.url), autor: String(l.autor || ''),
      data: String(l.data || ''), removido: l.removido === 'sim', status: l.status === 'pendente' || l.status === 'recusado' ? l.status : 'aprovado' };
  });
}

function linksPublicos_() {
  return lerLinks_().filter(function (l) { return !l.removido && l.status === 'aprovado'; })
    .map(function (l) { return { id: l.id, projeto: l.projeto, nome: l.nome, url: l.url }; });
}

/** Todos os links não removidos de um projeto, com a situação: para os integrantes e os docentes. */
function linksDoProjeto_(projeto) {
  return lerLinks_().filter(function (l) { return !l.removido && l.projeto === Number(projeto); })
    .map(function (l) { return { id: l.id, projeto: l.projeto, nome: l.nome, url: l.url, status: l.status, autor: nomeCurto_(l.autor), data: l.data }; });
}

function linksPendentes_() {
  return lerLinks_().filter(function (l) { return !l.removido && l.status === 'pendente'; })
    .map(function (l) { return { id: l.id, projeto: l.projeto, nome: l.nome, url: l.url, autor: l.autor, data: l.data }; });
}

function linksProjeto_(usuario, req) {
  exigirEdicao_(usuario, Number(req.projeto));
  return { doProjeto: linksDoProjeto_(req.projeto) };
}

function salvarLink_(usuario, req) {
  var projeto = Number(req.projeto);
  exigirEdicao_(usuario, projeto);
  limitar_(usuario);
  var docente = usuario.papel === 'docente';
  var nome = texto_(req.nome, 40);
  if (nome.length < 2) throw new Error('Dê um nome curto ao link (ex.: "Protótipo no ar").');
  var url = url_(req.url, 'Endereço');
  if (!url) throw new Error('Informe o endereço do link, começando com https://');
  return comTrava_(function () {
    var aba = abaNotas_('links', CAB_LINKS), todos = lerLinks_(), agora = new Date().toISOString();
    var atual = req.id ? todos.filter(function (l) { return l.id === String(req.id) && !l.removido; })[0] : null;
    if (req.id && !docente) throw new Error('Para trocar um link, remova o antigo e inclua o novo.');
    if (req.id && !atual) throw new Error('Link não encontrado.');
    if (atual && atual.projeto !== projeto) throw new Error('Este link pertence a outro projeto.');
    var alt = controle_().getSheetByName('alteracoes');
    if (atual) {
      aba.getRange(atual.linha, 3, 1, 5).setValues([[seguro_(nome), url, usuario.email, seguro_(usuario.nome), agora]]);
      aba.getRange(atual.linha, 9, 1, 2).setValues([['aprovado', usuario.email]]);
      alt.appendRow([agora, projeto, usuario.email, seguro_(usuario.nome), 'link extra', seguro_(atual.nome + ' → ' + atual.url), seguro_(nome + ' → ' + url)]);
    } else {
      if (todos.filter(function (l) { return l.projeto === projeto && !l.removido && l.status !== 'recusado'; }).length >= MAX_LINKS_POR_PROJETO) throw new Error('Limite de ' + MAX_LINKS_POR_PROJETO + ' links extras por projeto. Remova algum antes de incluir outro.');
      aba.appendRow([novoId_(), String(projeto), seguro_(nome), url, usuario.email, seguro_(usuario.nome), agora, '', docente ? 'aprovado' : 'pendente', docente ? usuario.email : '']);
      alt.appendRow([agora, projeto, usuario.email, seguro_(usuario.nome), docente ? 'link extra' : 'link extra (aguardando aprovação)', '', seguro_(nome + ' → ' + url)]);
    }
    return { links: linksPublicos_(), doProjeto: linksDoProjeto_(projeto), pendente: !docente };
  });
}

function decidirLink_(usuario, req) {
  exigirDocente_(usuario);
  return comTrava_(function () {
    var l = lerLinks_().filter(function (x) { return x.id === String(req.id) && !x.removido; })[0];
    if (!l) throw new Error('Link não encontrado.');
    abaNotas_('links', CAB_LINKS).getRange(l.linha, 9, 1, 2).setValues([[req.aprovar ? 'aprovado' : 'recusado', usuario.email]]);
    controle_().getSheetByName('alteracoes').appendRow([new Date().toISOString(), l.projeto, usuario.email, seguro_(usuario.nome),
      'link extra', seguro_(l.nome + ' → ' + l.url), req.aprovar ? '(aprovado)' : '(recusado)']);
    var out = painel_(usuario);
    out.links = linksPublicos_();
    return out;
  });
}

function removerLink_(usuario, req) {
  return comTrava_(function () {
    var l = lerLinks_().filter(function (x) { return x.id === String(req.id) && !x.removido; })[0];
    if (!l) throw new Error('Link não encontrado.');
    exigirEdicao_(usuario, l.projeto);
    abaNotas_('links', CAB_LINKS).getRange(l.linha, 8).setValue('sim');
    controle_().getSheetByName('alteracoes').appendRow([new Date().toISOString(), l.projeto, usuario.email, seguro_(usuario.nome), 'link extra', seguro_(l.nome + ' → ' + l.url), '(removido)']);
    return { links: linksPublicos_(), doProjeto: linksDoProjeto_(l.projeto) };
  });
}

/** Quantas coisas esperam decisão de um docente; mostrado como contador no botão do painel. */
function pendencias_() {
  var acessos = lerAba_(controle_().getSheetByName('membros')).filter(function (m) { return m.status === 'pendente'; }).length;
  return { acessos: acessos, links: linksPendentes_().length };
}

// ====================================================================
// NOTAS — quesitos, alunos, lançamentos, pesos, publicação e nota final.
// Tudo fica na planilha de controle (privada). Nada daqui sai no GET público.
//
// Nota final do aluno = média ponderada de quatro componentes:
//   Entregas      média ponderada dos quesitos. Em quesito de grupo, a nota do aluno é a nota do grupo
//                 multiplicada pelo fator de participação dele naquela atividade (ver fatorParticipacao_).
//                 Em quesito individual, é a nota lançada para o aluno.
//   Participação  0 a 10, por aluno: o valor digitado na aba Alunos ou, se vazio, a média das
//                 participações por atividade definidas pelo docente
//   Frequência    percentual de presença / 10, por aluno
//   Pontualidade  10 × (entregas no prazo ÷ entregas com situação marcada), pelo grupo
// Componente ainda sem dado fica fora da conta e a nota aparece como "parcial".
// ====================================================================

var CAB_QUESITOS = ['id', 'nome', 'peso', 'prazo', 'escopo', 'publicado', 'ativo', 'pares'];
var CAB_PARTICIPACAO = ['quesito', 'aluno', 'valor', 'docente', 'data'];
var CAB_PARES = ['quesito', 'avaliador', 'avaliado', 'valor', 'comentario', 'data'];
var CAB_ALUNOS = ['id', 'nome', 'projeto', 'email', 'participacao', 'frequencia', 'ativo'];
var CAB_NOTAS = ['quesito', 'alvo', 'nota', 'situacao', 'comentario', 'docente', 'data'];
var CAB_CONFIG = ['chave', 'valor'];
var CAB_NOTAS_HIST = ['data', 'docente', 'item', 'alvo', 'de', 'para'];
var COMPONENTES = ['entregas', 'participacao', 'frequencia', 'pontualidade'];
var PESOS_PADRAO = { entregas: 60, participacao: 15, frequencia: 10, pontualidade: 15 };
var SITUACOES = ['', 'no_prazo', 'atrasado', 'nao_entregue'];
var REGRAS = ['faixas', 'proporcional', 'amortecida'];
var FAIXAS_PADRAO = { cheiaMin: 8, mediaMin: 5, mediaPct: 80, baixaPct: 50 };
var QUESITOS_INICIAIS = ['Submissão SNCT (FEPE)', 'Paper SEPEI', 'Trabalhos relacionados',
  'Experimentos (4 definidos e com resultados)', 'Pitch em vídeo', 'Diagrama do projeto', 'Submissão COTB'];

/**
 * Abre (ou cria) uma aba de notas. As células são texto puro, para a planilha não reformatar números e datas.
 * O cabeçalho só é conferido quando o formato da aba muda de versão (registrado em ESQUEMA_ABAS),
 * o que poupa uma leitura por aba em cada acesso.
 */
function abaNotas_(nome, cabecalho) {
  if (MEMO.abas[nome]) return MEMO.abas[nome];
  var props = PropertiesService.getScriptProperties();
  if (!MEMO.esquema) {
    try { MEMO.esquema = JSON.parse(props.getProperty('ESQUEMA_ABAS') || '{}'); } catch (err) { MEMO.esquema = {}; }
  }
  var assinatura = cabecalho.join('|');
  var ss = controle_();
  var aba = ss.getSheetByName(nome);
  if (aba && MEMO.esquema[nome] === assinatura) { MEMO.abas[nome] = aba; return aba; }
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.getRange(1, 1, aba.getMaxRows(), cabecalho.length).setNumberFormat('@');
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
    aba.setFrozenRows(1);
  } else {
    var topo = aba.getRange(1, 1, 1, cabecalho.length);
    if (topo.getDisplayValues()[0].join('|') !== assinatura) {
      aba.getRange(1, 1, aba.getMaxRows(), cabecalho.length).setNumberFormat('@');
      topo.setValues([cabecalho]).setFontWeight('bold');
    }
  }
  MEMO.esquema[nome] = assinatura;
  props.setProperty('ESQUEMA_ABAS', JSON.stringify(MEMO.esquema));
  MEMO.abas[nome] = aba;
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
  var faixas = {};
  Object.keys(FAIXAS_PADRAO).forEach(function (k) { var v = num_(cfg['faixa_' + k]); faixas[k] = v === null ? FAIXAS_PADRAO[k] : v; });
  return { pesos: pesos, finalPublicado: cfg.final_publicado === 'sim', semeado: cfg.quesitos_semeados === 'sim',
    regra: REGRAS.indexOf(cfg.regra_participacao) >= 0 ? cfg.regra_participacao : 'faixas', faixas: faixas };
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
      escopo: q.escopo === 'individual' ? 'individual' : 'grupo', publicado: q.publicado === 'sim', ativo: q.ativo !== 'nao', pares: q.pares === 'sim' };
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
  var partic = {};
  lerAba_(abaNotas_('participacao', CAB_PARTICIPACAO)).forEach(function (l, i) {
    partic[l.quesito + '|' + l.aluno] = { linha: i + 2, valor: num_(l.valor) };
  });
  var pares = lerAba_(abaNotas_('avaliacoes_pares', CAB_PARES)).map(function (l, i) {
    return { linha: i + 2, quesito: String(l.quesito), avaliador: String(l.avaliador), avaliado: String(l.avaliado), valor: num_(l.valor), comentario: String(l.comentario || '') };
  });
  return { pesos: cfg.pesos, finalPublicado: cfg.finalPublicado, regra: cfg.regra, faixas: cfg.faixas,
    quesitos: quesitos, alunos: alunos, notas: notas, partic: partic, pares: pares };
}

/** Nota efetiva de um lançamento: "não entregue" sem nota digitada vale zero. */
function notaEfetiva_(l) {
  if (!l) return null;
  if (l.nota !== null) return l.nota;
  return l.situacao === 'nao_entregue' ? 0 : null;
}

/** Quanto da nota do grupo o aluno leva, dada a participação (0 a 10) definida pelo docente. Sem definição: 100%. */
function fatorParticipacao_(estado, p) {
  if (p === null || p === undefined) return 1;
  p = Math.max(0, Math.min(10, p));
  if (estado.regra === 'proporcional') return p / 10;
  if (estado.regra === 'amortecida') return 0.5 + 0.5 * p / 10;
  var f = estado.faixas;
  if (p >= f.cheiaMin) return 1;
  if (p >= f.mediaMin) return f.mediaPct / 100;
  if (p > 0) return f.baixaPct / 100;
  return 0;
}

function participacaoDecidida_(estado, quesitoId, alunoId) {
  var l = estado.partic[quesitoId + '|' + alunoId];
  return l ? l.valor : null;
}

function arred_(n) { return n === null ? null : Math.round((n + 1e-9) * 100) / 100; }

/** Calcula os quatro componentes e a nota final de um aluno. `soPublicados` restringe aos quesitos publicados. */
function calcularAluno_(estado, aluno, soPublicados) {
  var somaPeso = 0, somaNota = 0, avaliados = 0, total = 0, comSituacao = 0, noPrazo = 0;
  var somaPart = 0, qtdPart = 0, porQuesito = {};
  estado.quesitos.forEach(function (q) {
    if (!q.ativo || q.peso <= 0) return;
    if (soPublicados && !q.publicado) return;
    total++;
    var alvo = q.escopo === 'individual' ? 'A' + aluno.id : 'P' + aluno.projeto;
    var l = estado.notas[q.id + '|' + alvo];
    var base = notaEfetiva_(l), p = null, fator = 1;
    if (q.escopo === 'grupo') {
      p = participacaoDecidida_(estado, q.id, aluno.id);
      fator = fatorParticipacao_(estado, p);
      if (p !== null) { somaPart += p; qtdPart++; }
    }
    var n = base === null ? null : base * fator;
    porQuesito[q.id] = { base: arred_(base), participacao: p, fator: arred_(fator), nota: arred_(n) };
    if (n !== null) { somaPeso += q.peso; somaNota += q.peso * n; avaliados++; }
    if (l && l.situacao) { comSituacao++; if (l.situacao === 'no_prazo') noPrazo++; }
  });
  var comp = {
    entregas: somaPeso > 0 ? somaNota / somaPeso : null,
    participacao: aluno.participacao !== null ? aluno.participacao : (qtdPart > 0 ? somaPart / qtdPart : null),
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
    quesitosAvaliados: avaliados, quesitosTotal: total, faltando: faltando, porQuesito: porQuesito,
    participacaoAutomatica: aluno.participacao === null && qtdPart > 0,
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
    pesos: e.pesos, finalPublicado: e.finalPublicado, regra: e.regra, faixas: e.faixas,
    quesitos: e.quesitos.map(function (q) { return { id: q.id, nome: q.nome, peso: q.peso, prazo: q.prazo, escopo: q.escopo, publicado: q.publicado, ativo: q.ativo, pares: q.pares }; }),
    participacoes: Object.keys(e.partic).map(function (k) { return { quesito: k.split('|')[0], aluno: k.split('|')[1], valor: e.partic[k].valor }; }),
    pares: e.pares.map(function (x) { return { quesito: x.quesito, avaliador: x.avaliador, avaliado: x.avaliado, valor: x.valor, comentario: x.comentario }; }),
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
      aba.appendRow([id, seguro_(nome), txt_(peso), prazo, escopo, '', 'sim', '']);
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
    var hist = [];
    if (de !== para || (atual ? atual.comentario : '') !== comentario) hist.push([q.nome, alvo, de, para]);
    if (q.escopo === 'grupo' && req.participacoes && req.participacoes.length) {
      var projeto = Number(alvo.slice(1)), abaP = abaNotas_('participacao', CAB_PARTICIPACAO);
      req.participacoes.forEach(function (d) {
        var a = e.alunos.filter(function (x) { return x.id === String(d.aluno); })[0];
        if (!a || a.projeto !== projeto) throw new Error('Participação: aluno fora deste grupo.');
        var v = notaValida_(d.valor, a.nome + ' — participação', 10);
        var ant = e.partic[q.id + '|' + a.id];
        if ((ant ? ant.valor : null) === v) return;
        var lp = [q.id, a.id, txt_(v), usuario.nome, new Date().toISOString()];
        if (ant) abaP.getRange(ant.linha, 1, 1, lp.length).setValues([lp]);
        else { abaP.appendRow(lp); e.partic[q.id + '|' + a.id] = { linha: abaP.getLastRow(), valor: v }; }
        hist.push(['participação em ' + q.nome, 'A' + a.id + ' ' + a.nome, txt_(ant ? ant.valor : null), txt_(v)]);
      });
    }
    historicoNotas_(usuario, hist);
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

/**
 * Importa a lista da turma: uma linha por aluno, "Nome; número do projeto; e-mail do login".
 * O e-mail é opcional. Quem já existe (mesmo nome e projeto) não é duplicado; só recebe o e-mail, se vier um novo.
 */
function importarAlunos_(usuario, req) {
  exigirDocente_(usuario);
  var linhas = String(req.texto || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  if (!linhas.length) throw new Error('Cole a lista com uma linha por aluno.');
  var lidos = [];
  linhas.forEach(function (l, i) {
    var partes = l.split(/[;\t]/).map(function (x) { return x.trim(); });
    if (partes.length === 1) { var m = /^(.*),\s*#?(\d{1,2})$/.exec(l); if (m) partes = [m[1].trim(), m[2]]; }
    var projeto = String(partes[1] || '').replace(/^#/, '');
    var email = String(partes[2] || '').toLowerCase();
    if (!partes[0] || !/^\d{1,2}$/.test(projeto)) throw new Error('Linha ' + (i + 1) + ' fora do formato "Nome; número do projeto; e-mail": ' + l.slice(0, 60));
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Linha ' + (i + 1) + ': e-mail inválido (' + email.slice(0, 60) + ').');
    lidos.push({ nome: partes[0], projeto: Number(projeto), email: email });
  });
  var e = lerEstadoNotas_();
  var chave = function (nome, projeto) { return nome.toLowerCase().replace(/\s+/g, ' ') + '|' + projeto; };
  var existentes = {};
  e.alunos.forEach(function (a) { existentes[chave(a.nome, a.projeto)] = a; });
  var salvar = [], novos = 0, atualizados = 0;
  lidos.forEach(function (n) {
    var k = chave(n.nome, n.projeto), a = existentes[k];
    if (a === true) return;                       // repetido dentro da própria lista
    if (!a) { salvar.push(n); novos++; existentes[k] = true; return; }
    if (n.email && n.email !== a.email) {
      salvar.push({ id: a.id, nome: a.nome, projeto: a.projeto, email: n.email, participacao: txt_(a.participacao), frequencia: txt_(a.frequencia), ativo: a.ativo });
      atualizados++;
    }
    existentes[k] = true;
  });
  var r = salvar.length ? salvarAlunos_(usuario, { alunos: salvar }) : estadoNotasDocente_(usuario);
  r.importados = novos;
  r.atualizados = atualizados;
  return r;
}

/** Abre ou fecha, para os alunos, a avaliação de participação (a própria e a dos colegas) de uma atividade. */
function abrirPares_(usuario, req) {
  exigirDocente_(usuario);
  return comTrava_(function () {
    var e = lerEstadoNotas_();
    var q = e.quesitos.filter(function (x) { return x.id === String(req.quesito); })[0];
    if (!q) throw new Error('Avaliação não encontrada.');
    if (q.escopo !== 'grupo') throw new Error('Só atividades de grupo têm avaliação de participação.');
    abaNotas_('quesitos', CAB_QUESITOS).getRange(q.linha, 8).setValue(req.abrir ? 'sim' : '');
    historicoNotas_(usuario, [['avaliação de participação', q.nome, '', req.abrir ? 'aberta aos alunos' : 'fechada']]);
    return estadoNotasDocente_(usuario);
  });
}

function salvarRegra_(usuario, req) {
  exigirDocente_(usuario);
  if (REGRAS.indexOf(req.regra) < 0) throw new Error('Regra desconhecida.');
  var f = req.faixas || {}, novas = {};
  Object.keys(FAIXAS_PADRAO).forEach(function (k) {
    var v = notaValida_(f[k], 'Faixas', k.indexOf('Pct') > 0 ? 100 : 10);
    novas[k] = v === null ? FAIXAS_PADRAO[k] : v;
  });
  if (novas.mediaMin > novas.cheiaMin) throw new Error('Faixas: o início da faixa intermediária não pode ser maior que o da faixa cheia.');
  if (novas.baixaPct > novas.mediaPct) throw new Error('Faixas: a faixa baixa não pode valer mais que a intermediária.');
  return comTrava_(function () {
    var antes = lerConfigNotas_();
    gravarConfig_('regra_participacao', req.regra);
    Object.keys(novas).forEach(function (k) { gravarConfig_('faixa_' + k, novas[k]); });
    historicoNotas_(usuario, [['regra de participação', '', antes.regra + ' ' + JSON.stringify(antes.faixas), req.regra + ' ' + JSON.stringify(novas)]]);
    return estadoNotasDocente_(usuario);
  });
}

/** Aluno informa a própria participação e a dos colegas de grupo em uma atividade aberta. */
function avaliarParticipacao_(usuario, req) {
  limitar_(usuario);
  var comentario = texto_(req.comentario, CONFIG.MAX_CAMPO);
  return comTrava_(function () {
    var e = lerEstadoNotas_();
    var eu = e.alunos.filter(function (a) { return a.ativo && a.email && a.email === usuario.email; })[0];
    if (!eu) throw new Error('Seu login ainda não está ligado ao seu nome na lista da turma.');
    var q = e.quesitos.filter(function (x) { return x.id === String(req.quesito); })[0];
    if (!q || !q.ativo || q.escopo !== 'grupo' || !q.pares || q.publicado) throw new Error('A avaliação de participação desta atividade não está aberta.');
    var itens = req.notas || [];
    if (!itens.length) throw new Error('Informe ao menos a sua própria participação.');
    var aba = abaNotas_('avaliacoes_pares', CAB_PARES), agora = new Date().toISOString(), vistos = {};
    itens.forEach(function (d) {
      var alvo = e.alunos.filter(function (a) { return a.ativo && a.id === String(d.aluno) && a.projeto === eu.projeto; })[0];
      if (!alvo) throw new Error('Você só pode avaliar integrantes do seu grupo.');
      if (vistos[alvo.id]) return;
      vistos[alvo.id] = true;
      var v = notaValida_(d.valor, alvo.nome, 10);
      if (v === null) throw new Error('Dê uma nota de 0 a 10 para ' + (alvo.id === eu.id ? 'você' : alvo.nome) + '.');
      var ant = e.pares.filter(function (x) { return x.quesito === q.id && x.avaliador === eu.id && x.avaliado === alvo.id; })[0];
      var linha = [q.id, eu.id, alvo.id, txt_(v), alvo.id === eu.id ? seguro_(comentario) : '', agora];
      if (ant) aba.getRange(ant.linha, 1, 1, linha.length).setValues([linha]);
      else aba.appendRow(linha);
    });
    return minhasNotas_(usuario);
  });
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

/** Visão do aluno: só as próprias notas publicadas, e as avaliações de participação que ele pode preencher. */
function minhasNotas_(usuario) {
  var e = lerEstadoNotas_();
  var aluno = e.alunos.filter(function (a) { return a.ativo && a.email && a.email === usuario.email; })[0];
  if (!aluno) return { minhas: { vinculado: false } };
  var calc = calcularAluno_(e, aluno, false);
  var avaliacoes = [], abertas = [];
  var colegas = e.alunos.filter(function (a) { return a.ativo && a.projeto === aluno.projeto; })
    .sort(function (a, b) { return a.id === aluno.id ? -1 : (b.id === aluno.id ? 1 : (a.nome < b.nome ? -1 : 1)); })
    .map(function (a) { return { id: a.id, nome: a.nome, eu: a.id === aluno.id }; });
  e.quesitos.forEach(function (q) {
    if (!q.ativo) return;
    if (q.publicado) {
      var l = e.notas[q.id + '|' + (q.escopo === 'individual' ? 'A' + aluno.id : 'P' + aluno.projeto)];
      var d = calc.porQuesito[q.id] || {};
      avaliacoes.push({ nome: q.nome, peso: q.peso, prazo: q.prazo, escopo: q.escopo, nota: d.nota === undefined ? null : d.nota,
        notaGrupo: q.escopo === 'grupo' ? d.base : null, participacao: d.participacao === undefined ? null : d.participacao, fator: d.fator === undefined ? 1 : d.fator,
        situacao: l ? l.situacao : '', comentario: l ? l.comentario : '' });
    } else if (q.escopo === 'grupo' && q.pares) {
      var dadas = {}, comentario = '';
      e.pares.forEach(function (x) {
        if (x.quesito !== q.id || x.avaliador !== aluno.id) return;   // só o que ESTE aluno informou
        dadas[x.avaliado] = x.valor;
        if (x.avaliado === aluno.id) comentario = x.comentario;
      });
      abertas.push({ quesito: q.id, nome: q.nome, prazo: q.prazo, dadas: dadas, comentario: comentario,
        respondida: colegas.every(function (c) { return dadas[c.id] !== undefined && dadas[c.id] !== null; }) });
    }
  });
  var out = { vinculado: true, nome: aluno.nome, projeto: aluno.projeto, avaliacoes: avaliacoes, abertas: abertas, colegas: colegas, finalPublicado: e.finalPublicado };
  if (e.finalPublicado) { delete calc.porQuesito; out.final = calc; out.pesos = e.pesos; }
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
    projetos.push(p);
  });
  return projetos;
}
//</linhasParaProjetos>

// ============================ FUNÇÕES ADMINISTRATIVAS & DIAGNÓSTICO ============================

/**
 * Diagnóstico completo do envio de e-mails:
 * 1. Verifica se a aba 'membros' existe e lista a contagem de destinatários ativos;
 * 2. Força a solicitação de autorização do GmailApp caso ainda não concedida;
 * 3. Envia e-mail de prova para o endereço docente.
 */
function diagnosticoEnvioEmail() {
  var ss = controle_();
  var abaMembros = ss.getSheetByName('membros');
  if (!abaMembros) {
    Logger.log('❌ ERRO: Aba membros não encontrada!');
    return;
  }
  var membros = abaMembros.getDataRange().getValues();
  Logger.log('📊 Total de linhas na aba membros: ' + membros.length);

  var ativos = [];
  for (var i = 1; i < membros.length; i++) {
    var email = String(membros[i][0] || '').trim();
    var status = String(membros[i][4] || '').trim();
    if (status === 'ativo' && email.indexOf('@') > 0) {
      ativos.push(email);
    }
  }
  Logger.log('👥 Total de membros ATIVOS com e-mail: ' + ativos.length);
  Logger.log('Destinatários ativos: ' + JSON.stringify(ativos));

  var emailDocente = CONFIG.DOCENTES[CONFIG.DOCENTES.length - 1]; // chameoandre@gmail.com
  Logger.log('Tentando enviar e-mail de teste para ' + emailDocente + '...');
  GmailApp.sendEmail(
    emailDocente,
    '[PI-2 DIAGNÓSTICO] Teste de autorização de e-mail',
    'Olá André!\n\nSe você está lendo isto, o GmailApp do Apps Script está 100% autorizado e apto a disparar notificações.\n\nTotal de membros ativos cadastrados na aba membros: ' + ativos.length
  );
  Logger.log('✅ SUCESSO! E-mail de teste enviado para ' + emailDocente + '.');
}

/**
 * Importa/sincroniza em lote os 33 estudantes da turma INF-2024 (dados extraídos do SIGAA)
 * diretamente para a aba 'membros' da planilha de controle privada com status 'ativo'.
 */
function importarTurmaSIGAA() {
  var ss = controle_();
  var aba = ss.getSheetByName('membros');
  if (!aba) throw new Error('Aba membros não encontrada.');

  var turma = [
    { email: 'lucaspachequinhoferreira@gmail.com', nome: 'LUCAS PACHECO FERREIRA', proj: '1' },
    { email: 'pa.leopoldino@gmail.com', nome: 'BERNARDO LEOPOLDINO NUNES', proj: '1' },
    { email: 'henriquecardosocandidoancelmo@gmail.com', nome: 'HENRIQUE CARDOSO CANDIDO ANCELMO', proj: '1' },
    { email: 'a0680028@gmail.com', nome: 'ANDERSON MIGUEL DE OLIVEIRA ZANATTA', proj: '2' },
    { email: 'eluneyemasuazo2@gmail.com', nome: 'ELUNEY EMA SUAZO', proj: '2' },
    { email: 'joao.brasil.crescencio@gmail.com', nome: 'JOÃO PEDRO BRASIL CRESCENCIO', proj: '2' },
    { email: 'danirduarte@gmail.com', nome: 'RODRIGO DUARTE ZOMER', proj: '2' },
    { email: 'dublegextreme@gmail.com', nome: 'ARTHUR DYLAN EUFRAZIO FONSECA', proj: '3' },
    { email: 'lucasfmedias@gmail.com', nome: 'LUCAS SEHN FRITSCH', proj: '3' },
    { email: 'pfachinisoares@gmail.com', nome: 'PIETRO FACHINI SOARES', proj: '3' },
    { email: 'felipe.lr06@aluno.ifsc.edu.br', nome: 'FELIPE LUIS RODRIGUEZ AMADO', proj: '4' },
    { email: 'martinandreas.lti@gmail.com', nome: 'MARTIN ANDREAS HEMMER LAVRATTI', proj: '4' },
    { email: 'janainaferreira_edfisica@hotmail.com', nome: 'PETRUS FERREIRA SILVA', proj: '4' },
    { email: 'dudugamesmattioni@gmail.com', nome: 'EDUARDO SCHUQUEL MATTIONI', proj: '5' },
    { email: 'ricaohgp@gmail.com', nome: 'HENRIQUE GAMA PEREIRA', proj: '5' },
    { email: 'nicolassilveirateixeira@gmail.com', nome: 'NÍCOLAS SILVEIRA TEIXEIRA', proj: '5' },
    { email: 'gutomacacudavid@gmail.com', nome: 'AUGUSTO DAVID MACHADO', proj: '6' },
    { email: 'mariacabrunhosa@gmail.com', nome: 'MARIA CECILIA ABRUNHOSA DA SILVA NOVAES DE SOUZA', proj: '6' },
    { email: 'peerinhohdx77@gmail.com', nome: 'PEDRO HENRIQUE VIEIRA COELHO', proj: '6' },
    { email: 'rcrosileneraul@gmail.com', nome: 'RAUL CASTRO ANDRE', proj: '6' },
    { email: 'luisanarvazblankenburg@gmail.com', nome: 'LUISA NARVAZ BLANKENBURG', proj: '7' },
    { email: 'beatrizgoncalves1212@hotmail.com', nome: 'BEATRIZ DA ROSA GONCALVES', proj: '8' },
    { email: 'dob_1990@hotmail.com', nome: 'LAURA OBERDORFER REVEILEAU MEIRELLES', proj: '8' },
    { email: 'orianaavrilcarrasco@gmail.com', nome: 'ORIANA AVRIL CARRASCO', proj: '8' },
    { email: 'sophiegf0608@gmail.com', nome: 'SOPHIE GONCALVES FAUSTINO', proj: '8' },
    { email: 'email.victoria6@gmail.com', nome: 'VICTORIA ARAUJO ALEXANDRE', proj: '8' },
    { email: 'joaocontreirap@gmail.com', nome: 'JOAO CONTREIRA GONCALVES', proj: '9' },
    { email: 'preussmarilise@gmail.com', nome: 'NATHAN PREUSS WOTTAWA', proj: '9' },
    { email: 'pedroenrik43@gmail.com', nome: 'PEDRO ENRIK MARTINS DA ROSA', proj: '9' },
    { email: 'freitasvaleria23@gmail.com', nome: 'ARIANY FREITAS DA SILVA', proj: '10' },
    { email: 'cauapassosdeabreu667@gmail.com', nome: 'CAUA PASSOS DE ABREU', proj: '10' },
    { email: 'tenzobreno@gmail.com', nome: 'ENZO BRENO TORQUATO DEVES', proj: '10' },
    { email: 'joelpdr475@gmail.com', nome: 'JOEL JORGE TEIXEIRA FILHO', proj: '11' }
  ];

  var dados = aba.getDataRange().getValues();
  var existentes = dados.map(function (l) { return String(l[0]).toLowerCase().trim(); });
  var agora = new Date().toISOString();
  var count = 0;

  turma.forEach(function (aluno) {
    if (existentes.indexOf(aluno.email.toLowerCase().trim()) === -1) {
      aba.appendRow([aluno.email, aluno.nome, aluno.proj, 'aluno', 'ativo', agora, 'SIGAA']);
      count++;
    }
  });

  Logger.log('Concluído! Alunos cadastrados na aba membros: ' + count);
}

/**
 * Reenvia a notificação da última demanda registrada com o template HTML completo para todos os destinatários.
 */
function reenviarEmailUltimaDemanda() {
  var ss = controle_();
  var aba = ss.getSheetByName('demandas');
  if (!aba || aba.getLastRow() < 2) throw new Error('Nenhuma demanda encontrada.');

  var ultimaLinha = aba.getLastRow();
  var dados = aba.getRange(ultimaLinha, 1, 1, 13).getValues()[0];

  var dem = {
    id: dados[0],
    projeto: dados[2],
    titulo: dados[3],
    descricao: dados[4],
    prazo: dados[5],
    criadoPor: dados[6],
    pontos: dados[11],
    criterios: dados[12]
  };

  Logger.log('Reenviando e-mail HTML da última demanda: ' + dem.titulo + ' [ID: ' + dem.id + ']');
  var total = enviarNotificacaoDemandaCustom_(dem, 'nova', '', dem.criadoPor);
  Logger.log('Concluído! E-mails HTML enviados para ' + total + ' estudantes.');
}


