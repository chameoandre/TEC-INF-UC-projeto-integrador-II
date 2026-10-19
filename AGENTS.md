# Base de conhecimento — Dashboard do Projeto Integrador II (IFSC Garopaba)

Leia este arquivo antes de alterar qualquer coisa neste repositório. Ele vale para qualquer
assistente de IA (Claude, Antigravity/Gemini, Copilot, Cursor) e para pessoas. Ao concluir uma
mudança relevante, atualize as seções "Decisões" e "Pendências" no fim do arquivo.

## O que é

Dashboard público da unidade curricular Projeto Integrador II (Técnico em Informática, turma
INF-2024), usado pelos docentes para acompanhar os projetos dos grupos e pelos estudantes para
registrar avanços.

- Site: https://chameoandre.github.io/TEC-INF-UC-projeto-integrador-II/2026-2/
- Repositório: `chameoandre/TEC-INF-UC-projeto-integrador-II` (GitHub Pages, branch `main`)
- Docentes: André Moraes, Karyna Landra, Nauber Gavski
- O semestre ativo é `2026-2/`. As pastas `2020-2/`, `2021-1/` e `2026-1/` são acervo: não mexa.

## Arquitetura

```
Navegador (GitHub Pages, estático)
  │  leitura: GET  → Apps Script  → JSON {projetos, registros}
  │  escrita: POST → Apps Script, com o token de login Google do usuário
  ▼
Apps Script (roda com a conta dona da planilha)
  │  confere o token com o Google, identifica o e-mail, verifica a permissão, grava
  ├─ Planilha de projetos (pública, somente leitura pelo link) — aba "Visao-geral"
  └─ Planilha de controle (privada) — abas "membros", "registros", "alteracoes"
```

Não há servidor próprio nem banco de dados. Tudo o que está no repositório é público.
A segurança está inteira no Apps Script: o navegador nunca escreve na planilha.

### Três fontes de dados, em ordem de preferência

1. **API (Apps Script)**: usada quando `apiUrl` está preenchido em `pi2-config.js`.
2. **CSV público da planilha**: reserva quando a API falha. Só traz os projetos, sem registros.
3. **Cópia embutida** (`const projectsData` dentro do `index.html`): reserva final, regravada
   duas vezes por dia pela GitHub Action.

## Mapa de arquivos

| Arquivo | Papel |
| --- | --- |
| `index.html` (raiz) | Redireciona para `2026-2/`. |
| `2026-2/index.html` | Página única do dashboard: CSS, abas, aulas e os templates dos cards. Gerada originalmente no Antigravity. Contém a cópia embutida dos dados. |
| `2026-2/pi2-live.js` | Camada dinâmica: leitura ao vivo, login Google, modais, linha do tempo, painel docente, Raio-X calculado, contadores. |
| `2026-2/pi2-notas.js` | Painel de notas dos docentes e tela "Minhas notas" dos alunos. Depende de `PI2.interno`, exposto pelo `pi2-live.js`. |
| `2026-2/pi2-live.css` | Estilos das duas camadas acima. Usa as variáveis de tema do `index.html`. |
| `2026-2/pi2-config.js` | URL da API e ID do cliente OAuth. São valores públicos. |
| `2026-2/privacidade.html` | Política de privacidade exigida pelo Google para o login. |
| `2026-2/dashboard-pi2-2026.html` | Só redireciona para `index.html` (endereço antigo). |
| `apps-script/Code.gs` | Backend. **Cópia de referência**: o que roda é o que está colado no editor do Apps Script. |
| `apps-script/README-IMPLANTACAO.md` | Passo a passo de implantação e republicação. |
| `scripts/sync_sheet.py` | Regrava a cópia embutida a partir do CSV da planilha. |
| `.github/workflows/sync-sheet.yml` | Roda o script às 06h e 18h (BRT) e faz commit em `2026-2/`. |

## Como o `pi2-live.js` se encaixa no `index.html`

O `index.html` define funções globais (`renderProjects`, `renderAuditTable`, `openModal`,
`switchTab`, `showToast`) e a constante `projectsData`. O `pi2-live.js` não reescreve esses
templates; ele:

- mantém `PI2.bruto` (dados sem escape) e regrava `projectsData` com tudo **escapado**;
- envolve `renderProjects` e `openModal` para acrescentar botões, selo de recência e linha do tempo;
- substitui `liveSyncFromSheet` por `PI2.sincronizar`;
- desenha o bloco `#pi2-raiox` no topo da aba Raio-X e recalcula contadores e KPIs.

Consequência: os templates do `index.html` podem inserir `${p.campo}` direto, porque os valores
já chegam escapados. Código novo que leia de `PI2.bruto` ou de `PI2.registros` **precisa** passar
por `esc()` e `urlSegura()`.

## Planilha de projetos (aba `Visao-geral`)

Cada projeto é uma linha cujo primeiro campo é o número do projeto. Colunas, a partir de A:

