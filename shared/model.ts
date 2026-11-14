export const SPACES = ['현관', '거실', '주방', '보조주방', '주방베란다', '안방', '안방욕실', '작은방1', '작은방2', '공용욕실', '작은방3', '파우더룸', '거실베란다', '2층', '기타'] as const;
export type PostType = 'recommendation' | 'case' | 'completion';
export interface CompletionEdit {text?:string;photoId?:string;visible?:boolean;x?:number;y?:number;scale?:number;zoom?:number;cropX?:number;cropY?:number;fontSize?:number;fontFamily?:string;fontWeight?:number;color?:string;align?:'left'|'center'|'right';width?:number;height?:number;}
export interface CompletionOverlay extends CompletionEdit {id:string;text:string;x:number;y:number;width:number;height:number;backgroundColor?:string;}
export interface CompletionElement extends CompletionEdit {id:string;name:string;kind:'text'|'photo'|'image';x:number;y:number;width:number;height:number;textX?:number;textWidth?:number;textHeight?:number;lineHeight?:number;letterSpacing?:number;binding?:string;imageUrl?:string;}
export interface CompletionLayout {id:string;name:string;width:number;height:number;position:CompletionTemplate['position'];elements:CompletionElement[];previewUrl:string;}
export interface CompletionTemplate {id:string;name:string;enabled?:boolean;position:'cover'|'scope'|'beforeAfter'|'space'|'closing';space:string;templateId:string;text:string;photoIds:string[];layoutId?:string;edits?:Record<string,CompletionEdit>;overlays?:CompletionOverlay[];removedRows?:string[];markers?:{number:number;x:number;y:number}[];}
export type Phase = 'site' | 'compare' | 'assets' | 'write' | 'publish';
export type Role = 'photo' | 'template-photo' | 'construction' | 'material-selection' | 'floorplan-original' | 'floorplan-target' | 'template' | 'video';
export interface ComplexDetails {name:string;region:string;url:string;text:string;types:string[];images:{label:string;url:string}[];supplyArea:string;exclusiveArea:string;selectedType:string;notice:string;}
export interface Site { name: string; region: string; type: string; supplyArea: string; exclusiveArea: string; sourceUrl: string; details?:ComplexDetails;floorplanAssetId?:string;}
export interface SourceConflict {id:string;space:string;topic:string;constructionFactIds:string[];cafeFactIndexes:number[];reason:string;decision:'pending'|'construction'|'cafe'|'both'|'exclude'|'custom';customText:string;}
export interface SourceReview {signature:string;checkedAt:string;cafeFacts:{space:string;item:string;evidence:string;uncertain:boolean}[];siteInfo?:{field:'location'|'area'|'concept';value:string;evidence:string;uncertain:boolean}[];conflicts:SourceConflict[];warnings:string[];}
export interface Keyword { term: string; min: number; max: number; }
export interface Block { layout?:'collage'|'slide';id: string; kind: 'text' | 'photos' | 'heading' | 'quote' | 'divider' | 'map' | 'video'; text?: string; assetIds?: string[]; space?: string; variant?:string; formatRole?:'lead'|'intro'|'closing'|'outro'|'point'|'pointBody'|'contact'; }
export interface TextFormat {fontFamily:string;fontSize:number;fontWeight:number;color:string;backgroundColor:string;align:'left'|'center'|'right'|'justify';}
export interface FormatProfile {postType?:PostType;photoLayouts?:Record<string,('default'|'collage'|'slide')[]>;body:TextFormat;heading:TextFormat;quote:TextFormat;quoteVariant:string;dividerVariant:string;spaceOrder:string[];dividerAfterOutro:boolean;textStyles?:Record<string,TextFormat[]>;headingStyles?:Record<string,TextFormat>;headingTextStyles?:Record<string,TextFormat[]>;headingVariants?:Record<string,string>;introLead?:boolean;introQuote?:boolean;headingKind?:"text"|"quote";headingQuoteVariant?:string;introDividerVariant?:string;sectionDividerVariant?:string;outroDividerVariant?:string;closingDividerVariant?:string;}
export interface Fact { id: string; space: string; item: string; sourceAssetId?: string; page?: number; sourceLabel: string; confirmed: boolean; uncertain: boolean; }
export interface Asset {
  id: string; projectId: string; role: Role; filename: string; mime: string; bytes: number; hash: string;
  width?: number; height?: number; previewBytes?: number; status: string; warning?: string;
  space: string; group: string; order: number; excluded: boolean;spaceManual?:boolean;layoutManual?:boolean; pages?: {page: number; text: string; sheet?:string;imageUrl?: string}[];
  templateKind?:'cover'|'scope'|'completion';templateOutput?:'cover'|'scope'|'floorplan'|'completion';templateSignature?:string;templateSlotId?:string;templateIncomplete?:string[];layouts?:CompletionLayout[];
  analysis?: { space?: string; description?: string; facts?: Fact[] }; previewUrl: string; originalUrl: string;
}
export interface Comparison { summary: string; similarities: string[]; differences: string[]; unknowns: string[]; reviewed: boolean; }
export interface Project {
  workPlan?:{signature:string;items:{id:string;space:string;item:string;sourceIds:string[];photoIds:string[]}[];warnings:string[];checks:{workId:string;blockId:string;quote:string}[];checkedAt:string;};
  completionVideoId?:string;cafeTargetUrl?:string;cafeBoardUrl?:string;completionTemplates?:CompletionTemplate[];
  id: string; revision: number; name: string; phase: Phase; original: Site; target: Site; postType?:PostType; category?:string;
  manualWork: string; cafeUrl: string; sourceText: string; concept: string; keywords: Keyword[];
  title: string; blocks: Block[]; tags: string[]; facts: Fact[]; comparison: Comparison | null;
  publishMode: 'review' | 'automatic'; scheduleAt: string; updatedAt: string; createdAt: string;
  coverAssetId?:string;
  coverTemplateId?:string;scopeTemplateId?:string;templatePhotoId?:string;
  caseCoverCrop?: { zoom: number; x: number; y: number };
  templateEdits?:Partial<Record<'coverTitle'|'coverConcept'|'location'|'area'|'concept'|'wall'|'floor'|'other'|'scopeProject'|'scopeCopyright',string>>;
  cafeScope?:{readVersion?:2;signature:string;imageUrls:string[];checkedAt:string;location:string;area:string;concept:string;scopeProject?:string;scopeCopyright?:string;rows:{label:string;value:string;field:'wall'|'floor'|'other'}[];warnings:string[]}|null;
  templateWarning?:string;
  questionQuote?: 'none' | 'middle' | 'end';
  questionQuoteCount?: number;
  visibility?: 'public' | 'private';
  draftStatus: string; generationWarnings: string[]; lastJobId?: string;
  sourceReview?:SourceReview|null;
  draftSourceSignature?:string;
  formatProfile?:FormatProfile;
}
export interface Style { name: string; referenceUrls: string[]; rules: string; status: string; analyzedAt?: string; formatProfile?:FormatProfile; formatCheckedAt?:string; }
export interface Job { cancellable?:boolean; id: string; projectId: string; kind: string; status: string; message: string; progress: number; result?: unknown; createdAt: string; updatedAt: string; }
export interface Settings { blogId: string; brand: string; phone: string; model: string; analysisModel: string; photoEdge: number; }
export interface Bootstrap { projects: Project[]; assets: Asset[]; style: Style; caseStyle: Style; completionStyle:Style; settings: Settings; auth: { connected: boolean; email?: string; planEnabled?: boolean; lastError?: string; models: {id: string; name: string}[] }; browser: {available: boolean; connected: boolean; blogId?: string; verified: boolean;canWrite?:boolean;reason?:string;open?:boolean;saved?:boolean;lastVerifiedAt?:string}; jobs: Job[]; csrf: string; platform: string; }
