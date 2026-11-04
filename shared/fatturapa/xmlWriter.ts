/** Mini-scrittore XML: alberi di nodi, indentazione a 2 spazi, escape su tutti i testi. */
import { escapeXml } from './text';

export interface XNode {
  name: string;
  text?: string;
  children?: XNode[];
}

export type XChild = XNode | null | undefined | false | '';

/** Nodo con figli; i valori falsy sono ignorati (comodo per gli elementi opzionali). */
export const el = (name: string, ...children: XChild[]): XNode => ({
  name,
  children: children.filter((c): c is XNode => !!c),
});

/** Nodo foglia con testo. */
export const leaf = (name: string, text: string): XNode => ({ name, text });

/** Foglia opzionale: assente se il testo è vuoto/undefined. */
export const optLeaf = (name: string, text: string | undefined | null): XNode | null =>
  text ? leaf(name, text) : null;

export const renderNode = (node: XNode, depth = 1): string => {
  const pad = '  '.repeat(depth);
  if (node.children) {
    const inner = node.children.map((c) => renderNode(c, depth + 1)).join('\n');
    return inner ? `${pad}<${node.name}>\n${inner}\n${pad}</${node.name}>` : `${pad}<${node.name}/>`;
  }
  return `${pad}<${node.name}>${escapeXml(node.text ?? '')}</${node.name}>`;
};
