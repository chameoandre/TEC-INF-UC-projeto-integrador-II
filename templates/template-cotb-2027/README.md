# Template COTB 2027 (ACM sigconf, duas colunas) — versão corrigida para o Overleaf

Template da Trilha Principal do XVIII Computer on the Beach (Florianópolis/SC, 13 a 17 de abril de 2027),
preparado para os grupos do Projeto Integrador II (IFSC Garopaba).

**Abrir direto no Overleaf:**
https://www.overleaf.com/docs?snip_uri=https%3A%2F%2Fchameoandre.github.io%2FTEC-INF-UC-projeto-integrador-II%2Ftemplates%2Ftemplate-cotb-2027.zip&snip_name=COTB%202027%20-%20Artigo

O link cria uma cópia nova do template na conta Overleaf de quem clicar. Cada grupo deve abrir **uma vez**,
compartilhar o projeto com os colegas e os orientadores, e continuar sempre nesse mesmo projeto.

## O que é

O template oficial, publicado em <https://computeronthebeach.com.br/trilha-principal.html>
(arquivo `template_cotb2027.tex`), usa a classe `acmart` no formato `sigconf` (duas colunas).

Esta versão corrige três problemas do arquivo publicado, sem mudar classe, margens ou formatação:

1. Os acentos estavam gravados como entidades HTML (`Introdu&ccedil;&atilde;o`), o que impede a compilação.
2. A imagem `figura_exemplo.png`, usada no exemplo de figura, não era distribuída.
3. O comentário das referências falava em 8 páginas; o limite do Artigo Completo é 6.

Na dúvida, vale o que estiver publicado no site do evento.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `main.tex` | O artigo. Os campos entre colchetes `[ ]` devem ser substituídos. |
| `figura_exemplo.png` | Figura do exemplo. Apague quando usar as figuras do grupo. |

O Overleaf já tem a classe `acmart` e o estilo `ACM-Reference-Format`; não é preciso enviar `.cls` nem `.bst`.

## Lembretes da chamada

- Artigo Completo: até 6 páginas, com referências. Resumo Estendido: até 3 páginas (o template e as
  instruções gerais dizem 3; a página da trilha diz 2 — confirme com a organização antes de submeter).
- Título, abstract e keywords em inglês são obrigatórios; texto em português também leva o título em português (`\translatedtitle`).
- Versão de avaliação **anônima**: troque a linha do `\documentclass` pela que tem a opção `anonymous` e remova nomes, afiliações e agradecimentos.
- A Declaração de Uso de Inteligência Artificial é obrigatória nas duas versões.
- Submissão em PDF pelo JEMS3 até 15/11/2026.
