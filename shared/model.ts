export const SPACES = ['표지', '현관', '거실', '주방', '안방', '작은방', '욕실', '기타'] as const;
export type Space = typeof SPACES[number];
export type Phase = 'site' | 'compare' | 'assets' | 'write' | 'publish';
export type Role = 'photo' | 'construction' | 'floorplan-original' | 'floorplan-target';
export interface ComplexDetails {name:string;region:string;url:string;text:string;types:string[];images:{label:string;url:string}[];supplyArea:string;exclusiveArea:string;selectedType:string;notice:string;}
export interface Site { name: string; region: string; type: string; supplyArea: string; exclusiveArea: string; sourceUrl: string; details?:ComplexDetails;floorplanAssetId?:string;}
export interface SourceConflict {id:string;space:string;topic:string;constructionFactIds:string[];cafeFactIndexes:number[];reason:string;decision:'pending'|'construction'|'cafe'|'both'|'exclude'|'custom';customText:string;}
export interface SourceReview {signature:string;checkedAt:string;cafeFacts:{space:string;item:string;evidence:string;uncertain:boolean}[];conflicts:SourceConflict[];warnings:string[];}
export interface Keyword { term: string; min: number; max: number; }
export interface Block { id: string; kind: 'text' | 'photos' | 'heading' | 'quote' | 'divider'; text?: string; assetIds?: string[]; space?: string; }
export interface TextFormat {fontFamily:string;fontSize:number;fontWeight:number;color:string;backgroundColor:string;align:'left'|'center'|'right'|'justify';}
export interface FormatProfile {body:TextFormat;heading:TextFormat;quote:TextFormat;quoteVariant:string;dividerVariant:string;spaceOrder:string[];dividerAfterOutro:boolean;}
export interface Fact { id: string; space: string; item: string; sourceAssetId?: string; page?: number; sourceLabel: string; confirmed: boolean; uncertain: boolean; }
export interface Asset {
  id: string; projectId: string; role: Role; filename: string; mime: string; bytes: number; hash: string;
  width?: number; height?: number; previewBytes?: number; status: string; warning?: string;
  space: string; group: string; order: number; excluded: boolean; pages?: {page: number; text: string; imageUrl?: string}[];
  analysis?: { space?: string; description?: string; facts?: Fact[] }; previewUrl: string; originalUrl: string;
}
export interface Comparison { summary: string; similarities: string[]; differences: string[]; unknowns: string[]; reviewed: boolean; }
export interface Project {
  id: string; revision: number; name: string; phase: Phase; original: Site; target: Site;
  manualWork: string; cafeUrl: string; sourceText: string; concept: string; keywords: Keyword[];
  title: string; blocks: Block[]; tags: string[]; facts: Fact[]; comparison: Comparison | null;
  publishMode: 'review' | 'automatic'; scheduleAt: string; updatedAt: string; createdAt: string;
  visibility?: 'public' | 'private';
  draftStatus: string; generationWarnings: string[]; lastJobId?: string;
  sourceReview?:SourceReview|null;
  draftSourceSignature?:string;
  formatProfile?:FormatProfile;
}
export interface Style { name: string; referenceUrls: string[]; rules: string; status: string; analyzedAt?: string; formatProfile?:FormatProfile; formatCheckedAt?:string; }
export interface Job { id: string; projectId: string; kind: string; status: string; message: string; progress: number; result?: unknown; createdAt: string; updatedAt: string; }
export interface Settings { blogId: string; brand: string; phone: string; model: string; analysisModel: string; photoEdge: number; }
export interface Bootstrap { projects: Project[]; assets: Asset[]; style: Style; settings: Settings; auth: { connected: boolean; email?: string; planEnabled?: boolean; lastError?: string; models: {id: string; name: string}[] }; browser: {available: boolean; connected: boolean; blogId?: string; verified: boolean;canWrite?:boolean;reason?:string;open?:boolean;saved?:boolean;lastVerifiedAt?:string}; jobs: Job[]; csrf: string; platform: string; }
