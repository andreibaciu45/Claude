/**
 * SET DI VERIFICA FINALE: 80 frasi nuove, scritte DOPO le correzioni al motore e MAI usate per tararlo.
 * Il numero registrato in bench/RESULTS.md è quello del primo passaggio su questo set.
 */
import { forTrade, type BCase } from './types';

const I = forTrade('idraulico');
const E = forTrade('elettricista');
const M = forTrade('imbianchino');
const S = forTrade('serramentista');
const U = forTrade('muratore');
const C = forTrade('manutentore');

export const FINAL_SET: BCase[] = [
  // ---- idraulico
  I.c('preventivo per Paolo Ferretti sostituzione di due rubinetti lavabo e un miscelatore doccia compresa manodopera due ore', [I.l('misc-lavabo', 2), I.l('misc-doccia', 1), I.l('man', 2, 'h')], { cust: 'Paolo Ferretti' }),
  I.c('dodici metri di tubo multistrato da sedici più sei gomiti da sedici', [I.l('multi16', 12, 'm'), I.l('gomito16', 6)]),
  I.c('installo un vaso sospeso e un bidet con due rubinetti di arresto', [I.l('vaso', 1), I.l('bidet', 1), I.l('arresto', 2)]),
  I.c('per la signora Bianca Albertini scaldabagno da 50 litri a 220 euro', [I.l('boiler50', 1, 'pz', { price: 220 })], { cust: 'Bianca Albertini', tag: 'prezzo' }),
  I.c('ricerca perdite e mezza giornata di lavoro', [I.l('perdite', 1), I.l('giornata', 0.5, 'gg')]),
  I.c('sei termosifoni con sei valvole termostatiche e sei detentori', [I.l('radiatore', 6), I.l('valvtermo', 6), I.l('detentore', 6)]),
  I.c('trenta centimetri di tubo di rame da 22', [I.l('rame22', 0.3, 'm')], { tag: 'unita' }),
  I.c('tre ore di aiutante e quattro ore di idraulico', [I.l('aiuto', 3, 'h'), I.l('man', 4, 'h')]),
  I.c("quattro sifoni bagno a venti euro l'uno", [I.l('sifone', 4, 'pz', { price: 20 })], { tag: 'prezzo' }),
  I.c('un box doccia con piatto da 80 più iva', [I.l('box', 1), I.l('piatto', 1)], { clean: true, tag: 'iva' }),
  I.c('disostruzione scarico cucina a corpo con sconto dieci euro', [I.l('disost', 1, 'corpo')], { disc: { amount: 10 }, clean: true, tag: 'sconto' }),
  I.c('due pozzetti e un collettore', [I.l('pozzetto', 2), I.l('collettore', 1)]),
  I.c('scarico pvc 110 otto metri e tre curve da 20', [I.l('pvc110', 8, 'm'), I.l('gomito20', 3)]),
  I.c('condominio San Marco quattro addolcitori', [I.l('addolcitore', 4)], { cust: 'Condominio San Marco', tag: 'cliente' }),
  // ---- elettricista
  E.c('per Luca Mancuso otto punti presa e dodici punti luce e un quadro elettrico da 24 moduli', [E.l('ptpresa', 8), E.l('ptluce', 12), E.l('quadro24', 1)], { cust: 'Luca Mancuso', tag: 'cliente' }),
  E.c('cinquanta metri di cavo tripolare da 2,5 e cento metri di cavo da 1,5', [E.l('fg3x25', 50, 'm'), E.l('fs15', 100, 'm')]),
  E.c("dieci prese usb a trenta euro l'una", [E.l('presausb', 10, 'pz', { price: 30 })], { tag: 'prezzo' }),
  E.c('tre magnetotermici da trentadue e un salvavita', [E.l('mt32', 3), E.l('salvavita', 1)]),
  E.c('un videocitofono e un campanello', [E.l('videocit', 1), E.l('campanello', 1)]),
  E.c('venti centimetri di striscia led', [E.l('striscia', 0.2, 'm')], { tag: 'unita' }),
  E.c('sei faretti incasso', [E.l('faretto', 6)]),
  E.c('2 plafoniere e 4 applique per Giulio Cesare Barbieri', [E.l('plafo', 2), E.l('applique', 4)], { cust: 'Giulio Cesare Barbieri', tag: 'cliente' }),
  E.c('come da preventivo precedente più due prese tv', [E.l('presatv', 2)], { prev: true, tag: 'prev' }),
  E.c('cavo di rete cat 6 settanta metri', [E.l('utp', 70, 'm')]),
  E.c('aspiratore bagno, sensore di movimento, lampada di emergenza', [E.l('aspiratore', 1), E.l('sensore', 1), E.l('emergenza', 1)]),
  E.c('una wallbox con messa a terra e dichiarazione di conformità', [E.l('wallbox', 1), E.l('terra', 1), E.l('conf', 1)]),
  E.c('sei ore di manodopera con sconto del 5%', [E.l('man', 6, 'h')], { disc: { pct: 5 }, clean: true, tag: 'sconto' }),
  E.c('cinque deviatori e tre pulsanti iva al dieci per cento', [E.l('dev', 5), E.l('puls', 3)], { vat: 10, clean: true, tag: 'iva' }),
  // ---- imbianchino / cartongessista
  M.c('tinteggiatura soffitto soggiorno 30 mq e soffitto camera 20 mq', [M.l('tint-soffitti', 30, 'mq', { note: 'soggiorno' }), M.l('tint-soffitti', 20, 'mq', { note: 'camera' })], { tag: 'doppia' }),
  M.c('dieci chili di stucco in pasta e due sacchi di rasante', [M.l('stucco', 10, 'kg'), M.l('rasante', 2)]),
  M.c('rasatura 25 mq tinteggiatura 25 mq due mani', [M.l('rasatura', 25, 'mq'), M.l('tint-pareti', 25, 'mq', { coats: 2 })], { clean: true, tag: 'mani' }),
  M.c('controparete in cartongesso 14 metri quadri con lana di roccia', [M.l('cg-controparete', 14, 'mq'), M.l('lana', 1)]),
  M.c('per la ditta Edilnova srl verniciatura sei persiane e quattro porte', [M.l('persiane', 6), M.l('porte', 4)], { cust: 'Ditta Edilnova SRL', tag: 'cliente' }),
  M.c('ottocento euro a corpo per tinteggiatura vano scale', [M.l('tint-scale', 1, 'corpo', { price: 800 })], { tag: 'prezzo' }),
  M.c('mezza giornata di imbianchino e mezza giornata di aiutante', [M.l('giornata', 0.5, 'gg'), M.l('giornata-aiuto', 0.5, 'gg')]),
  M.c('lastra idrofuga venti pezzi e profilo montante cinquanta metri', [M.l('lastra-idro', 20, 'pz'), M.l('montante', 50, 'm')]),
  M.c('tinteggiare bagno 12 mq e cucina 18 mq iva al dieci', [M.l('tint-pareti', 12, 'mq', { note: 'bagno' }), M.l('tint-pareti', 18, 'mq', { note: 'cucina' })], { vat: 10, clean: true, tag: 'doppia' }),
  M.c('quindici litri di antimuffa e tre litri di fissativo', [M.l('antimuffa', 15, 'l'), M.l('fissativo', 3, 'l')]),
  M.c('cappotto interno 20 mq sconto del dieci per cento', [M.l('cappotto', 20, 'mq')], { disc: { pct: 10 }, clean: true, tag: 'sconto' }),
  M.c('pulizia finale e protezioni a corpo', [M.l('pulizia', 1), M.l('protezioni', 1, 'corpo')]),
  // ---- serramentista / falegname
  S.c('per il signor Elia Caruso quattro finestre pvc 100 per 120 e una portafinestra', [S.l('fin-pvc', 4), S.l('portafin', 1)], { cust: 'Elia Caruso', tag: 'misure' }),
  S.c('cinque metri quadri di tapparella avvolgibile e due motori', [S.l('tapparella', 5, 'mq'), { free: 'motori', qty: 2 }]),
  S.c('parquet rovere 45 mq, posa parquet 45 mq e levigatura 45 mq', [S.l('parquet', 45, 'mq'), S.l('posa-parquet', 45, 'mq'), S.l('levigatura', 45, 'mq')]),
  S.c('sei metri di battiscopa in legno e dodici coprifili', [S.l('battiscopa', 6, 'm'), S.l('coprifilo', 12)]),
  S.c('sopralluogo', [S.l('sopralluogo', 1)]),
  S.c('armadio su misura tre metri quadri con quattro antine', [S.l('armadio', 3, 'mq'), S.l('antina', 4)]),
  S.c('una porta blindata a 1400 euro più iva', [S.l('blindata', 1, 'pz', { price: 1400 })], { clean: true, tag: 'iva' }),
  S.c("per l'avvocato Sandri tre finestre in legno", [S.l('fin-legno', 3)], { cust: 'Sandri', tag: 'cliente' }),
  S.c('smontaggio di cinque vecchie finestre e smaltimento a corpo', [S.l('smont-infisso', 5), S.l('smaltimento', 1, 'corpo')]),
  S.c('cancello in ferro dieci metri quadri e ringhiera quindici metri', [S.l('cancello', 10, 'mq'), S.l('ringhiera', 15, 'm')]),
  S.c('otto cerniere, due maniglie e due serrature', [S.l('cerniera', 8), S.l('maniglia', 2), S.l('serratura', 2)]),
  // ---- muratore / edile
  U.c('demolizione pavimento bagno 8 mq, rimozione rivestimento 20 mq e smaltimento macerie a corpo 300 euro', [U.l('dem-pav', 8, 'mq'), U.l('dem-rivest', 20, 'mq'), U.l('macerie', 1, 'corpo', { price: 300 })], { tag: 'prezzo' }),
  U.c('massetto 60 metri quadri più posa gres 60 metri quadri', [U.l('massetto', 60, 'mq'), U.l('posa-piastrelle', 60, 'mq')]),
  U.c('venti sacchi di cemento tre metri cubi di sabbia e due di ghiaia', [U.l('cemento', 20), U.l('sabbia', 3, 'mc'), U.l('ghiaia', 2)]),
  U.c('per il geometra Ugo Salvi apertura di due vani porta', [U.l('apertura-vano', 2)], { cust: 'Ugo Salvi', tag: 'cliente' }),
  U.c('scavo a mano 12 metri cubi', [U.l('scavo', 12, 'mc')]),
  U.c('ponteggio per 200 metri quadri', [U.l('ponteggio', 200, 'mq')]),
  U.c('impermeabilizzazione balcone 14 mq', [U.l('imperm', 14, 'mq')]),
  U.c('intonaco 120 mq sconto del 3%', [U.l('intonaco', 120, 'mq')], { disc: { pct: 3 }, clean: true, tag: 'sconto' }),
  U.c('otto ore di manovale e dieci ore di muratore', [U.l('manovale', 8, 'h'), U.l('man', 10, 'h')]),
  U.c('pozzetti in cemento quattro e grondaia in rame otto metri', [U.l('pozzetto', 4), U.l('grondaia', 8, 'm')]),
  U.c("milleduecento mattoni forati a 0,80 euro l'uno", [U.l('mattoni', 1200, 'pz', { price: 0.8 })], { tag: 'prezzo' }),
  // ---- manutentore caldaie / climatizzatori
  C.c('per la signora Rita Gentile manutenzione annuale caldaia più analisi di combustione a 40 euro', [C.l('manut-caldaia', 1), C.l('analisi', 1, 'pz', { price: 40 })], { cust: 'Rita Gentile', tag: 'cliente' }),
  C.c('due split 12000 btu e dodici metri di linea frigorifera', [C.l('split12', 2), C.l('linea', 12, 'm')]),
  C.c('ricarica gas r410 mezzo chilo', [C.l('gas-r410', 0.5, 'kg')]),
  C.c('cinque pulizie filtri split e cinque sanificazioni', [C.l('filtri', 5), C.l('sanif', 5)]),
  C.c('sostituzione circolatore e vaso di espansione, due ore di manodopera', [C.l('circolatore', 1), C.l('vasoesp', 1), C.l('man', 2, 'h')]),
  C.c('pronto intervento più diritto di chiamata', [C.l('urgenza', 1), C.l('uscita', 1)]),
  C.c('una caldaia a condensazione ventiquattro kw con kit scarico fumi e termostato', [C.l('caldaia24', 1), C.l('kit-fumi', 1), C.l('termostato', 1)]),
  C.c('otto ore di ricerca guasto', [C.l('guasto', 8, 'h')]),
  C.c('manutenzione pompa di calore a 150 euro più iva', [C.l('manut-pdc', 1, 'pz', { price: 150 })], { clean: true, tag: 'iva' }),
  C.c('tre cartucce anticalcare e due litri di additivo', [C.l('addolc-cart', 3), C.l('additivo', 2, 'l')]),
  C.c('novanta minuti di tecnico', [C.l('man', 1.5, 'h')], { tag: 'unita' }),
  C.c('per condominio Parco Verde tagliando a tre caldaie', [C.l('manut-caldaia', 3)], { cust: 'Condominio Parco Verde', tag: 'cliente' }),
  // ---- frasi "sporche" da cantiere
  E.c('allora ok per Giovanni Pace metti due prese una wallbox e basta', [E.l('presa', 2), E.l('wallbox', 1)], { cust: 'Giovanni Pace', tag: 'cliente' }),
  I.c('fai la fattura a Mario Esposito per quattro ore di manodopera', [I.l('man', 4, 'h')], { cust: 'Mario Esposito', tag: 'cliente' }),
  E.c('dieci metri di tubo corrugato 20 poi cavo 2,5 dieci metri e cavo 1,5 dieci metri', [E.l('corr20', 10, 'm'), E.l('fs25', 10, 'm'), E.l('fs15', 10, 'm')]),
  M.c('metti 30 mq di rasatura 30 mq di tinteggiatura e 12 mq di controsoffitto', [M.l('rasatura', 30, 'mq'), M.l('tint-pareti', 30, 'mq'), M.l('cg-contro', 12, 'mq')]),
  I.c('tubo rame 16 5 metri, tubo rame 22 8 metri', [I.l('rame16', 5, 'm'), I.l('rame22', 8, 'm')]),
  I.c('due virgola cinque ore di manodopera', [I.l('man', 2.5, 'h')]),
];
