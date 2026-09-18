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
}

export interface PortfolioPlan {
  portfolioCode: string;
  sourceCode: string;
  exposure: "direct" | "look-through";
}

export interface MonitorConfig {
  funds: Fund[];
  outputDir?: string;
  historyLimit?: number;
  fetch?: { timeoutMs?: number; concurrency?: number; feeConcurrency?: number; holdingsConcurrency?: number };
  portfolioMappings?: Record<string, PortfolioPlan>;
  notifications?: Record<string, unknown>;
}