| Col. | Campo | Col. | Campo |
| --- | --- | --- | --- |
| A | ID | N–O | Exp 3: título, resultados |
| B | Projeto | P–Q | Exp 4: título, resultados |
| C | Integrantes | R | Paper 1 [SEPEI] |
| D | Objetivo | S | Paper 2 [SNCT] |
| E | Repositório GitHub | T | Paper 3 |
| F | Relatório (link de leitura do Overleaf) | U | Paper 4 [COTB] |
| G | Diagrama (Canva) | V | Avanços |
| H | Pitch em vídeo | W | Próximos passos |
| I | Trabalhos relacionados | X | Dificuldades |
| J–K | Exp 1: título, resultados | Y | Tecnologias |
| L–M | Exp 2: título, resultados | Z | Observações |

Mudar a ordem das colunas quebra a leitura. A conversão linha → projeto existe em **três
lugares que precisam ficar iguais**:

- `linhasParaProjetos()` em `2026-2/pi2-live.js`
- `linhasParaProjetos()` em `apps-script/Code.gs` (bloco idêntico, entre os marcadores `//<linhasParaProjetos>`)
- `parse_projects()` em `scripts/sync_sheet.py`

O projeto #11 (plano individual) não tem linha na planilha. Ele vive em `PROJETO_INDIVIDUAL`
no `sync_sheet.py` e é preservado no navegador por ter `isDomiciliar: true`.

## Backend (`apps-script/Code.gs`)

- `GET` → dados públicos: projetos e registros visíveis. Nunca devolve e-mail; o autor sai como
  primeiro nome + inicial do sobrenome.
- `POST` com `{acao, idToken, ...}`. O corpo vai como `text/plain` para evitar a pré-verificação
  CORS, que o Apps Script não responde. Não troque para `application/json`.

| Ação | Quem pode | O que faz |
| --- | --- | --- |
| `whoami` | qualquer login | Devolve papel, projetos e situação do usuário. |
| `solicitarAcesso` | conta de domínio permitido | Cria pedido pendente para um projeto. |
| `registrar` | integrante do projeto, docente | Grava um avanço e espelha na coluna V (e W/X se informados). |
| `atualizarFicha` | integrante do projeto, docente | Altera campos da ficha; guarda valor anterior em `alteracoes`. |
| `painel`, `decidirAcesso`, `salvarMembro` | docente | Gestão de acessos. |
| `devolutiva`, `ocultar` | docente | Comentário docente e ocultação de registro. |
| `salvarLink`, `removerLink`, `linksProjeto` | integrante do projeto, docente | Links extras do projeto (aba `links` da planilha de controle; até 12 por projeto). **Link de aluno nasce `pendente` e só entra no `GET` público depois de aprovado**; o de docente entra direto. Aluno não edita link existente: remove e inclui outro. Remover só marca como removido. |
| `decidirLink` | docente | Aprova ou recusa um link pendente. `whoami` e `painel` devolvem `usuario.pendencias` (acessos e links aguardando), usado no contador do botão "Painel docente". |
| `notasPainel`, `salvarPesos`, `salvarQuesito`, `lancarNota`, `salvarAlunos`, `importarAlunos`, `publicarNotas`, `abrirPares`, `salvarRegra` | docente | Painel de notas (ver seção "Notas"). Cada uma devolve o estado completo já recalculado. |
| `minhasNotas`, `avaliarParticipacao` | aluno ligado à lista da turma | Notas publicadas do próprio aluno; e a avaliação de participação dele e dos colegas nas atividades abertas. |
| `criarDemanda`, `concluirDemanda`, `removerDemanda`, `alterarPrazoDemanda`, `notificarDemanda` | docente (concluir também pelo aluno do grupo) | Gestão de demandas, checkpoints, prorrogação de prazos, reenvio de lembretes e disparo de comunicados por e-mail. |
| `salvarAvaliacao` | docente | Rubricas formativas e notas pedagógicas por projeto. |

Papéis: `docente` (lista `CONFIG.DOCENTES` ou aba `membros`), `aluno` (aba `membros`, situação
`ativo`, com os números dos projetos). Alunos só alteram os campos de `CAMPOS_ALUNO`.

### Notificações por E-mail (GmailApp) & Diagnóstico

