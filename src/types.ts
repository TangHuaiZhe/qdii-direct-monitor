export type FundStatus = "open" | "limited" | "suspended" | "unavailable" | "unknown";
export type ReliabilityGrade = "A" | "B" | "C" | "D";
export type FundStrategy = "active" | "passive" | "unknown";
export type DirectAccess = "web" | "app" | "counter" | "all";
export type AgencyAccess = "eastmoney" | "alipay" | "bank" | "broker" | "all";

export interface DirectChannel {
  kind: "direct";
  access: DirectAccess;
  name?: string;
}

export interface AgencyChannel {
  kind: "agency";
  access: AgencyAccess;
  name?: string;
}

export type Channel = DirectChannel | AgencyChannel;

export interface Reliability {
  grade: ReliabilityGrade;
  reason: string;
}

export interface EvidenceSource {
  url: string;
  pageUrl?: string;
  kind: string;
  adapter: string;
}

export interface Fund {
  code: string;
  name: string;
  manager: string;
  adapter: string;
  currency?: string;
  index?: string;
  strategy?: FundStrategy;
  shareClass?: string;
  enabled?: boolean;
  agency?: { eastmoney?: boolean };
  officialSources?: OfficialSource[];
  manualChannels?: ManualChannel[];
}

export interface OfficialSource {
  url?: string;
  kind?: string;
  followLinks?: boolean;
  effectiveDate?: string;
  channel?: DirectChannel;
  channels?: DirectChannel[];
}

export type LimitEventAction = "set-limit" | "suspend-all" | "resume" | "confirm-restriction";

export interface NoticeCandidate {
  manager: string;
  title: string;
  url: string;
  pageUrl?: string;
  publishedAt: string | null;
  fundCodes: string[];
  currencyScope: "CNY" | "USD" | "all" | "unknown";
  shareClasses: string[];
  eventHint: LimitEventAction | "unknown";
  cacheKey?: string;
}

export interface LimitEvent {
  fundCode: string;
  shareClass: string | null;
  currency: string;
  channel: DirectChannel;
  action: LimitEventAction;
  amount: number | null;
  effectiveAt: string;
  publishedAt: string | null;
  sourceUrl: string;
  sourcePageUrl?: string | null;
  sourceAdapter: string;
}

export interface NoticeHealth {
  candidatesDiscovered: number;
  newNotices: number;
  parsedNotices: number;
  rejectedNotices: number;
  conflicts: number;
  cacheFallbacks: number;
  staleTimelines: number;
  timelines: NoticeTimelineHealth[];
}

export interface NoticeTimelineHealth {
  adapter: string;
  fundCode: string;
  latestRelevantNotice: string | null;
  latestParsedEvent: string | null;
  checkedAt: string | null;
  status: "current" | "stale" | "empty" | "unavailable";
}

export interface ManualChannel {
  channel: Channel;
  status: FundStatus;
  limitAmount?: number | null;
  currency?: string;
  sourceUrl: string;
  verifiedAt: string;
  expiresAt: string;
  notes?: string[];
}

export interface Observation {
  key: string;
  fundCode: string;
  fundName: string;
  manager: string;
  index: string;
  strategy: FundStrategy;
  currency: string;
  shareClass: string;
  channel: Channel;
  status: FundStatus;
  limitAmount: number | null;
  accountBasis: string;
  observedAt: string;
  effectiveDate: string | null;
  salesUrl: string | null;
  source: EvidenceSource | null;
  reliability: Reliability;
  notes: string[];
}

export type ObservationInput = Omit<Observation, "key" | "accountBasis" | "effectiveDate" | "salesUrl" | "source" | "notes"> &
  Partial<Pick<Observation, "accountBasis" | "effectiveDate" | "salesUrl" | "source" | "notes">>;

export interface FeeObservation {
  fundCode: string;
  managementRate: number | null;
  custodyRate: number | null;
  salesServiceRate: number | null;
  annualRate: number | null;
  observedAt: string;
  source: EvidenceSource | null;
  reliability: Reliability;
}

export interface HoldingItem {
  rank: number;
  code: string;
  name: string;
  market: string;
  weight: number;
}

export interface HoldingObservation {
  fundCode: string;
  portfolioCode: string;
  sourceCode: string | null;
  exposure: "direct" | "look-through" | "unknown";
  asOf: string | null;
  items: HoldingItem[];
  observedAt: string;
  source: EvidenceSource | null;
  reliability: Reliability;
}

