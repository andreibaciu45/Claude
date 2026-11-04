// STUB — l'agente AREA PERSONALE lo implementa con le stesse firme (vedi docs/ARCHITECTURE.md).
import type { CatalogItem, DocType, Profile, QuoteDocument } from '../types';
const ni = (): never => { throw new Error('storage non implementato'); };
export const getProfile = async (): Promise<Profile> => ni();
export const saveProfile = async (_p: Profile): Promise<void> => ni();
export const listCatalog = async (): Promise<CatalogItem[]> => ni();
export const saveCatalogItem = async (_i: CatalogItem): Promise<void> => ni();
export const deleteCatalogItem = async (_id: string): Promise<void> => ni();
export const listDocuments = async (): Promise<QuoteDocument[]> => ni();
export const getDocument = async (_id: string): Promise<QuoteDocument | undefined> => ni();
export const saveDocument = async (_d: QuoteDocument): Promise<void> => ni();
export const deleteDocument = async (_id: string): Promise<void> => ni();
export const nextDocumentNumber = async (_t: DocType): Promise<string> => ni();
export const exportBackup = async (): Promise<string> => ni();
export const importBackup = async (_json: string): Promise<void> => ni();