Disparo de e-mails em tempo real via `GmailApp.sendEmail` para avisos de novas demandas, lembretes de prazos e comunicados:
- **Conta Remetente**: Todos os e-mails são disparados pela conta Google proprietária da implantação do Apps Script (`chameoandre@gmail.com`) e ficam registrados exclusivamente na pasta **Enviados** dessa conta.
- **Autorização OAuth**: A funcionalidade requer permissão do escopo do Gmail (`https://www.googleapis.com/auth/gmail.send`). Se não autorizado, as chamadas falham silenciosamente no bloco `try/catch`. Para forçar a tela de consentimento de segurança do Google, execute manualmente a função `diagnosticoEnvioEmail()` no editor do Apps Script.
- **Destinatários Ativos**: O script consulta exclusivamente a aba `membros` da planilha privada de controle (`PI2-2026 — controle de acessos e registros (PRIVADO)`), filtrando por `status == 'ativo'` e pelo projeto da demanda (ou todos se `*`). Se a aba estiver vazia, nenhum e-mail é disparado.
- **Padrão Visual dos E-mails (Template HTML Responsivo - Padrão TCC / Marília)**:
  - Todo envio utiliza `GmailApp.sendEmail` com `htmlBody` renderizado pela função `montarHtmlEmailDemanda_`.
  - Design em card moderno (`max-width: 650px`, bordas arredondadas `12px`, sombras suaves e tipografia moderna).
  - Cabeçalhos temáticos coloridos com branding institucional do IFSC Garopaba:
    - *Verde IFSC (`#16a34a`)* para Novas Demandas;
    - *Âmbar (`#d97706`)* para Lembretes e Alertas de Prazos;
    - *Azul Oceano (`#0284c7`)* para Atualizações e Prorrogações de Prazos;
    - *Roxo (`#7c3aed`)* para Comunicados e Esclarecimentos da Equipe Docente.
  - Caixas dedicadas com bordas esquerdas reforçadas para **Metadados da Meta**, **Critérios de Aceite & Rubrica Formativa**, **Orientações Técnicas** e **Mensagens Exclusivas dos Orientadores**.
  - Botão de ação central com link direto e destacado para o dashboard público (`https://chameoandre.github.io/TEC-INF-UC-projeto-integrador-II/2026-2/`).
  - Rodapé institucional formal com assinatura dos três docentes da unidade curricular.
- **Rotinas Administrativas Úteis no Editor**:
  - `diagnosticoEnvioEmail`: Inspeciona a aba `membros`, lista a contagem de e-mails ativos, força a autorização do Gmail e envia e-mail de prova para o docente.
  - `importarTurmaSIGAA`: Cadastra/sincroniza em lote os 33 alunos da turma INF-2024 vinculados aos seus respectivos projetos (1 a 11).
  - `reenviarEmailUltimaDemanda`: Reenvia a notificação da última demanda cadastrada com o novo layout HTML para todos os membros ativos.

### Notas

Abas na planilha de controle: `quesitos` (avaliações, peso, prazo, grupo/individual, publicada),
`alunos` (lista da turma, e-mail do login, participação, frequência), `notas` (um lançamento por
avaliação e alvo; o alvo é `P<projeto>` ou `A<id do aluno>`), `config` (pesos e publicação da nota
final) e `notas_historico`. As abas são criadas sozinhas no primeiro uso.

Nota final do aluno = média ponderada de quatro componentes, com pesos que somam 100:

- **Entregas**: média ponderada das avaliações ativas. Em avaliação de grupo, a nota do aluno é a
  nota do grupo × fator de participação dele **naquela atividade**; em avaliação individual, é a nota do aluno.
- **Participação**: 0 a 10, por aluno: o valor fixado na aba Alunos ou, se vazio, a média das participações por atividade.
- **Frequência**: percentual de presença ÷ 10, por aluno.
- **Pontualidade**: 10 × (entregas marcadas "no prazo" ÷ entregas com situação marcada), pelo grupo.

Componente sem dado fica fora da conta (os pesos restantes são renormalizados) e a nota sai como
"parcial". "Não entregue" sem nota digitada vale zero. **Todo o cálculo é feito no servidor**
(`calcularAluno_`); o `pi2-notas.js` só exibe. Não duplique a fórmula no navegador.

Participação por atividade (abas `participacao` e `avaliacoes_pares`):

- O docente abre a avaliação de uma atividade; cada aluno dá 0 a 10 para si e para cada colega do
  grupo (`avaliarParticipacao`). O aluno só enxerga o que ele mesmo informou.
- **O que os alunos informam é só referência.** A nota muda apenas com a participação que o
  docente grava (coluna "Vale" do editor, enviada junto com `lancarNota`). Sem valor gravado, o fator é 1.
- A conversão participação → fator é configurável (`salvarRegra`): `faixas` (padrão: 8 a 10 mantém,
  5 a 7 vale 80%, abaixo de 5 vale 50%, zero zera), `proporcional` ou `amortecida`. Ver `fatorParticipacao_`.
- Publicar a avaliação fecha a coleta dos alunos.

Publicação: cada avaliação tem o seu "publicada", e a nota final (com participação, frequência e
pontualidade) tem um interruptor próprio. Antes disso `minhasNotas` não devolve nada.

**Depois de alterar o `Code.gs`**, o dono precisa colar o código no editor do Apps Script e
republicar: Implantar → Gerenciar implantações → lápis → Nova versão. A URL não muda. Um push
no GitHub **não** atualiza o backend.

## Regras que não podem ser quebradas

1. **Nenhum segredo no repositório.** Ele é público. O ID do cliente OAuth e a URL `/exec` são
   públicos por natureza; a "chave secreta do cliente" não é usada e nunca deve aparecer aqui.