export interface Snapshot {
  schemaVersion: number;
  observedAt: string;
  rows: Observation[];
  byKey: Record<string, Observation>;
  fees?: FeeObservation[];
  feesByFund?: Record<string, FeeObservation>;
  holdings?: HoldingObservation[];
  holdingsByFund?: Record<string, HoldingObservation>;
  quotes?: QuoteObservation[];
  quotesByCode?: Record<string, QuoteObservation>;
  /** Recent trading-day closes per fund code: { "2026-10-30": { "513100": 2.239 } }. Used to compute calibrated (same-valuation-date) premium. */
  closeByDate?: Record<string, Record<string, number>>;
}

export interface SnapshotChange {
  type: "channel-added" | "channel-removed" | "status-changed" | "amount-changed" | "amount-increased" | "amount-decreased";
  key: string;
  before: Observation | null;
  after: Observation | null;
}

export interface FetchResourceOptions {
  allowedHosts: string[];
  timeoutMs?: number;
  maxBytes?: number;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

export interface Resource {
  bytes: Buffer;
  contentType: string;
  finalUrl: string;
}

export type FetchResource = (url: string, options: FetchResourceOptions) => Promise<Resource>;

export interface CollectorContext {
  observedAt: string;
  warnings: string[];
  timeoutMs: number;
  fetchResource: FetchResource;
  eventCacheDir?: string | null;
  noticeHealth?: NoticeHealth;
}

export interface PortfolioPlan {
  portfolioCode: string;
  sourceCode: string;
  exposure: "direct" | "look-through";
}

export interface MonitorConfig {
  funds: Fund[];
  onsiteFunds?: OnsiteFund[];
  onsite?: OnsiteSettings;
  outputDir?: string;
  historyLimit?: number;
  fetch?: { timeoutMs?: number; concurrency?: number; feeConcurrency?: number; holdingsConcurrency?: number };
  portfolioMappings?: Record<string, PortfolioPlan>;
  notifications?: Record<string, unknown>;
}

export type ExchangeId = "SSE" | "SZSE";
export type VehicleType = "ETF" | "LOF";
export type RefNavKind = "iopv" | "reference-nav" | "previous-nav" | "nav";

export interface OnsiteFund {
  code: string;
  name: string;
  manager: string;
  exchange: ExchangeId;
  vehicle: VehicleType;
  index: string;
  strategy?: FundStrategy;
  currency?: string;
  shareClass?: string;
  /** Existing OTC share class code in `funds` that links to this on-exchange listing. */
  linkFundCode?: string | null;
  officialQuoteUrl?: string;
  enabled?: boolean;
}

export interface OnsiteSettings {
  enabled?: boolean;
  highPremiumPct?: number;
  minTurnoverCny?: number;
  navMismatchPct?: number;
  maxNavLagTradingDays?: number;
  concurrency?: number;
  sources?: { exchangeOfficial?: boolean; eastmoney?: boolean };
}

/**
 * One on-exchange quote for one fund listing. This is deliberately NOT an `Observation`:
 * `rows` describe one share class x one sales entry (purchase limit), while a quote describes
 * a price/NAV pair. Keeping them separate preserves the dashboard's existing semantics.
 */
export interface QuoteObservation {
  code: string;
  name: string;
  manager: string;
  index: string;
  exchange: ExchangeId;
  vehicle: VehicleType;
  currency: string;
  price: number | null;
  priceAt: string | null;
  priceDate: string | null;
  /** Source that produced `price`: official exchange feed or the Eastmoney public fallback. */
  priceSource?: "official" | "eastmoney" | null;
  refNav: number | null;
  refNavKind: RefNavKind | null;
  refNavDate: string | null;
  nav: number | null;
  navDate: string | null;
  premiumLivePct: number | null;
  premiumLiveBasis: RefNavKind | null;
  premiumCalibratedPct: number | null;
  calibratedForDate: string | null;
  turnoverCny: number | null;
  applyStatus: string | null;
  linksOtcCode: string | null;
  reliability: Reliability;
  sources: EvidenceSource[];
  observedAt: string;
  notes: string[];
  carriedForward?: boolean;
}

export interface PremiumSummary {
  asOf: string;
  calibratedForDate: string | null;
  count: number;
  degraded: number;
  highPremiumCodes: string[];
  thresholds: {
    highPremiumPct: number;
    p25: number | null;
    p75: number | null;
    p90: number | null;
  };
}

export interface ExchangeHealth {
  officialOk: number;
  fallback: number;
  failed: number;
  degradedCodes: string[];
}
