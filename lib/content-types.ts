export type RecordStatus = 'active' | 'inactive';
export type VideoStatus = 'active' | 'deleted' | 'error';
export type CreatorType = 'UGC' | 'AI';

export interface Producer {
  id: number;
  name: string;
  status: RecordStatus;
  createdAt: string;
}

export interface Platform {
  id: number;
  name: string;
  domains: string[];
  status: RecordStatus;
}

export interface Creator {
  id: number;
  name: string;
  type: CreatorType;
  producerId: number;
  producerName: string;
  status: RecordStatus;
  createdAt: string;
}

export interface Video {
  id: number;
  creatorId: number;
  creatorName: string;
  creatorType: CreatorType;
  producerId: number;
  producerName: string;
  platformId: number;
  platformName: string;
  url: string;
  normalizedUrl: string;
  publishedAt: string;
  addedAt: string;
  reach: number;
  status: VideoStatus;
  creatorTypeSnapshot: CreatorType;
  producerIdSnapshot: number;
}

export interface DashboardData {
  producers: Producer[];
  creators: Creator[];
  platforms: Platform[];
  videos: Video[];
}

export interface SummaryRow {
  id: number;
  name: string;
  type?: CreatorType;
  producerName?: string;
  creatorCount?: number;
  videoCount: number;
  reach: number;
  average: number;
}

export interface Metrics {
  creatorCount: number;
  videoCount: number;
  reach: number;
  average: number;
}