2. **Nenhuma escrita direta do navegador na planilha.** Toda gravação passa pelo Apps Script,
   com token conferido no servidor. Não confie em nada que o navegador afirme sobre quem é o usuário.
3. **Todo texto externo é escapado** antes de entrar no HTML, e todo link passa por `urlSegura()`.
   Qualquer campo preenchido por aluno pode conter HTML, de propósito ou por acidente.
4. **E-mails de alunos só na planilha de controle.** Nunca em arquivos do repositório, nem na
   resposta do `GET`.
5. **Sem dados de saúde ou outros dados sensíveis** de estudantes em páginas, código ou commits.
   Há menores de idade na turma.
6. **Não edite `const projectsData` à mão.** A Action regrava o bloco inteiro. Para mudar um dado,
   mude na planilha (ou em `PROJETO_INDIVIDUAL`, no caso do #11).
7. **Não envie logotipo nem peça escopos extras** na configuração OAuth do Google Cloud: isso
   obrigaria o app a passar por verificação do Google.
8. **Não regenere o `2026-2/index.html` a partir de uma versão antiga.** As três linhas no fim do
   arquivo, `<script src="pi2-config.js">`, `<script src="pi2-live.js">` e `<script src="pi2-notas.js">`, e o
   `<link rel="stylesheet" href="pi2-live.css">` no `<head>` precisam continuar lá; sem elas o
   login, os modais e a leitura ao vivo somem. Também não recrie no `index.html` as funções
   `liveSyncFromSheet` e `parseCsvAndUpdate` nem o link "Planilha Oficial" do cabeçalho: foram
   removidos de propósito. O elemento `<div id="pi2-auth">` do cabeçalho é onde o login aparece.
   Teste rápido após qualquer edição grande: o botão de login ainda aparece no cabeçalho?
9. **Notas nunca saem no `GET` público nem ficam em arquivos do repositório.** Só por `POST`
   autenticado: tudo para docentes, e para o aluno apenas as próprias notas já publicadas.
10. **Permanência e Intocabilidade do Painel Central de Notas & Avaliações:**
    - O **Painel Central de Notas & Avaliações** (aba `tab-notas`, botão de navegação `Notas & Avaliações` na `nav-tabs-bar`, atalho dentro do `Painel Docente` e avaliação detalhada por rubricas) é uma funcionalidade nuclear e **permanente**.
    - É terminantemente proibido remover, omitir ou desvincular o painel de notas em futuras refatorações de `2026-2/index.html`, `2026-2/pi2-live.js` ou scripts de automação.
    - As chamadas `renderNotasTab()`, `filtrarTabelaNotas()` e a exportação em `window.PI2` devem ser preservadas em todos os ciclos de renderização e sincronização.

## Como testar

- Página: `python3 -m http.server 8000` dentro de `2026-2/` e abrir `http://localhost:8000`.
  O login só funciona em localhost se essa origem estiver autorizada no cliente OAuth.
- Sincronização: `python scripts/sync_sheet.py` na raiz; conferir o `git diff` de `2026-2/index.html`.
- Backend: abrir a URL `/exec` no navegador; a resposta deve começar com `{"ok":true`.
- Antes de publicar mudança visual, conferir em largura de celular (~390 px), nos temas claro e
  escuro. Os alunos registram pelo telefone.

## Git

- A Action faz commits em `main` duas vezes por dia. **Sempre `git pull --rebase` antes do push.**
- A pasta fica dentro do Google Drive. Arquivos `Icon` e `.DS_Store` são lixo do macOS e estão no `.gitignore`.
- Mensagens de commit em português, no padrão `tipo(escopo): descrição` (`feat`, `fix`, `chore`, `docs`).

- **19/10/2026** — Aplicação de Slides Interativos Multiaulas & Botões "Slides" na Central Pedagógica:
  - **Aplicação Completa de Slides Interativos (`2026-2/slides-aulas/index.html`)**: Ambiente dinâmico e imersivo para apresentação e explanação fluida dos conteúdos pedagógicos em sala de aula ou projeção. Suporte a tela cheia (tecla `F`), navegação por teclado (`←`, `→`, `Espaço`, `Home`, `End`), barra de progresso em tempo real, dots de navegação direta e seletor rápido de aulas.
  - **Aulas e Tópicos Contemplados na Apresentação**:
    - *Aula 1 • Elaboração de Objetivos*: Fórmula dos 4 critérios (`[Verbo] + [Produto] + [Público] + [Propósito]`), Degraus D1 a D4 e exemplos comparativos práticos ("O que evitar vs O que a SBC espera").
    - *Aula 2 • Metodologia em Computação*: Design Science Research (DSR), diagrama draw.io, isolamento de variáveis (VI/VD/VC) e garantia de reprodutibilidade científica.
    - *Aula 3 • Trabalhos Relacionados*: Mineração em bases (Scholar, SOL SBC, Scielo), seleção do quarteto de artigos, Quadro Comparativo e conectivos de contraste.
    - *Aula 4 • Experimentos Científicos*: Diferença entre código funcional e validação científica, os 3 tipos de experimentos (Desempenho/Stress, Usabilidade SUS e Acurácia/Funcional), formulação de hipóteses e tabela de dados brutos.
    - *Aula 5 • Expressão de Resultados*: Matriz de decisão para escolha do tipo de gráfico, regras de tabelas SBC (*booktabs* sem linhas verticais) e redação crítica/discussão.
    - *COTB 2027*: Regras de submissão no JEMS, formatação (2 a 6 páginas), revisão duplo-cega (*double-blind*) e cronograma até a deadline de 15/11.
  - **Botões "Slides" Integrados em Cada Card (`.btn-card-slides`)**: Adicionado o botão estilizado com ícone de display e microinterações de hover nos cards da Central Pedagógica em `2026-2/index.html`, permitindo abrir a apresentação diretamente no slide inicial da aula selecionada via URL param (`?aula=1`, `?aula=2`, `?aula=3`, `?aula=4`, `?aula=5` ou `?aula=cotb`).
  - **Incremento de Cache-Buster**: Atualizado para `?v=3.1` em `2026-2/index.html`.

- **19/10/2026** — Atualização do Raio-X da Turma, Novo Card/Modal de Metodologia em Computação & Padronização para "Aulas":
  - **Atualização Completa do Raio-X da Turma (`tab-avancos-pendencias`)**: Sincronização dos blocos 1, 2 e 3 com o diagnóstico de 19/10/2026. Atualizado o sumário executivo com os avanços recentes de outubro das 10 equipes regulares (#01 a #10) e do plano domiciliar (#11). Destaque para Overleaf 100% ativo (8 links públicos de leitura `/read/` e 2 links diretos de edição), 8/10 pitch vídeos funcionais e matriz semafórica com orientações práticas para a condução dos atendimentos de bancada.
  - **Card da Aula 2: Metodologia Científica em Computação**: Inserido novo card na Central Pedagógica (`pedagogical-hub-grid`) com Clipart SVG vetorial ilustrando o pipeline metodológico completo (Setup de Hardware/SO, Arquitetura draw.io, Repositório GitHub e Validação Empírica/Reprodutibilidade).
  - **Modal Pedagógico da Aula de Metodologia (`metodologiaModal`)**: Modal interativo contendo os 4 eixos essenciais para escrita da Metodologia no template SBC (Natureza da Pesquisa Aplicada/DSR, Os 4 Degraus Metodológicos D1-D4, Isolamento de Variáveis VI/VD/VC com caracterização do ambiente, Comparativo Prático "O que NÃO fazer vs O que a SBC espera" e Snippet LaTeX pronto para cópia direta para o Overleaf).
  - **Padronização da Nomenclatura para "Aulas"**: Substituição sistemática de "Roteiros" por "Aulas" em todos os cards e botões da Central Pedagógica (`Aula 1 • Elaboração de Objetivos`, `Aula 2 • Metodologia em Computação`, `Aula 3 • Trabalhos Relacionados`, `Aula 4 • Experimentos Científicos`, `Aula 5 • Expressão de Resultados`), refletindo com fidelidade a abordagem temática de sala de aula.
  - **Incremento de Cache-Buster**: Atualizado para `?v=3.0` em `2026-2/index.html`.

- **19/10/2026** — Aumento de Dimensão e Realce de Destaque / Hover no Menu de Seções:
  - **Botões do Menu Encorpados (`.tab-btn`)**: Aumento da tipografia para `0.92rem` e padding para `0.55rem 1.1rem` com bordas arredondadas de `9px`, garantindo maior conforto visual e ergonomia no clique.
  - **Hover Altamente Evidente & Feedback Tátil**: Aplicação de gradiente iluminado verde/ciano (`rgba(34, 197, 94, 0.25)`), borda verde-clara acesa (`var(--ifsc-green-light)`), elevação tridimensional com sombra suave (`box-shadow: 0 6px 18px rgba(34, 197, 94, 0.32)`) e micro-animação de escala nos ícones (`scale(1.18)`).
  - **Barra com Maior Presença**: Padding expandido para `0.8rem 1.8rem`, espaçamento entre linhas de `0.6rem` e gradiente esmeralda reforçado. Incrementado cache-buster para `?v=2.9`.

- **19/10/2026** — Card da Aula de Elaboração de Objetivos na Central Pedagógica & Roteiro 1:
  - **Novo Card Didático (`Card 0 • Objetivos`)**: Adicionado à grade da Central Pedagógica com foco na metodologia completa de formulação: Objetivo Geral com fórmula de 4 critérios (`[Verbo] + [Produto Tangível] + [Público] + [Propósito]`) e os 4 Degraus Metodológicos da Engenharia de Software (`D1 Requisitos`, `D2 Modelagem`, `D3 Código`, `D4 Validação`).
  - **Clipart SVG Conceitual**: Desenho vetorial de alta definição ilustrando o alvo metodológico e a escada dos 4 degraus técnicos.
  - **Integração de Material Metodológico Focado**: Disponibilizado o Roteiro Prático completo em `2026-2/roteiro-1-objetivos/index.html` com botão de acesso direto no card ("Acessar Roteiro"), omitindo os slides diagnósticos de status que eram específicos da turma de PI-1.
  - **Alinhamento com os Cards de Projetos**: Os estudantes de PI-2 agora contam com o mesmo padrão e exemplos comparativos práticos para registrar corretamente o Objetivo Geral e os Degraus Metodológicos nas fichas e no artigo final.

- **19/10/2026** — Reorganização do Menu em Duas Linhas, Novas Abas de Eventos e Utilitários & Limpeza Visual:
  - **Menu de Navegação em Duas Linhas (`.nav-tabs-bar`)**: Reestruturação da barra de navegação com cor de destaque elegante e gradiente sutil, agrupando as abas em 2 linhas temáticas (`Gestão & Acompanhamento` e `Produção & Pesquisa`), eliminando a sobrecarga de largura lateral e o scroll horizontal excessivo.
  - **Aba de Eventos de Computação (`tab-eventos`)**: Seção nobre com cards elegantes para os principais eventos científicos da área (Computer on the Beach 2027, SEPEI IFSC, SNCT MCTI, Escolas Regionais SBC Sul e Sistema JEMS), detalhando prazos, formatos de artigo e botões de acesso.
  - **Aba de Atalhos & Utilitários (`tab-utilitarios`)**: Central de ferramentas organizada em 4 áreas com botões compactos ("app launcher") com ícones e descrições diretas (Overleaf, Tables Generator, Detexify, BibGuru, Google Acadêmico, SciELO, Connected Papers, Periódicos CAPES, draw.io, Canva, TinyPNG, Carbon, Google Colab, GitHub, JEMS e MDN Docs).
  - **Remoção de Redundância na Central Pedagógica**: Removido o banner duplicado do COTB (`cotb-announcement-banner`) da tela principal, pois o card temático do COTB na grade pedagógica já contempla o acesso e as instruções. Incrementado cache-buster para `?v=2.8`.

- **19/10/2026** — Gestão Avançada de Prazos, Contagem Regressiva e Alertas de Demandas:
  - **Contador Dinâmico de Prazos (Countdown)**: Implementada a função `calcularContadorPrazo` com badges visuais reativos em cada card de demanda (`pi2-countdown-badge`):
    - `⏳ Restam X dias e Y horas` (normal);
    - `⚡ Restam X horas e Y minutos` (urgente, pulso suave);
    - `🔥 Restam X minutos!` (crítico, < 1 hora);
    - `⚠️ Prazo encerrado (há X dias)` (vencido);
    - `✅ Concluída` (finalizada).
    - Exibido tanto na aba central de Demandas & Checkpoints quanto no modal de detalhes dos projetos.
  - **Alteração & Prorrogação de Prazo (`📅 Prazo`)**: Modal docente para ajustar a data limite de qualquer demanda, com opção de envio automático de e-mail aos estudantes informando o novo prazo e orientações/motivo.
  - **Reenvio de Alerta / Lembrete (`🔔 Alerta`)**: Botão docente para redisparar e-mail formal de lembrete com prazos e rubricas para os alunos do escopo da demanda com 1 clique.
  - **Comunicados e Esclarecimentos (`📢 Comunicado`)**: Modal docente para redigir mensagem complementar/esclarecimento vinculada à demanda e disparar diretamente para os e-mails dos alunos.
  - **Backend**: Implementados endpoints `alterarPrazoDemanda` e `notificarDemanda` em `Code.gs`. Cache-buster incrementado para `?v=2.7`.

- **19/10/2026** — Atualização da Implantação do Apps Script (Demandas & Rubricas):
  - **Nova URL de Produção**: Atualizada a `apiUrl` em `pi2-config.js` para `https://script.google.com/macros/s/AKfycbxm4uKLXT9_lg827-dVINCuEqplZLGvn47q6wWli8iOyuUD3ZuroquoCF7A7Lme3r4/exec`.
  - **Resolução do erro "Ação desconhecida"**: A versão anterior implantada na nuvem não possuía os endpoints `criarDemanda`, `concluirDemanda`, `removerDemanda` e `salvarAvaliacao`. Com a nova implantação e escopo público ("Qualquer pessoa"), o envio de demandas em broadcast geral e por projeto passa a operar normalmente. Incrementado cache-buster para `?v=2.6`.

- **16/10/2026** — Objetivos Gerais e Específicos em Caixas Separadas com 4 Degraus Metodológicos e Desdobramentos Dinâmicos:
  - **Separação Estruturada**: o campo `objective` da planilha e do dashboard foi dividido em caixas dedicadas: uma para o **Objetivo Geral** (com guia da fórmula do Roteiro 1: verbo + produto tangível + público + propósito) e outra seção para os **Objetivos Específicos**, iniciando por padrão com no mínimo os **4 Degraus Metodológicos** (D1 Diagnóstico/Requisitos, D2 Modelagem/Design, D3 Implementação/Código, D4 Validação/Testes).
  - **Desdobramentos sob Demanda**: inclusão do botão interativo `+ Adicionar objetivo específico` no formulário de edição da ficha (`PI2.abrirFicha`), permitindo que a equipe desdobre qualquer degrau em objetivos específicos adicionais, associando cada um a um degrau metodológico (`D1` a `D4`).
  - **Manutenção das Rubricas**: a rubrica formativa permanece idêntica e coerente. No modal de avaliação docente (`abrirModalAvaliarObjetivos`), cada degrau exibe a redação cadastrada pelos alunos para aquela etapa e quaisquer desdobramentos vinculados, permitindo inspeção precisa e consistente.
  - **Computação nas Notas Gerais**: adicionado botão e rotina de cálculo consolidado (`pi2-btn-computar-nota-sugerida`) que pondera Objetivo Geral (1,5 pts), os 4 Degraus Metodológicos (4,0 pts), as Entregas Técnicas de Artefatos (3,0 pts) e as Demandas Concluídas (1,5 pts), computando a nota final de 0 a 10 e refletindo diretamente na Grade Unificada.
  - **Compatibilidade com a Planilha**: serialização transparente e legível (`[OBJETIVO GERAL]\n...\n\n[OBJETIVOS ESPECÍFICOS]\n- [D1] ...`), preservando intacta a ordem de colunas da aba `Visao-geral`. Atualizados cache-busters para `?v=2.5`.

- **15/10/2026** — Grade Mestra Unificada de Notas & Rubricas Formativas: consolidação total do painel de notas (`#tab-notas`) em uma **única grade/tabela mestre** abrangendo todos os 11 projetos e todas as dimensões avaliativas do semestre (Objetivo Geral com fórmula de 4 critérios, 4 Degraus Metodológicos D1-D4, Entregas Técnicas de Artigo SBC Overleaf, Repositório GitHub, Diagrama Canva e Vídeo Pitch com links diretos clicáveis, Demandas ativas e Participação por Pares). O botão "Notas" do cabeçalho e do painel docente agora direcionam diretamente para a aba central unificada, eliminando modais descolados. No botão `[ 📝 Avaliar ]`, o docente abre um modal completo que permite validar rubricas de todas as frentes, inspecionar entregas e aplicar as médias de avaliação de pares com 1 clique ("Usar médias indicadas pelos colegas"). Atualizado cache-buster para `?v=2.3`.
- **15/10/2026** — Unificação Central de Notas, Rubricas, Demandas e Avaliação de Pares: o Painel Central de Notas & Avaliações (`#tab-notas`) foi unificado com uma navegação por sub-abas integradas (`🎯 Rubricas Pedagógicas`, `📋 Entregas & Demandas`, `📊 Fechamento & Médias`, `👥 Alunos & Frequência`, `⚙️ Pesos & Regras` e `🎓 Minhas Notas & Avaliação de Pares`). As demandas pedagógicas ativas são sincronizadas em tempo real na aba de entregas com critérios de aceite/rubricas formativas para correções. A avaliação de pares (onde os alunos atribuem sigilosamente notas de 0 a 10 entre si com justificativa) foi integrada nativamente na visão do aluno e na coluna docente com preenchimento em 1 clique ("Usar o que os colegas indicaram"). Adicionados cache-busters `?v=2.2` no `index.html` para evitar caching antigo no navegador.
- **15/10/2026** — Demandas & Checkpoints da Turma: implementado sistema de tarefas e checkpoints com direcionamento para toda a turma (`*` broadcast geral) ou individualmente para equipes específicas (`#1` a `#11`), replicando a estratégia de sucesso do Projeto Integrador 1. Inclui aba permanente (`tab-demandas`) na barra de navegação, modal docente para criação com prazos, pontos e rubricas/critérios de aceite, disparo de notificações por e-mail aos alunos do projeto via `GmailApp`, vinculação de demandas no formulário de avanço de projeto (conclusão silenciosa automática), visualização no modal individual de cada grupo e persistência no Apps Script (`criarDemanda`, `concluirDemanda`, `removerDemanda` e aba `demandas`).
- **15/10/2026** — Painel Central de Notas & Avaliações por Rubricas: restaurado e fixado como aba permanente (`tab-notas`), espelhando a estratégia consolidada no Projeto Integrador 1. Inclui acompanhamento dos 11 projetos com rubrica do Objetivo Geral (fórmula de 4 critérios: verbo, entregável, público e propósito) e dos 4 Degraus Metodológicos (D1 Exploração/Diagnóstico, D2 Modelagem/Design, D3 Implementação/Código, D4 Validação/Experimentos), visualização de pareceres, destaque para o aluno logado e persistência no Apps Script (`salvarAvaliacao` e aba `avaliacoes`).
- **13/10/2026** — Persistência de autenticação: migrado de `sessionStorage` para `localStorage`
  (preservando login entre abas e reinicializações do navegador); restauração imediata do estado
  logado antes das requisições remotas (eliminando atraso/flicker na barra de login); tratamento de
  falhas de rede no `whoami` sem deslogar indevidamente; e renovação antecipada e silenciosa do
  token via Google Identity Services (`auto_select` / One Tap) antes da expiração de 1 hora.
- **13/10/2026** — Painel de notas: corrigido bug no cabeçalho onde o botão "Notas" do docente era sobrescrito
  por "Minhas notas" assim que os dados eram carregados em segundo plano. O acesso a notas foi ampliado:
  botão "Notas da turma" adicionado dentro do Painel docente; e botão "Notas" incluído nos cards e no
  modal de cada projeto para que docentes possam lançar notas diretamente por equipe.
- **07/10/2026** — Links pelos cards: botão "Links" (para quem pode editar o projeto) abre um modal
  com os quatro links fixos da ficha e uma lista livre de links extras com nome. Os extras ficam na
  planilha de controle, e não na de projetos, porque esta tem colunas fixas. Por decisão do docente,
  link extra incluído por aluno exige aprovação antes de aparecer no site (mais carga para o docente,
  em troca de controle). Os quatro links fixos continuam valendo na hora, com histórico.
- **07/10/2026** — Overleaf: além de `/project/` (privado), link sem `/read/` passou a ser tratado como
  link de **edição** (`overleafStatus: 'edicao'`), sinalizado no card e na auditoria e recusado pelo
  servidor ao salvar a ficha. A regra está nos três conversores e em `statusOverleaf()` do `pi2-live.js`.
- **07/10/2026** — Botão "Canva" renomeado para "Diagrama"; "Drive CP" aparece só no projeto #11.
- **07/10/2026** — Participação por atividade com autoavaliação e avaliação dos colegas. Decidido
  que a avaliação dos alunos não entra direto na nota: o docente vê e define o valor que vale.
  A pasta `dados-alunos/` entrou no `.gitignore`; listas com nome e e-mail não vão para o repositório.
- **06/10/2026** — Painel de notas. Nota por grupo nas entregas, com participação e frequência por
  aluno para diferenciar integrantes; pontualidade calculada das entregas no prazo. Avaliações e
  pesos são configuráveis pelo painel. O aluno só vê o que o docente publicar.
- **06/10/2026** — Login Google + backend em Apps Script. Motivo: a planilha estava editável por
  qualquer pessoa com o link e não havia histórico de quem alterou o quê. Escolhido Apps Script
  por não exigir servidor nem credenciais, já que os dados vivem no Google Planilhas.
- **06/10/2026** — Registros viraram linhas com autor e data (aba `registros`), em vez de texto
  sobrescrito na coluna Avanços. A coluna V passou a ser um espelho dos 6 registros mais recentes.
- **06/10/2026** — E-mails e histórico em planilha de controle separada e privada; a planilha de
  projetos continua pública para leitura.
- **06/10/2026** — `pi2-live.js` e `pi2-live.css` separados do `index.html`, para a camada
  dinâmica evoluir sem tocar no arquivo de 7.600 linhas.
- **06/10/2026** — Raio-X: quadro calculado no topo. Os blocos 1 a 3 continuam sendo texto
  redigido à mão (em 23/09) e estão marcados como tal.

## Pendências

- [ ] Trocar o compartilhamento da planilha de projetos de "Editor" para "Leitor" depois do
      teste com um aluno. Até lá a edição livre continua possível.
- [ ] Cadastrar ou aprovar os integrantes de cada projeto no Painel docente.
- [ ] Notas: decidir qual e-mail liga cada aluno ao login (os do SIGAA incluem endereços de
      familiares; a conta institucional `usuario@aluno.ifsc.edu.br` é a alternativa a confirmar).
- [ ] Notas: a participação por atividade e o componente "Participação" da nota final descontam o
      mesmo comportamento duas vezes; avaliar zerar o peso do componente.
- [ ] Notas: importar a lista da turma (aba Alunos do painel), ligar o e-mail de login de cada
      aluno e revisar os pesos e as avaliações sugeridas, que são ponto de partida e não o combinado
      com a turma.
- [ ] Blocos 1 a 3 do Raio-X: reescrever ou gerar a partir dos registros.
- [ ] Comunicação por e-mail com os grupos (avaliada, não implementada). Os e-mails já ficam
      na aba `membros`, então o próprio Apps Script pode enviar pelo Gmail do dono.
- [ ] Ficha do projeto #11 pelo dashboard (hoje só aceita registros; a ficha fica no `sync_sheet.py`).
- [ ] `2026-2/index.html` ainda concentra CSS, aulas e templates; separar aos poucos.
- [ ] Login de verdade para leitura, caso o dashboard deixe de ser público.
