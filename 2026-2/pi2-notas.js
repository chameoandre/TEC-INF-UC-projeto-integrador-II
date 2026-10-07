/* PI-II — painel de notas (docentes) e "Minhas notas" (alunos).
 *
 * Todo cálculo é feito no servidor (apps-script/Code.gs, seção NOTAS); esta página só
 * exibe o que ele devolve e envia os lançamentos. Notas nunca entram no GET público.
 */
(function () {
  'use strict';
  var PI2 = window.PI2;
  if (!PI2 || !PI2.interno) return;
  var I = PI2.interno, esc = I.esc, $ = I.$, $$ = I.$$;

  var N = null;            // estado devolvido pelo servidor
  var aba = 'entregas';
  var SIT = { no_prazo: 'no prazo', atrasado: 'atrasado', nao_entregue: 'não entregue' };
  var COMP = { entregas: 'Entregas', participacao: 'Participação', frequencia: 'Frequência', pontualidade: 'Pontualidade' };

  // Arredonda meio para cima (8,85 vira 8,9); toFixed sozinho erraria por causa do ponto flutuante.
  function fmt(n) { return n === null || n === undefined || n === '' ? '—' : (Math.round((Number(n) + 1e-9) * 10) / 10).toFixed(1).replace('.', ','); }
  function campo(n) { return n === null || n === undefined ? '' : String(n).replace('.', ','); }
  function prazoBr(p) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p || ''); return m ? m[3] + '/' + m[2] : ''; }
  function projetos() {
    var ids = {};
    PI2.bruto.forEach(function (p) { ids[p.id] = p.title; });
    N.alunos.forEach(function (a) { if (!(a.projeto in ids)) ids[a.projeto] = ''; });
    return Object.keys(ids).map(Number).sort(function (a, b) { return a - b; }).map(function (id) { return { id: id, titulo: ids[id] }; });
  }
  function rotuloProjeto(p) { return '#' + I.doisDigitos(p.id) + (p.titulo ? ' ' + esc(p.titulo) : ''); }
  function lancamento(q, alvo) { return N.lancamentos.filter(function (l) { return l.quesito === q && l.alvo === alvo; })[0] || null; }
  function quesitos(escopo) { return N.quesitos.filter(function (q) { return q.ativo && q.escopo === escopo; }); }
  function chamar(acao, dados) { return I.api(acao, dados).then(function (r) { if (r.notas) N = r.notas; return r; }); }

  // ------------------------------------------------------------------
  // Entrada pelo cabeçalho
  // ------------------------------------------------------------------
  PI2.ganchosAuth.push(function (el, u) {
    if (!u || u.status !== 'ativo') return;
    var sair = $('#pi2-btn-sair', el), b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-outline';
    if (u.papel === 'docente') { b.id = 'pi2-btn-notas'; b.innerHTML = '<i class="fa-solid fa-clipboard-list"></i> Notas'; b.onclick = abrirPainel; }
    else { b.id = 'pi2-btn-minhas'; b.innerHTML = '<i class="fa-solid fa-clipboard-list"></i> Minhas notas'; b.onclick = abrirMinhas; }
    el.insertBefore(b, sair);
  });

  function abrirPainel() {
    I.abrirModal(I.cabecalho('Notas da turma', 'Carregando…'), true);
    chamar('notasPainel').then(desenhar).catch(function (e) { I.abrirModal(I.cabecalho('Notas da turma', esc(e.message)), true); });
  }
  PI2.abrirNotas = abrirPainel;

  function desenhar() {
    var abas = [['entregas', 'Entregas por grupo'], ['alunos', 'Alunos'], ['fechamento', 'Fechamento'], ['config', 'Avaliações e pesos']];
    var corpo = I.abrirModal(
      I.cabecalho('Notas da turma', 'Visível só para docentes. Os alunos veem as próprias notas depois que você publicar.') +
      '<div class="pi2-tabs" role="tablist">' + abas.map(function (a) {
        return '<button class="pi2-tab" type="button" role="tab" data-aba="' + a[0] + '" aria-selected="' + (aba === a[0]) + '">' + a[1] + '</button>';
      }).join('') + '</div><div id="pi2-notas-corpo"></div>', true);
    $$('.pi2-tab', corpo).forEach(function (b) { b.onclick = function () { aba = b.dataset.aba; desenhar(); }; });
    ({ entregas: telaEntregas, alunos: telaAlunos, fechamento: telaFechamento, config: telaConfig })[aba]($('#pi2-notas-corpo', corpo));
  }

  function celula(q, alvo) {
    var l = lancamento(q.id, alvo);
    var nota = l ? (l.nota !== null ? l.nota : (l.situacao === 'nao_entregue' ? 0 : null)) : null;
    return '<button type="button" class="pi2-celula ' + (nota === null ? 'vazia' : '') + '" data-q="' + esc(q.id) + '" data-alvo="' + esc(alvo) + '" title="' + esc(l && l.comentario ? l.comentario : 'Lançar nota') + '">' +
      (nota === null ? 'lançar' : fmt(nota)) + (l && l.situacao ? '<small class="sit-' + l.situacao + '">' + SIT[l.situacao] + '</small>' : '') + '</button>';
  }
  function cabecalhoQuesito(q) {
    return '<th scope="col">' + esc(q.nome) + '<small>peso ' + campo(q.peso) + (q.prazo ? ' • até ' + prazoBr(q.prazo) : '') + '</small>' +
      '<span class="pi2-selo ' + (q.publicado ? 'pub' : '') + '">' + (q.publicado ? 'publicada' : 'rascunho') + '</span>' +
      (q.pares && !q.publicado ? ' <span class="pi2-selo parcial" title="Os alunos podem avaliar a própria participação e a dos colegas">participação aberta</span>' : '') + '</th>';
  }
  var REGRA = { faixas: 'por faixas', proporcional: 'proporcional', amortecida: 'amortecida' };
  function regraTexto() {
    var f = N.faixas;
    if (N.regra === 'proporcional') return 'nota do grupo × participação ÷ 10';
    if (N.regra === 'amortecida') return 'metade da nota do grupo é garantida; a outra metade acompanha a participação';
    return 'participação de ' + campo(f.cheiaMin) + ' a 10 mantém a nota do grupo; de ' + campo(f.mediaMin) + ' até abaixo de ' + campo(f.cheiaMin) + ' fica com ' + campo(f.mediaPct) + '%; abaixo de ' + campo(f.mediaMin) + ' fica com ' + campo(f.baixaPct) + '%; zero zera';
  }
  function media(lista) { return lista.length ? lista.reduce(function (t, x) { return t + x; }, 0) / lista.length : null; }

  /** Bloco "Participação dos integrantes" do editor de uma atividade de grupo. */
  function blocoParticipacao(q, projeto) {
    var grupo = N.alunos.filter(function (a) { return a.ativo && a.projeto === projeto; });
    if (!grupo.length) return '<h3 class="pi2-h">Participação dos integrantes</h3><div class="pi2-vazio">Cadastre os alunos deste grupo na aba “Alunos” para diferenciar a participação.</div>';
    var nome = function (id) { var a = N.alunos.filter(function (x) { return x.id === id; })[0]; return a ? a.nome.split(' ')[0] : '?'; };
    var linhas = grupo.map(function (a) {
      var doQ = N.pares.filter(function (x) { return x.quesito === q.id && x.avaliado === a.id && x.valor !== null; });
      var auto = doQ.filter(function (x) { return x.avaliador === a.id; })[0];
      var colegas = doQ.filter(function (x) { return x.avaliador !== a.id; });
      var med = media(colegas.map(function (x) { return x.valor; }));
      var dec = N.participacoes.filter(function (x) { return x.quesito === q.id && x.aluno === a.id; })[0];
      var calc = (N.fechamento.filter(function (f) { return f.id === a.id; })[0] || { porQuesito: {} }).porQuesito[q.id];
      return '<tr><td>' + esc(a.nome) + (auto && auto.comentario ? '<br><small>“' + esc(auto.comentario) + '”</small>' : '') + '</td>' +
        '<td>' + (auto ? fmt(auto.valor) : '—') + '</td>' +
        '<td>' + (med === null ? '—' : fmt(med) + '<br><small>' + colegas.map(function (x) { return esc(nome(x.avaliador)) + ': ' + fmt(x.valor); }).join(' • ') + '</small>') + '</td>' +
        '<td><input class="pi2-num" type="text" inputmode="decimal" name="part-' + esc(a.id) + '" data-sugestao="' + (med !== null ? campo(Math.round(med * 10) / 10) : (auto ? campo(auto.valor) : '')) + '" aria-label="Participação de ' + esc(a.nome) + '" value="' + esc(campo(dec ? dec.valor : null)) + '" placeholder="10"></td>' +
        '<td class="pi2-final">' + (calc && calc.nota !== null ? fmt(calc.nota) + (calc.fator < 1 ? '<br><small>' + Math.round(calc.fator * 100) + '% da nota</small>' : '') : '—') + '</td></tr>';
    }).join('');
    return '<h3 class="pi2-h pi2-secao-titulo"><span>Participação dos integrantes</span><span>' +
      (q.publicado ? '' : '<button class="pi2-btn mini" type="button" id="pi2-n-pares">' + (q.pares ? 'Fechar avaliação dos alunos' : 'Abrir para os alunos avaliarem') + '</button> ') +
      '<button class="pi2-btn mini" type="button" id="pi2-n-sugerir">Usar o que os colegas indicaram</button></span></h3>' +
      '<p class="pi2-modal-sub">O que os alunos informam é só referência: a nota muda apenas com o valor que você colocar na coluna “Vale”. Vazio conta como participação plena. Regra atual (' + REGRA[N.regra] + '): ' + esc(regraTexto()) + '.</p>' +
      '<div class="pi2-table-wrap"><table class="pi2-table pi2-grade"><thead><tr><th scope="col">Integrante</th><th scope="col">Autoavaliação</th><th scope="col">Média dos colegas</th><th scope="col">Vale<small>0 a 10</small></th><th scope="col">Nota do aluno</th></tr></thead><tbody>' + linhas + '</tbody></table></div>';
  }
  function ligarCelulas(raiz) {
    $$('.pi2-celula', raiz).forEach(function (b) { b.onclick = function () { editarNota(b.dataset.q, b.dataset.alvo); }; });
  }

  // ------------------------------------------------------------------
  // Entregas por grupo
  // ------------------------------------------------------------------
  function telaEntregas(el) {
    var qs = quesitos('grupo');
    if (!qs.length) { el.innerHTML = '<div class="pi2-vazio">Nenhuma avaliação de grupo ativa. Crie uma em “Avaliações e pesos”.</div>'; return; }
    el.innerHTML = '<p class="pi2-modal-sub">Clique em uma célula para lançar a nota (0 a 10), marcar se a entrega foi no prazo e deixar um comentário para o grupo.</p>' +
      '<div class="pi2-table-wrap"><table class="pi2-table pi2-grade"><thead><tr><th scope="col">Projeto</th>' + qs.map(cabecalhoQuesito).join('') + '</tr></thead><tbody>' +
      projetos().map(function (p) {
        return '<tr><td><strong>' + rotuloProjeto(p) + '</strong></td>' + qs.map(function (q) { return '<td>' + celula(q, 'P' + p.id) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    ligarCelulas(el);
  }

  function editarNota(qid, alvo) {
    var q = N.quesitos.filter(function (x) { return x.id === qid; })[0];
    var l = lancamento(qid, alvo) || { nota: null, situacao: '', comentario: '' };
    var titulo, evid = '';
    if (alvo.charAt(0) === 'P') {
      var id = Number(alvo.slice(1)), p = I.projetoBruto(id);
      titulo = '#' + I.doisDigitos(id) + (p ? ' ' + esc(p.title) : '');
      if (p) {
        var links = [['Artigo (Overleaf)', p.overleaf], ['GitHub', p.github], ['Pitch', p.pitch], ['Diagrama', p.canva]].filter(function (x) { return I.urlSegura(x[1]); });
        var regs = I.registrosDo(id).filter(function (r) { return r.tipo !== 'legado'; }).slice(0, 3);
        evid = '<h3 class="pi2-h">O que o grupo entregou</h3>' +
          (links.length ? '<div class="pi2-evidencias">' + links.map(function (x) { return '<a class="pi2-btn mini" href="' + esc(I.urlSegura(x[1])) + '" target="_blank" rel="noopener">' + x[0] + '</a>'; }).join('') + '</div>' : '<div class="pi2-vazio">Nenhum link cadastrado na ficha.</div>') +
          (!I.pendente(p.relatedWorks) ? '<div class="pi2-item"><div class="pi2-item-head"><span class="pi2-tag">Trabalhos relacionados</span></div><div class="pi2-item-text">' + esc(String(p.relatedWorks).slice(0, 500)) + '</div></div>' : '') +
          (regs.length ? '<div class="pi2-timeline">' + regs.map(function (r) {
            return '<div class="pi2-item"><div class="pi2-item-head"><strong>' + esc(r.autor) + '</strong><span>' + esc(I.dataBr(r.data)) + '</span></div><div class="pi2-item-text">' + esc(String(r.texto).slice(0, 400)) + '</div></div>';
          }).join('') + '</div>' : '');
      }
    } else {
      var a = N.alunos.filter(function (x) { return 'A' + x.id === alvo; })[0];
      titulo = a ? esc(a.nome) + ' (#' + I.doisDigitos(a.projeto) + ')' : '';
    }
    var ehGrupo = alvo.charAt(0) === 'P', projetoAlvo = ehGrupo ? Number(alvo.slice(1)) : 0;
    var corpo = I.abrirModal(I.cabecalho(esc(q.nome), titulo + ' • peso ' + campo(q.peso) + (q.prazo ? ' • prazo ' + prazoBr(q.prazo) : '')) + evid +
      '<form class="pi2-form" style="margin-top:1rem"><div class="pi2-row">' +
      '<div class="pi2-field"><label for="pi2-n-nota">Nota (0 a 10)</label><input id="pi2-n-nota" name="nota" type="text" inputmode="decimal" autocomplete="off" value="' + esc(campo(l.nota)) + '"><span class="pi2-hint">Deixe vazio para ainda não avaliar.</span></div>' +
      '<div class="pi2-field"><label for="pi2-n-sit">Entrega</label><select id="pi2-n-sit" name="situacao">' +
      [['', 'Não marcar'], ['no_prazo', 'No prazo'], ['atrasado', 'Atrasada'], ['nao_entregue', 'Não entregue']].map(function (o) {
        return '<option value="' + o[0] + '"' + (l.situacao === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select><span class="pi2-hint">Conta para a pontualidade. “Não entregue” sem nota vale zero.</span></div></div>' +
      '<div class="pi2-field"><label for="pi2-n-com">Comentário (o aluno vê depois da publicação)</label><textarea id="pi2-n-com" class="pi2-curto" name="comentario" maxlength="600">' + esc(l.comentario) + '</textarea></div>' +
      (ehGrupo ? blocoParticipacao(q, projetoAlvo) : '') +
      '<div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn" type="button" id="pi2-n-voltar">Voltar</button><button class="pi2-btn primario" type="submit">Salvar</button></div></form>', true);
    $('#pi2-n-voltar', corpo).onclick = desenhar;
    var sugerir = $('#pi2-n-sugerir', corpo);
    if (sugerir) sugerir.onclick = function () {
      var n = 0;
      $$('input[data-sugestao]', corpo).forEach(function (i) { if (i.dataset.sugestao) { i.value = i.dataset.sugestao; n++; } });
      I.aviso(n ? 'Valores preenchidos. Revise e clique em Salvar.' : 'Nenhum aluno avaliou esta atividade ainda.', n ? 'success' : 'warning');
    };
    var pares = $('#pi2-n-pares', corpo);
    if (pares) pares.onclick = function () {
      pares.disabled = true;
      chamar('abrirPares', { quesito: qid, abrir: !q.pares }).then(function () {
        I.aviso(q.pares ? 'Avaliação dos alunos fechada.' : 'Aberta: os alunos já podem avaliar em “Minhas notas”.'); editarNota(qid, alvo);
      }).catch(function (e) { pares.disabled = false; I.aviso(e.message, 'warning'); });
    };
    I.aoEnviar($('form', corpo), function (fd) {
      var participacoes = [];
      $$('input[name^="part-"]', corpo).forEach(function (i) { participacoes.push({ aluno: i.name.slice(5), valor: i.value.trim() }); });
      return chamar('lancarNota', { quesito: qid, alvo: alvo, nota: fd.get('nota'), situacao: fd.get('situacao'), comentario: fd.get('comentario'), participacoes: participacoes })
        .then(function () { I.aviso('Salvo.'); desenhar(); });
    });
  }

  // ------------------------------------------------------------------
  // Alunos: cadastro, participação, frequência e avaliações individuais
  // ------------------------------------------------------------------
  function telaAlunos(el) {
    var qi = quesitos('individual');
    var lista = '<datalist id="pi2-emails">' + N.membros.map(function (m) { return '<option value="' + esc(m.email) + '">' + esc(m.nome) + '</option>'; }).join('') + '</datalist>';
    var tabela = '';
    if (N.alunos.length) {
      tabela = '<form id="pi2-form-alunos"><div class="pi2-table-wrap"><table class="pi2-table pi2-grade"><thead><tr><th scope="col">Aluno</th><th scope="col">Proj.</th>' +
        '<th scope="col">E-mail do login<small>liga o aluno às notas dele</small></th><th scope="col">Participação<small>0 a 10</small></th><th scope="col">Frequência<small>% de presença</small></th>' +
        qi.map(cabecalhoQuesito).join('') + '<th scope="col">Ativo</th></tr></thead><tbody>' +
        projetos().map(function (p) {
          var doGrupo = N.alunos.filter(function (a) { return a.projeto === p.id; });
          if (!doGrupo.length) return '';
          return '<tr class="pi2-grupo"><td colspan="3">' + rotuloProjeto(p) + '</td><td colspan="' + (3 + qi.length) + '">' +
            '<input class="pi2-num" type="text" inputmode="decimal" aria-label="Participação para todo o grupo ' + p.id + '" data-grupo="' + p.id + '" placeholder="0–10"> ' +
            '<button class="pi2-btn mini" type="button" data-aplicar="' + p.id + '">aplicar ao grupo</button></td></tr>' +
            doGrupo.map(function (a) {
              return '<tr data-aluno="' + esc(a.id) + '">' +
                '<td><input class="pi2-nome" type="text" name="nome" aria-label="Nome" value="' + esc(a.nome) + '"></td>' +
                '<td><input class="pi2-num" type="text" inputmode="numeric" name="projeto" aria-label="Projeto de ' + esc(a.nome) + '" value="' + a.projeto + '"></td>' +
                '<td><input class="pi2-email" type="email" name="email" list="pi2-emails" aria-label="E-mail de ' + esc(a.nome) + '" value="' + esc(a.email) + '"></td>' +
                '<td><input class="pi2-num" type="text" inputmode="decimal" name="participacao" data-do-grupo="' + a.projeto + '" aria-label="Participação de ' + esc(a.nome) + '" value="' + esc(campo(a.participacao)) + '"></td>' +
                '<td><input class="pi2-num" type="text" inputmode="decimal" name="frequencia" aria-label="Frequência de ' + esc(a.nome) + '" value="' + esc(campo(a.frequencia)) + '"></td>' +
                qi.map(function (q) { return '<td>' + celula(q, 'A' + a.id) + '</td>'; }).join('') +
                '<td><input type="checkbox" name="ativo" aria-label="' + esc(a.nome) + ' ativo"' + (a.ativo ? ' checked' : '') + '></td></tr>';
            }).join('');
        }).join('') + '</tbody></table></div><div class="pi2-erro" role="alert"></div>' +
        '<div class="pi2-actions"><button class="pi2-btn primario" type="submit">Salvar alterações</button></div></form>';
    } else {
      tabela = '<div class="pi2-vazio">Nenhum aluno cadastrado. Cole a lista da turma abaixo para começar.</div>';
    }
    el.innerHTML = lista + '<p class="pi2-modal-sub">Participação geral: deixe vazio para o sistema usar a média das participações por atividade; preencha só se quiser fixar um valor. Sem o e-mail do login, o aluno não vê as próprias notas nem avalia a participação do grupo.</p>' + tabela +
      '<h3 class="pi2-h">Importar lista da turma</h3>' +
      '<form class="pi2-form" id="pi2-form-import"><div class="pi2-field"><label for="pi2-import">Uma linha por aluno: “Nome completo; número do projeto; e-mail do login” (o e-mail é opcional)</label>' +
      '<textarea id="pi2-import" name="texto" placeholder="Ana Souza; 1; ana.s@aluno.ifsc.edu.br&#10;Bruno Lima; 1&#10;Carla Dias; 2"></textarea><span class="pi2-hint">Quem já estiver cadastrado com o mesmo nome e projeto não é duplicado; só recebe o e-mail, se a lista trouxer um.</span></div>' +
      '<div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn" type="submit">Importar</button></div></form>';
    ligarCelulas(el);
    $$('[data-aplicar]', el).forEach(function (b) {
      b.onclick = function () {
        var v = $('[data-grupo="' + b.dataset.aplicar + '"]', el).value.trim();
        $$('[data-do-grupo="' + b.dataset.aplicar + '"]', el).forEach(function (i) { i.value = v; });
      };
    });
    var form = $('#pi2-form-alunos', el);
    if (form) I.aoEnviar(form, function () {
      var mudados = [];
      $$('tr[data-aluno]', form).forEach(function (tr) {
        var a = N.alunos.filter(function (x) { return x.id === tr.dataset.aluno; })[0];
        var v = function (n) { return $('[name=' + n + ']', tr).value.trim(); };
        var novo = { id: a.id, nome: v('nome'), projeto: v('projeto'), email: v('email').toLowerCase(), participacao: v('participacao'), frequencia: v('frequencia'), ativo: $('[name=ativo]', tr).checked };
        if (novo.nome !== a.nome || Number(novo.projeto) !== a.projeto || novo.email !== a.email || novo.participacao !== campo(a.participacao) || novo.frequencia !== campo(a.frequencia) || novo.ativo !== a.ativo) mudados.push(novo);
      });
      if (!mudados.length) throw new Error('Nenhuma alteração para salvar.');
      return chamar('salvarAlunos', { alunos: mudados }).then(function () { I.aviso(mudados.length + ' aluno(s) atualizado(s).'); desenhar(); });
    });
    I.aoEnviar($('#pi2-form-import', el), function (fd) {
      return chamar('importarAlunos', { texto: fd.get('texto') }).then(function (r) { I.aviso(r.importados + ' aluno(s) importado(s)' + (r.atualizados ? ', ' + r.atualizados + ' e-mail(s) atualizado(s)' : '') + '.'); desenhar(); });
    });
  }

  // ------------------------------------------------------------------
  // Fechamento: nota final, publicação e exportação
  // ------------------------------------------------------------------
  function formula() {
    return '<div class="pi2-formula"><strong>Nota final</strong> = ' + ['entregas', 'participacao', 'frequencia', 'pontualidade'].filter(function (c) { return N.pesos[c] > 0; })
      .map(function (c) { return COMP[c] + ' × ' + campo(N.pesos[c]) + '%'; }).join(' + ') +
      '. Um componente ainda sem dado fica fora da conta e a nota aparece como <span class="pi2-selo parcial">parcial</span>.</div>';
  }
  function telaFechamento(el) {
    var f = N.fechamento;
    var linhas = projetos().map(function (p) {
      var g = f.filter(function (a) { return a.projeto === p.id; });
      if (!g.length) return '';
      return '<tr class="pi2-grupo"><td colspan="6">' + rotuloProjeto(p) + '</td></tr>' + g.map(function (a) {
        var falta = a.faltando.map(function (c) { return COMP[c].toLowerCase(); });
        if (a.quesitosAvaliados < a.quesitosTotal) falta.push((a.quesitosTotal - a.quesitosAvaliados) + ' avaliação(ões) sem nota');
        return '<tr><td>' + esc(a.nome) + '</td><td>' + fmt(a.entregas) + '<small> (' + a.quesitosAvaliados + '/' + a.quesitosTotal + ')</small></td><td>' + fmt(a.participacao) + (a.participacaoAutomatica ? '<small title="Média das participações por atividade"> média</small>' : '') + '</td><td>' + fmt(a.frequencia) + '</td><td>' + fmt(a.pontualidade) + '</td>' +
          '<td class="pi2-final">' + fmt(a.final) + (a.parcial ? ' <span class="pi2-selo parcial" title="Falta: ' + esc(falta.join(', ')) + '">parcial</span>' : '') + '</td></tr>';
      }).join('');
    }).join('');
    var pubs = N.quesitos.filter(function (q) { return q.ativo; }).map(function (q) {
      return '<tr><td>' + esc(q.nome) + '</td><td><span class="pi2-selo ' + (q.publicado ? 'pub' : '') + '">' + (q.publicado ? 'publicada' : 'rascunho') + '</span></td>' +
        '<td><button class="pi2-btn mini" type="button" data-pub="' + esc(q.id) + '" data-novo="' + (q.publicado ? '0' : '1') + '">' + (q.publicado ? 'Recolher' : 'Publicar') + '</button></td></tr>';
    }).join('');
    el.innerHTML = formula() + (f.length
      ? '<div class="pi2-table-wrap"><table class="pi2-table pi2-grade"><thead><tr><th scope="col">Aluno</th><th scope="col">Entregas</th><th scope="col">Particip.</th><th scope="col">Frequência</th><th scope="col">Pontual.</th><th scope="col">Nota final</th></tr></thead><tbody>' + linhas + '</tbody></table></div>' +
        '<div class="pi2-barra-acoes"><span class="pi2-hint">Notas com uma casa decimal. Confira a regra de arredondamento do SIGAA antes de lançar.</span><button class="pi2-btn" type="button" id="pi2-exportar"><i class="fa-solid fa-copy"></i> Copiar tabela para planilha</button></div><textarea class="pi2-fallback" id="pi2-export-txt" readonly hidden aria-label="Tabela para copiar"></textarea>'
      : '<div class="pi2-vazio">Cadastre os alunos na aba “Alunos” para ver as notas finais.</div>') +
      '<h3 class="pi2-h">Publicação</h3><p class="pi2-modal-sub">Enquanto estiver em rascunho, só docentes veem. Depois de publicada, cada aluno vê apenas as próprias notas e os comentários do seu grupo.</p>' +
      '<div class="pi2-table-wrap"><table class="pi2-table"><thead><tr><th scope="col">Avaliação</th><th scope="col">Situação</th><th scope="col"></th></tr></thead><tbody>' + pubs +
      '<tr><td><strong>Nota final</strong> (com participação, frequência e pontualidade)</td><td><span class="pi2-selo ' + (N.finalPublicado ? 'pub' : '') + '">' + (N.finalPublicado ? 'publicada' : 'rascunho') + '</span></td>' +
      '<td><button class="pi2-btn mini" type="button" data-pub="__final" data-novo="' + (N.finalPublicado ? '0' : '1') + '">' + (N.finalPublicado ? 'Recolher' : 'Publicar') + '</button></td></tr></tbody></table></div>';

    $$('[data-pub]', el).forEach(function (b) {
      b.onclick = function () {
        var publicar = b.dataset.novo === '1';
        if (publicar && !b.dataset.confirmado) { b.dataset.confirmado = '1'; b.textContent = 'Confirmar publicação'; b.classList.add('primario'); return; }
        b.disabled = true;
        chamar('publicarNotas', b.dataset.pub === '__final' ? { final: true, publicar: publicar } : { quesito: b.dataset.pub, publicar: publicar })
          .then(function () { I.aviso(publicar ? 'Publicado para os alunos.' : 'Recolhido: voltou a rascunho.'); desenhar(); })
          .catch(function (e) { b.disabled = false; I.aviso(e.message, 'warning'); });
      };
    });
    var exp = $('#pi2-exportar', el);
    if (exp) exp.onclick = function () {
      var tsv = 'Aluno\tProjeto\tEntregas\tParticipação\tFrequência\tPontualidade\tNota final\tSituação\n' + f.map(function (a) {
        return [a.nome, a.projeto, fmt(a.entregas), fmt(a.participacao), fmt(a.frequencia), fmt(a.pontualidade), fmt(a.final), a.parcial ? 'parcial' : 'completa'].join('\t');
      }).join('\n');
      var falhou = function () { var t = $('#pi2-export-txt', el); t.hidden = false; t.value = tsv; t.focus(); t.select(); I.aviso('Selecione o texto abaixo e copie com Ctrl/⌘ + C.', 'warning'); };
      try { navigator.clipboard.writeText(tsv).then(function () { I.aviso('Tabela copiada. Cole na planilha.'); }, falhou); } catch (e) { falhou(); }
    };
  }

  // ------------------------------------------------------------------
  // Avaliações e pesos
  // ------------------------------------------------------------------
  function telaConfig(el) {
    var somaQ = N.quesitos.filter(function (q) { return q.ativo; }).reduce(function (s, q) { return s + q.peso; }, 0);
    el.innerHTML = formula() +
      '<h3 class="pi2-h">Pesos da nota final</h3><form class="pi2-form" id="pi2-form-pesos"><div class="pi2-pesos">' +
      ['entregas', 'participacao', 'frequencia', 'pontualidade'].map(function (c) {
        return '<div class="pi2-field"><label for="pi2-p-' + c + '">' + COMP[c] + ' (%)</label><input id="pi2-p-' + c + '" name="' + c + '" type="text" inputmode="decimal" value="' + esc(campo(N.pesos[c])) + '"></div>';
      }).join('') + '</div><div class="pi2-barra-acoes"><span class="pi2-hint" id="pi2-soma"></span><button class="pi2-btn primario" type="submit">Salvar pesos</button></div><div class="pi2-erro" role="alert"></div></form>' +
      '<h3 class="pi2-h">Participação por atividade</h3><p class="pi2-modal-sub">Em atividade de grupo, a nota de cada aluno é a nota do grupo ajustada pela participação que você definir para ele naquela atividade.</p>' +
      '<form class="pi2-form" id="pi2-form-regra"><div class="pi2-field"><label for="pi2-r-regra">Regra de conversão</label><select id="pi2-r-regra" name="regra">' +
      [['faixas', 'Por faixas — mantém, reduz ou zera conforme a faixa'], ['proporcional', 'Proporcional — nota × participação ÷ 10'], ['amortecida', 'Amortecida — metade da nota garantida']].map(function (o) {
        return '<option value="' + o[0] + '"' + (N.regra === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select><span class="pi2-hint" id="pi2-r-exemplo"></span></div>' +
      '<div class="pi2-pesos" id="pi2-r-faixas">' +
      [['cheiaMin', 'Nota cheia a partir de'], ['mediaMin', 'Faixa intermediária a partir de'], ['mediaPct', 'Intermediária vale (%)'], ['baixaPct', 'Abaixo disso vale (%)']].map(function (c) {
        return '<div class="pi2-field"><label for="pi2-r-' + c[0] + '">' + c[1] + '</label><input id="pi2-r-' + c[0] + '" name="' + c[0] + '" type="text" inputmode="decimal" value="' + esc(campo(N.faixas[c[0]])) + '"></div>';
      }).join('') + '</div><div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn primario" type="submit">Salvar regra</button></div></form>' +
      '<h3 class="pi2-h">Avaliações que compõem “Entregas”</h3><p class="pi2-modal-sub">O peso é relativo: uma avaliação de peso 2 vale o dobro de uma de peso 1. Para tirar uma avaliação da conta sem apagar as notas, desmarque “ativa”.</p>' +
      '<div class="pi2-table-wrap"><table class="pi2-table"><thead><tr><th scope="col">Avaliação</th><th scope="col">Peso</th><th scope="col">Fatia das entregas</th><th scope="col">Prazo</th><th scope="col">Tipo</th><th scope="col"></th></tr></thead><tbody>' +
      N.quesitos.map(function (q) {
        return '<tr><td>' + esc(q.nome) + (q.ativo ? '' : ' <span class="pi2-selo">inativa</span>') + '</td><td>' + campo(q.peso) + '</td><td>' + (q.ativo && somaQ ? Math.round(q.peso / somaQ * 100) + '%' : '—') + '</td><td>' + (prazoBr(q.prazo) || '—') + '</td><td>' + (q.escopo === 'individual' ? 'Individual' : 'Grupo') + '</td>' +
          '<td><button class="pi2-btn mini" type="button" data-editar="' + esc(q.id) + '">Editar</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="pi2-actions"><button class="pi2-btn primario" type="button" data-editar=""><i class="fa-solid fa-plus"></i> Nova avaliação</button></div>';
    var fp = $('#pi2-form-pesos', el);
    var somar = function () {
      var s = ['entregas', 'participacao', 'frequencia', 'pontualidade'].reduce(function (t, c) { return t + (Number($('[name=' + c + ']', fp).value.replace(',', '.')) || 0); }, 0);
      $('#pi2-soma', el).textContent = 'Soma: ' + String(Math.round(s * 100) / 100).replace('.', ',') + '%' + (Math.abs(s - 100) > 0.01 ? ' — precisa ser 100%' : '');
    };
    fp.addEventListener('input', somar); somar();
    I.aoEnviar(fp, function (fd) {
      return chamar('salvarPesos', { pesos: { entregas: fd.get('entregas'), participacao: fd.get('participacao'), frequencia: fd.get('frequencia'), pontualidade: fd.get('pontualidade') } })
        .then(function () { I.aviso('Pesos salvos.'); desenhar(); });
    });
    $$('[data-editar]', el).forEach(function (b) { b.onclick = function () { editarQuesito(b.dataset.editar); }; });
    var fr = $('#pi2-form-regra', el);
    var exemplo = function () {
      var regra = $('[name=regra]', fr).value, v = function (n) { return Number($('[name=' + n + ']', fr).value.replace(',', '.')) || 0; };
      $('#pi2-r-faixas', el).hidden = regra !== 'faixas';
      var fator = regra === 'proporcional' ? 0.6 : regra === 'amortecida' ? 0.8 : (6 >= v('cheiaMin') ? 1 : 6 >= v('mediaMin') ? v('mediaPct') / 100 : v('baixaPct') / 100);
      $('#pi2-r-exemplo', el).textContent = 'Exemplo: grupo com 8,0 e aluno com participação 6 → nota ' + fmt(8 * fator) + '.';
    };
    fr.addEventListener('input', exemplo); exemplo();
    I.aoEnviar(fr, function (fd) {
      return chamar('salvarRegra', { regra: fd.get('regra'), faixas: { cheiaMin: fd.get('cheiaMin'), mediaMin: fd.get('mediaMin'), mediaPct: fd.get('mediaPct'), baixaPct: fd.get('baixaPct') } })
        .then(function () { I.aviso('Regra salva. As notas já foram recalculadas.'); desenhar(); });
    });
  }

  function editarQuesito(id) {
    var q = N.quesitos.filter(function (x) { return x.id === id; })[0] || { id: '', nome: '', peso: 1, prazo: '', escopo: 'grupo', ativo: true };
    var corpo = I.abrirModal(I.cabecalho(q.id ? 'Editar avaliação' : 'Nova avaliação', 'Entra na média das entregas com o peso informado.') +
      '<form class="pi2-form"><div class="pi2-field"><label for="pi2-q-nome">Nome</label><input id="pi2-q-nome" name="nome" type="text" maxlength="120" required value="' + esc(q.nome) + '" placeholder="Ex.: Apresentação na SNCT"></div>' +
      '<div class="pi2-row"><div class="pi2-field"><label for="pi2-q-peso">Peso</label><input id="pi2-q-peso" name="peso" type="text" inputmode="decimal" required value="' + esc(campo(q.peso)) + '"></div>' +
      '<div class="pi2-field"><label for="pi2-q-prazo">Prazo de entrega (opcional)</label><input id="pi2-q-prazo" name="prazo" type="date" value="' + esc(q.prazo) + '"></div></div>' +
      '<div class="pi2-field"><label for="pi2-q-escopo">A nota é</label><select id="pi2-q-escopo" name="escopo"><option value="grupo"' + (q.escopo === 'grupo' ? ' selected' : '') + '>Do grupo (igual para todos os integrantes)</option><option value="individual"' + (q.escopo === 'individual' ? ' selected' : '') + '>Individual (uma por aluno)</option></select></div>' +
      (q.id ? '<label class="pi2-hint"><input type="checkbox" name="ativo"' + (q.ativo ? ' checked' : '') + '> Ativa (entra no cálculo)</label>' : '') +
      '<div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn" type="button" id="pi2-q-voltar">Voltar</button><button class="pi2-btn primario" type="submit">Salvar avaliação</button></div></form>', true);
    $('#pi2-q-voltar', corpo).onclick = desenhar;
    I.aoEnviar($('form', corpo), function (fd) {
      return chamar('salvarQuesito', { id: q.id, nome: fd.get('nome'), peso: fd.get('peso'), prazo: fd.get('prazo'), escopo: fd.get('escopo'), ativo: q.id ? fd.get('ativo') === 'on' : true })
        .then(function () { I.aviso('Avaliação salva.'); desenhar(); });
    });
  }

  // ------------------------------------------------------------------
  // Visão do aluno
  // ------------------------------------------------------------------
  function abrirMinhas() {
    I.abrirModal(I.cabecalho('Minhas notas', 'Carregando…'));
    I.api('minhasNotas').then(function (r) {
      var m = r.minhas;
      if (!m.vinculado) {
        I.abrirModal(I.cabecalho('Minhas notas', 'Seu login ainda não está ligado ao seu nome na lista da turma. Peça ao professor para fazer essa ligação.'));
        return;
      }
      var abertas = (m.abertas || []).map(function (a) {
        return '<form class="pi2-form pi2-fieldset" data-aberta="' + esc(a.quesito) + '"><strong>' + esc(a.nome) + '</strong>' + (a.respondida ? ' <span class="pi2-selo pub">respondida — você pode alterar</span>' : ' <span class="pi2-selo parcial">aguardando sua resposta</span>') +
          '<div class="pi2-table-wrap"><table class="pi2-table pi2-grade"><thead><tr><th scope="col">Integrante</th><th scope="col">Participação<small>0 a 10</small></th></tr></thead><tbody>' +
          m.colegas.map(function (c) {
            return '<tr><td>' + (c.eu ? '<strong>Você</strong> (' + esc(c.nome) + ')' : esc(c.nome)) + '</td><td><input class="pi2-num" type="text" inputmode="decimal" required name="p-' + esc(c.id) + '" aria-label="Participação de ' + esc(c.nome) + '" value="' + esc(campo(a.dadas[c.id])) + '"></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="pi2-field"><label for="pi2-pc-' + esc(a.quesito) + '">O que você fez nesta atividade</label><textarea id="pi2-pc-' + esc(a.quesito) + '" class="pi2-curto" name="comentario" maxlength="600">' + esc(a.comentario) + '</textarea></div>' +
          '<div class="pi2-erro" role="alert"></div><div class="pi2-actions"><button class="pi2-btn primario" type="submit">Enviar avaliação</button></div></form>';
      }).join('');
      if (abertas) abertas = '<h3 class="pi2-h">Participação do grupo</h3><p class="pi2-modal-sub">Dê uma nota de 0 a 10 para a sua participação e a de cada colega em cada atividade. Só os professores veem o que você respondeu; seus colegas não.</p>' + abertas + '<h3 class="pi2-h">Notas publicadas</h3>';
      var av = m.avaliacoes.length
        ? '<div class="pi2-timeline">' + m.avaliacoes.map(function (a) {
            return '<div class="pi2-item"><div class="pi2-item-head"><strong>' + esc(a.nome) + '</strong><span>' + (a.escopo === 'individual' ? 'individual' : 'nota do grupo') + '</span>' +
              (a.situacao ? '<span class="pi2-tag">' + SIT[a.situacao] + '</span>' : '') + '</div>' +
              '<div class="pi2-final">' + (a.nota === null ? 'Ainda sem nota' : 'Nota ' + fmt(a.nota)) + '</div>' +
              (a.nota !== null && a.escopo === 'grupo' && a.fator < 1 ? '<div class="pi2-item-text">Nota do grupo ' + fmt(a.notaGrupo) + ' × ' + Math.round(a.fator * 100) + '% (sua participação nesta atividade: ' + fmt(a.participacao) + ')</div>' : '') +
              (a.comentario ? '<div class="pi2-devolutiva"><small>Comentário do professor</small>' + esc(a.comentario) + '</div>' : '') + '</div>';
          }).join('') + '</div>'
        : '<div class="pi2-vazio">Nenhuma nota publicada ainda.</div>';
      var fim = '';
      if (m.finalPublicado && m.final) {
        var f = m.final;
        fim = '<h3 class="pi2-h">Nota final</h3><div class="pi2-table-wrap"><table class="pi2-table"><thead><tr><th scope="col">Componente</th><th scope="col">Peso</th><th scope="col">Sua nota</th></tr></thead><tbody>' +
          ['entregas', 'participacao', 'frequencia', 'pontualidade'].filter(function (c) { return m.pesos[c] > 0; }).map(function (c) {
            return '<tr><td>' + COMP[c] + '</td><td>' + campo(m.pesos[c]) + '%</td><td>' + fmt(f[c]) + '</td></tr>';
          }).join('') + '<tr><td><strong>Nota final</strong></td><td></td><td class="pi2-final">' + fmt(f.final) + (f.parcial ? ' <span class="pi2-selo parcial">parcial</span>' : '') + '</td></tr></tbody></table></div>';
      }
      var corpo = I.abrirModal(I.cabecalho('Minhas notas', esc(m.nome) + ' • projeto #' + I.doisDigitos(m.projeto) + '. Só você vê esta tela.') + abertas + av + fim);
      $$('form[data-aberta]', corpo).forEach(function (form) {
        I.aoEnviar(form, function (fd) {
          var notas = m.colegas.map(function (c) { return { aluno: c.id, valor: String(fd.get('p-' + c.id) || '').trim() }; });
          return I.api('avaliarParticipacao', { quesito: form.dataset.aberta, notas: notas, comentario: fd.get('comentario') }).then(function () { I.aviso('Avaliação enviada.'); abrirMinhas(); });
        });
      });
    }).catch(function (e) { I.abrirModal(I.cabecalho('Minhas notas', esc(e.message))); });
  }
})();
