import { uid } from '../../types';
import type { CatalogItem, ItemKind, Unit } from '../../types';

export type Trade = 'idraulico' | 'elettricista' | 'imbianchino';
export const TRADE_LABEL: Record<Trade, string> = { idraulico: 'Idraulico', elettricista: 'Elettricista', imbianchino: 'Imbianchino' };

type Row = [name: string, aliases: string[], unit: Unit, price: number, vat: number, kind: ItemKind, category: string];

const DATA: Record<Trade, Row[]> = {
  idraulico: [
    ['Manodopera idraulico', ['ora di lavoro', 'manodopera', 'mano d\'opera'], 'h', 38, 22, 'manodopera', 'Manodopera'],
    ['Diritto di chiamata', ['chiamata', 'uscita'], 'corpo', 30, 22, 'servizio', 'Servizi'],
    ['Tubo multistrato 16 mm', ['multistrato sedici', 'tubo multistrato'], 'm', 3.2, 22, 'materiale', 'Tubazioni'],
    ['Tubo multistrato 20 mm', ['multistrato venti'], 'm', 4.5, 22, 'materiale', 'Tubazioni'],
    ['Tubo rame 16 mm', ['rame sedici', 'tubo di rame'], 'm', 9.5, 22, 'materiale', 'Tubazioni'],
    ['Tubo scarico PVC 50 mm', ['scarico cinquanta', 'tubo pvc'], 'm', 4.8, 22, 'materiale', 'Scarichi'],
    ['Tubo scarico PVC 110 mm', ['scarico centodieci'], 'm', 9.8, 22, 'materiale', 'Scarichi'],
    ['Sifone lavabo', ['sifone', 'sifone del lavandino'], 'pz', 12, 22, 'materiale', 'Scarichi'],
    ['Rubinetto miscelatore lavabo', ['miscelatore lavabo', 'rubinetto lavandino'], 'pz', 55, 22, 'materiale', 'Rubinetteria'],
    ['Miscelatore doccia', ['rubinetto doccia', 'miscelatore per doccia'], 'pz', 68, 22, 'materiale', 'Rubinetteria'],
    ['Sanitario WC sospeso', ['water sospeso', 'wc sospeso', 'vaso sospeso'], 'pz', 180, 22, 'materiale', 'Sanitari'],
    ['Cassetta di scarico incasso', ['cassetta wc', 'cassetta incasso'], 'pz', 95, 22, 'materiale', 'Sanitari'],
    ['Scaldabagno elettrico 80 l', ['boiler 80 litri', 'scaldabagno'], 'pz', 230, 22, 'materiale', 'Caldaie e boiler'],
    ['Valvola a sfera 1/2"', ['valvola mezzo pollice', 'rubinetto a sfera'], 'pz', 6.5, 22, 'materiale', 'Raccorderia'],
    ['Raccordo multistrato', ['raccordo', 'giunto multistrato'], 'pz', 3.8, 22, 'materiale', 'Raccorderia'],
    ['Flessibile di collegamento', ['flessibile', 'tubo flessibile'], 'pz', 4.5, 22, 'materiale', 'Raccorderia'],
    ['Disostruzione scarico', ['stasatura', 'sturare lo scarico', 'spurgo'], 'corpo', 90, 22, 'servizio', 'Servizi'],
    ['Ricerca perdite', ['ricerca perdita', 'cerca perdite'], 'corpo', 120, 22, 'servizio', 'Servizi'],
    ['Manutenzione caldaia', ['revisione caldaia', 'controllo caldaia'], 'corpo', 80, 22, 'servizio', 'Servizi'],
    ['Termosifone alluminio', ['radiatore', 'calorifero'], 'pz', 75, 22, 'materiale', 'Riscaldamento'],
  ],
  elettricista: [
    ['Manodopera elettricista', ['ora di lavoro', 'manodopera', 'mano d\'opera'], 'h', 38, 22, 'manodopera', 'Manodopera'],
    ['Diritto di chiamata', ['chiamata', 'uscita'], 'corpo', 30, 22, 'servizio', 'Servizi'],
    ['Cavo FS17 1,5 mmq', ['cavo uno e mezzo', 'filo uno virgola cinque'], 'm', 0.45, 22, 'materiale', 'Cavi'],
    ['Cavo FS17 2,5 mmq', ['cavo due e mezzo', 'filo due virgola cinque'], 'm', 0.7, 22, 'materiale', 'Cavi'],
    ['Cavo FG16 3x2,5 mmq', ['cavo tripolare', 'cavo tre per due e mezzo'], 'm', 2.2, 22, 'materiale', 'Cavi'],
    ['Tubo corrugato 20 mm', ['corrugato venti', 'tubo corrugato'], 'm', 0.6, 22, 'materiale', 'Canaline e tubi'],
    ['Canalina 40x25', ['canalina', 'canaletta'], 'm', 3.5, 22, 'materiale', 'Canaline e tubi'],
    ['Scatola da incasso 3 moduli', ['scatola incasso', 'scatola 503'], 'pz', 1.8, 22, 'materiale', 'Scatole'],
    ['Placca 3 moduli', ['placca', 'placchetta'], 'pz', 6, 22, 'materiale', 'Apparecchi'],
    ['Presa 10/16 A', ['presa', 'presa bipasso', 'presa schuko'], 'pz', 5.5, 22, 'materiale', 'Apparecchi'],
    ['Interruttore 16 A', ['interruttore', 'interruttore luce'], 'pz', 5, 22, 'materiale', 'Apparecchi'],
    ['Deviatore 16 A', ['deviatore'], 'pz', 6, 22, 'materiale', 'Apparecchi'],
    ['Punto luce', ['punto luce completo', 'punto luce a incasso'], 'pz', 55, 22, 'servizio', 'Impianti'],
    ['Punto presa', ['punto presa completo'], 'pz', 48, 22, 'servizio', 'Impianti'],
    ['Interruttore magnetotermico 16 A', ['magnetotermico', 'salvavita piccolo', 'automatico'], 'pz', 14, 22, 'materiale', 'Quadri'],
    ['Interruttore differenziale 25 A', ['differenziale', 'salvavita'], 'pz', 48, 22, 'materiale', 'Quadri'],
    ['Quadro elettrico 12 moduli', ['quadro', 'centralino'], 'pz', 38, 22, 'materiale', 'Quadri'],
    ['Plafoniera LED', ['plafoniera', 'luce a led da soffitto'], 'pz', 28, 22, 'materiale', 'Illuminazione'],
    ['Faretto LED da incasso', ['faretto', 'spot led'], 'pz', 9, 22, 'materiale', 'Illuminazione'],
    ['Messa a terra e verifica impianto', ['verifica impianto', 'messa a terra'], 'corpo', 150, 22, 'servizio', 'Servizi'],
  ],
  imbianchino: [
    ['Manodopera imbianchino', ['ora di lavoro', 'manodopera', 'mano d\'opera'], 'h', 30, 22, 'manodopera', 'Manodopera'],
    ['Diritto di chiamata / sopralluogo', ['sopralluogo', 'chiamata'], 'corpo', 25, 22, 'servizio', 'Servizi'],
    ['Tinteggiatura pareti lavabile', ['imbiancatura pareti', 'tinta pareti', 'pittura pareti'], 'mq', 6.5, 22, 'servizio', 'Tinteggiature'],
    ['Tinteggiatura soffitti', ['imbiancatura soffitto', 'tinta soffitto'], 'mq', 7, 22, 'servizio', 'Tinteggiature'],
    ['Tinteggiatura con smalto', ['smalto', 'verniciatura smalto'], 'mq', 12, 22, 'servizio', 'Tinteggiature'],
    ['Idropittura lavabile bianca 14 l', ['idropittura', 'pittura bianca', 'secchio di pittura'], 'pz', 48, 22, 'materiale', 'Prodotti'],
    ['Pittura traspirante 14 l', ['traspirante', 'pittura traspirante'], 'pz', 62, 22, 'materiale', 'Prodotti'],
    ['Fissativo acrilico 5 l', ['fissativo', 'primer'], 'pz', 24, 22, 'materiale', 'Prodotti'],
    ['Stucco in pasta 5 kg', ['stucco', 'stucco in pasta'], 'pz', 14, 22, 'materiale', 'Prodotti'],
    ['Rasatura pareti', ['rasatura', 'rasare le pareti', 'stuccatura'], 'mq', 9.5, 22, 'servizio', 'Preparazione'],
    ['Carteggiatura e preparazione fondo', ['carteggiatura', 'preparazione pareti'], 'mq', 3.5, 22, 'servizio', 'Preparazione'],
    ['Rimozione carta da parati', ['togliere la carta da parati', 'rimozione tappezzeria'], 'mq', 6, 22, 'servizio', 'Preparazione'],
    ['Posa carta da parati', ['posa tappezzeria', 'applicazione carta da parati'], 'mq', 14, 22, 'servizio', 'Finiture'],
    ['Trattamento antimuffa', ['antimuffa', 'anti muffa'], 'mq', 5.5, 22, 'servizio', 'Preparazione'],
    ['Pittura per esterni', ['tinteggiatura esterna', 'pittura facciata'], 'mq', 9, 22, 'servizio', 'Esterni'],
    ['Verniciatura serramenti', ['verniciatura finestre', 'vernice infissi'], 'pz', 85, 22, 'servizio', 'Finiture'],
    ['Nastro di carta e teli di protezione', ['nastro e teli', 'protezioni'], 'corpo', 25, 22, 'materiale', 'Consumabili'],
    ['Noleggio ponteggio mobile (trabattello)', ['trabattello', 'ponteggio'], 'gg', 45, 22, 'servizio', 'Attrezzature'],
    ['Pennelli e rulli', ['rulli', 'pennelli'], 'corpo', 15, 22, 'materiale', 'Consumabili'],
    ['Smaltimento materiali di risulta', ['smaltimento', 'discarica'], 'corpo', 40, 22, 'servizio', 'Servizi'],
  ],
};

export function sampleItems(trade: Trade): CatalogItem[] {
  const now = Date.now();
  return DATA[trade].map(([name, aliases, unit, price, vat, kind, category]) => ({
    id: uid(), name, aliases, unit, price, vat, kind, category, createdAt: now, updatedAt: now,
  }));
}
