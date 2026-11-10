/* Configuração do dashboard PI-II. Os dois valores abaixo são públicos por natureza
   (aparecem no navegador de qualquer visitante); nenhuma senha ou segredo fica aqui.
   Enquanto estiverem vazios, o dashboard funciona só para leitura, como antes. */
window.PI2_CONFIG = {
  // URL do app da web do Apps Script (termina em /exec). Ver apps-script/README-IMPLANTACAO.md
  apiUrl: 'https://script.google.com/macros/s/AKfycbxm4uKLXT9_lg827-dVINCuEqplZLGvn47q6wWli8iOyuUD3ZuroquoCF7A7Lme3r4/exec',

  // ID do cliente OAuth do Google Cloud (termina em .apps.googleusercontent.com)
  googleClientId: '827223670130-f312ur39hg8bamvbce5noc0iaajq8b1a.apps.googleusercontent.com',

  // Planilha pública usada como reserva quando o apiUrl está vazio ou fora do ar.
  sheetId: '1w7wAwPBdNTfh7lvynoP7x35S__lvRyuTjRqP26oEhNQ',
  sheetTab: 'Visao-geral',

  // Dias sem registro a partir dos quais um grupo aparece como "parado" no Raio-X.
  diasParado: 14,

  // Equipe Docente & Professores Orientadores (Titulares, Substitutos e Coorientadores com Acesso Administrativo)
  docentesIniciais: [
    {
      nome: 'Prof. Dr. André Moraes',
      email: 'andre.moraes@ifsc.edu.br',
      tipo: 'titular',
      status: 'ativo',
      periodo: 'Semestre 2026/2 (Titular)',
      observacao: 'Docente titular responsável pelo laboratório e submissão COTB 2027'
    },
    {
      nome: 'Prof. Me. Karyna do Val Landra',
      email: 'karyna.landra@ifsc.edu.br',
      tipo: 'titular',
      status: 'ativo',
      periodo: 'Semestre 2026/2 (Titular)',
      observacao: 'Docente titular de Projeto Integrador II'
    },
    {
      nome: 'Prof. Dr. Nauber Gavski da Silva',
      email: 'nauber.gavski@ifsc.edu.br',
      tipo: 'titular',
      status: 'ativo',
      periodo: 'Semestre 2026/2 (Titular)',
      observacao: 'Docente titular de Projeto Integrador II'
    },
    {
      nome: 'Prof. André Moraes (Pessoal / Testes)',
      email: 'chameoandre@gmail.com',
      tipo: 'titular',
      status: 'ativo',
      periodo: 'Acesso Administrativo',
      observacao: 'Conta para testes e contingência'
    }
  ]
};
