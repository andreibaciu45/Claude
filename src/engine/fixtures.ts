import type { CatalogItem, ItemKind, Unit } from '../types';

const mk = (
  id: string,
  name: string,
  aliases: string[],
  unit: Unit,
  price: number,
  kind: ItemKind = 'materiale',
  vat = 22,
  category?: string,
): CatalogItem => ({ id, name, aliases, unit, price, vat, kind, category, createdAt: 0, updatedAt: 0 });

/** Catalogo di esempio realistico: idraulico + elettricista + imbianchino. */
export const SAMPLE_CATALOG: CatalogItem[] = [
  // --- idraulico
  mk('tubo-rame-16', 'Tubo rame 16 mm', ['tubo di rame 16', 'rame sedici', 'tubo rame da 16', 'rame 16'], 'm', 8.5, 'materiale', 22, 'idraulica'),
  mk('tubo-rame-22', 'Tubo rame 22 mm', ['tubo di rame 22', 'rame ventidue', 'tubo rame da 22', 'rame 22'], 'm', 12.9, 'materiale', 22, 'idraulica'),
  mk('multistrato-16', 'Tubo multistrato 16 mm', ['multistrato 16', 'multistrato sedici', 'tubo multistrato'], 'm', 3.2, 'materiale', 22, 'idraulica'),
  mk('raccordo-gomito', 'Raccordo a gomito 16 mm', ['raccordo gomito', 'gomito 16', 'curva 90', 'raccordi a gomito'], 'pz', 2.4, 'materiale', 22, 'idraulica'),
  mk('raccordo-t', 'Raccordo a T 16 mm', ['raccordo a tee', 'tee 16', 'raccordo a t'], 'pz', 3.1, 'materiale', 22, 'idraulica'),
  mk('rubinetto-lavabo', 'Rubinetto miscelatore lavabo', ['miscelatore lavabo', 'rubinetto lavabo', 'rubinetto bagno', 'miscelatore'], 'pz', 65, 'materiale', 22, 'idraulica'),
  mk('sanitari', 'Sanitari sospesi (wc e bidet)', ['sanitari', 'coppia sanitari', 'wc e bidet', 'vaso e bidet'], 'pz', 380, 'materiale', 22, 'idraulica'),
  mk('sifone', 'Sifone lavabo', ['sifone', 'sifone bagno'], 'pz', 14, 'materiale', 22, 'idraulica'),
  mk('scarico-pvc', 'Tubo scarico PVC 50 mm', ['scarico pvc', 'tubo pvc 50', 'tubo di scarico'], 'm', 4.8, 'materiale', 22, 'idraulica'),
  mk('caldaia-vaillant', 'Caldaia a condensazione Vaillant 24 kW', ['caldaia vaillant', 'caldaia a condensazione', 'caldaia'], 'pz', 1450, 'materiale', 10, 'idraulica'),
  mk('scaldabagno', 'Scaldabagno elettrico 80 litri', ['boiler 80', 'scaldabagno', 'boiler'], 'pz', 240, 'materiale', 22, 'idraulica'),
  mk('man-idraulico', 'Manodopera idraulico', ['manodopera', 'ore di manodopera', 'manodopera idraulica', 'ora di lavoro idraulico'], 'h', 35, 'manodopera', 22, 'idraulica'),
  // --- elettricista
  mk('cavo-2-5', 'Cavo elettrico FS17 2,5 mm²', ['cavo 2,5', 'cavo due virgola cinque', 'filo 2,5', 'cavo elettrico 2,5'], 'm', 0.95, 'materiale', 22, 'elettrico'),
  mk('cavo-1-5', 'Cavo elettrico FS17 1,5 mm²', ['cavo 1,5', 'cavo uno virgola cinque', 'filo 1,5', 'cavo elettrico 1,5'], 'm', 0.65, 'materiale', 22, 'elettrico'),
  mk('cavo-4', 'Cavo elettrico FS17 4 mm²', ['cavo 4', 'cavo quattro', 'filo 4', 'cavo elettrico 4'], 'm', 1.5, 'materiale', 22, 'elettrico'),
  mk('punto-luce', 'Punto luce completo', ['punto luce', 'punti luce', 'punto luce a parete'], 'pz', 55, 'servizio', 22, 'elettrico'),
  mk('presa', 'Presa elettrica 10/16A', ['presa', 'prese', 'presa elettrica', 'punto presa'], 'pz', 28, 'materiale', 22, 'elettrico'),
  mk('interruttore', 'Interruttore da incasso', ['interruttore', 'interruttori', 'deviatore'], 'pz', 18, 'materiale', 22, 'elettrico'),
  mk('salvavita', 'Interruttore differenziale (salvavita)', ['salvavita', 'salva vita', 'differenziale', 'interruttore differenziale'], 'pz', 85, 'materiale', 22, 'elettrico'),
  mk('quadro', 'Quadro elettrico 12 moduli', ['quadro elettrico', 'centralino', 'quadro'], 'pz', 160, 'materiale', 22, 'elettrico'),
  mk('faretto', 'Faretto LED da incasso', ['faretto', 'faretti', 'faretti led', 'spot led'], 'pz', 12, 'materiale', 22, 'elettrico'),
  mk('corrugato', 'Tubo corrugato 20 mm', ['corrugato', 'guaina corrugata', 'tubo corrugato'], 'm', 0.55, 'materiale', 22, 'elettrico'),
  mk('man-elettricista', 'Manodopera elettricista', ['manodopera elettrica', 'ore di lavoro elettricista', 'ora elettricista'], 'h', 38, 'manodopera', 22, 'elettrico'),
  // --- imbianchino
  mk('tinteggiatura', 'Tinteggiatura pareti', ['tinteggiatura', 'tinteggiare', 'dipingere', 'imbiancare', 'imbiancatura', 'pitturare', 'verniciare pareti'], 'mq', 8.5, 'servizio', 22, 'imbiancatura'),
  mk('idropittura', 'Idropittura lavabile bianca', ['idropittura', 'pittura bianca', 'pittura lavabile', 'vernice bianca'], 'l', 6.5, 'materiale', 22, 'imbiancatura'),
  mk('stucco', 'Stucco in pasta', ['stucco', 'stucco in pasta'], 'kg', 3.2, 'materiale', 22, 'imbiancatura'),
  mk('rasatura', 'Stuccatura e rasatura pareti', ['stuccatura', 'rasatura', 'rasare', 'stuccare pareti'], 'mq', 12, 'servizio', 22, 'imbiancatura'),
  mk('cartongesso', 'Controsoffitto in cartongesso', ['cartongesso', 'controsoffitto'], 'mq', 38, 'servizio', 22, 'imbiancatura'),
  mk('smalto', 'Smalto per infissi', ['smalto', 'smalto infissi', 'smalto lucido'], 'l', 14, 'materiale', 22, 'imbiancatura'),
  mk('rimozione-carta', 'Rimozione carta da parati', ['rimozione carta', 'togliere carta da parati', 'carta da parati'], 'mq', 6, 'servizio', 22, 'imbiancatura'),
  mk('giornata-operaio', 'Giornata operaio', ['giornata', 'giornata di lavoro', 'giornata operaio', 'giorno di lavoro'], 'gg', 280, 'manodopera', 22, 'generale'),
  // --- generale
  mk('piastrelle', 'Piastrelle gres 60x60', ['piastrelle', 'pavimento gres', 'gres porcellanato'], 'mq', 24, 'materiale', 22, 'generale'),
  mk('posa-piastrelle', 'Posa piastrelle', ['posa pavimento', 'posa gres', 'posa pavimenti'], 'mq', 30, 'servizio', 22, 'generale'),
  mk('trasporto', 'Trasporto e smaltimento', ['trasporto', 'smaltimento', 'discarica', 'smaltimento macerie'], 'corpo', 80, 'servizio', 22, 'generale'),
];

/** Catalogo ridotto per un solo mestiere (test su cataloghi piccoli). */
export const CATALOG_IDRAULICO = SAMPLE_CATALOG.filter((i) => i.category === 'idraulica');
export const CATALOG_ELETTRICO = SAMPLE_CATALOG.filter((i) => i.category === 'elettrico');
