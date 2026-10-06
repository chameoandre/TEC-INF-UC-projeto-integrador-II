# Ativar o login e o envio de registros pelo dashboard

Enquanto estes passos não forem feitos, o dashboard continua funcionando só para leitura.
São cerca de 20 minutos, uma única vez. Faça tudo logado como **chameoandre@gmail.com**, que é a dona da planilha.

## Como funciona

```
Aluno (navegador)  ──login Google──▶  token de identidade
        │
        ▼  envia registro + token
Apps Script (roda com a SUA conta)
        │  1. confere o token com o Google
        │  2. descobre o e-mail e procura na aba "membros"
        │  3. só grava se a pessoa for do projeto
        ▼
Planilha de projetos (pública, somente leitura)   +   Planilha de controle (privada)
```

A planilha de controle é criada automaticamente e guarda três abas: `membros` (quem pode
editar o quê), `registros` (cada avanço, com autor e data) e `alteracoes` (cada campo de
ficha alterado, com o valor anterior). Os e-mails dos alunos ficam só nela.

## Passo 1 — Criar o ID de cliente do Google (login)

1. Abra <https://console.cloud.google.com/> e crie um projeto, por exemplo `pi2-dashboard`.
2. Menu **APIs e serviços → Tela de permissão OAuth** (ou **Google Auth Platform**):
   tipo de usuário **Externo**, nome do app `Dashboard PI-II`, seu e-mail como suporte.
   Não adicione escopos. Ao terminar, clique em **Publicar app** (status "Em produção").
3. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**.
4. Em **Origens JavaScript autorizadas**, adicione:
   - `https://chameoandre.github.io`
   - `http://localhost:8000` (opcional, para testar na sua máquina)
5. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`).

## Passo 2 — Criar o Apps Script

1. Abra <https://script.google.com/> → **Novo projeto**, nome `PI2 backend`.
2. Apague o conteúdo de `Código.gs` e cole todo o arquivo `apps-script/Code.gs`.
3. No topo, em `CONFIG`, troque `GOOGLE_CLIENT_ID` pelo ID copiado no passo 1.
   Confira também `DOCENTES` e `DOMINIOS_PERMITIDOS` (domínios dos e-mails dos alunos).
4. Escolha a função **`instalar`** na barra superior e clique em **Executar**.
   Autorize quando o Google pedir. O registro de execução mostra o link da planilha de controle.

## Passo 3 — Publicar como app da Web

1. **Implantar → Nova implantação → tipo App da Web**.
2. **Executar como:** Eu. **Quem pode acessar:** Qualquer pessoa.
3. Clique em **Implantar** e copie a **URL do app da Web** (termina em `/exec`).

"Qualquer pessoa" aqui significa apenas que o navegador do aluno consegue chamar o script.
Quem decide o que pode ser gravado é o próprio script, pelo token de login.

## Passo 4 — Ligar o dashboard

Edite `2026-2/pi2-config.js`:

```js
apiUrl: 'https://script.google.com/macros/s/…/exec',
googleClientId: '….apps.googleusercontent.com',
```

Faça commit e push. Em um ou dois minutos o botão "Fazer login com o Google" aparece no cabeçalho.

## Passo 5 — Testar e cadastrar a turma

1. Entre no dashboard com sua conta de docente. Deve aparecer o botão **Painel docente**.
2. Os alunos entram com a conta deles e escolhem o projeto; o pedido aparece no painel para você aprovar.
   Se preferir, cadastre os e-mails você mesmo em **Cadastrar ou alterar integrante**.
3. Faça um registro de teste em um projeto e confira a linha do tempo e a coluna AVANÇOS da planilha.

## Passo 6 — Fechar a edição livre da planilha

Só depois do teste: na planilha `PI-2-2026-INF-2024-dashboard-de-projetos`, **Compartilhar →
Acesso geral → Qualquer pessoa com o link → Leitor**. A partir daí, aluno nenhum edita a
planilha diretamente; tudo passa pelo dashboard. Os docentes continuam como editores.

## Depois de alterar o Code.gs

**Implantar → Gerenciar implantações → lápis → Versão: Nova versão → Implantar.**
A URL continua a mesma.

## Limites conhecidos

- O login vale por 1 hora; depois o aluno clica em entrar de novo.
- Cada pessoa pode enviar até 12 registros ou alterações por hora.
- O plano individual (#11) não tem linha na planilha: aceita registros, mas a ficha dele
  continua sendo editada em `scripts/sync_sheet.py`.
