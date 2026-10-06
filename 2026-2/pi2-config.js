/* Configuração do dashboard PI-II. Os dois valores abaixo são públicos por natureza
   (aparecem no navegador de qualquer visitante); nenhuma senha ou segredo fica aqui.
   Enquanto estiverem vazios, o dashboard funciona só para leitura, como antes. */
window.PI2_CONFIG = {
  // URL do app da web do Apps Script (termina em /exec). Ver apps-script/README-IMPLANTACAO.md
  apiUrl: 'https://script.google.com/macros/s/AKfycbwGshMTHxB1uC_KWrQttNQeEe7IzR4b_bZrk0DbZvrgZ7l7apctlFsjAOl7vj9DAAM/exec',

  // ID do cliente OAuth do Google Cloud (termina em .apps.googleusercontent.com)
  googleClientId: '827223670130-f312ur39hg8bamvbce5noc0iaajq8b1a.apps.googleusercontent.com',

  // Planilha pública usada como reserva quando o apiUrl está vazio ou fora do ar.
  sheetId: '1w7wAwPBdNTfh7lvynoP7x35S__lvRyuTjRqP26oEhNQ',
  sheetTab: 'Visao-geral',

  // Dias sem registro a partir dos quais um grupo aparece como "parado" no Raio-X.
  diasParado: 14
};
