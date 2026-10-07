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
| `notasPainel`, `salvarPesos`, `salvarQuesito`, `lancarNota`, `salvarAlunos`, `importarAlunos`, `publicarNotas`, `abrirPares`, `salvarRegra` | docente | Painel de notas (ver seção "Notas"). Cada uma devolve o estado completo já recalculado. |
| `minhasNotas`, `avaliarParticipacao` | aluno ligado à lista da turma | Notas publicadas do próprio aluno; e a avaliação de participação dele e dos colegas nas atividades abertas. |

Papéis: `docente` (lista `CONFIG.DOCENTES` ou aba `membros`), `aluno` (aba `membros`, situação
`ativo`, com os números dos projetos). Alunos só alteram os campos de `CAMPOS_ALUNO`.

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

## Decisões (mais recente primeiro)

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
