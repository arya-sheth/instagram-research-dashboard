export type MediaType = 'reel' | 'post';

export type BreakdownItem = {
  label: string;
  count: number;
  sharePercent: number;
};

export type LivePostSample = {
  id: string;
  url: string;
  postedAt?: string;
  mediaType: MediaType;
  captionPreview: string;
  hookType: string;
  captionType: string;
  contentType: string;
  thumbnailLabel: string;
  durationSec: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  screenshotPath: string;
};

export type LiveCompetitorResearch = {
  id: string;
  brandName: string;
  handle: string;
  profileUrl: string;
  category: string;
  businessModel: string;
  targetAudience: string;
  bio: string;
  about: string;
  followerCount: number | null;
  followingCount: number | null;
  postCount: number | null;
  verified: boolean;
  confidence: number;
  screenshotPath: string;
  contentPillars: string[];
  hookPatterns: string[];
  captionStyles: string[];
  thumbnailStyles: string[];
  postingCadence: {
    averageIntervalHours: number;
    shortestIntervalHours: number;
    longestIntervalHours: number;
    preferredWindows: string[];
  };
  metrics: {
    totalSamplePosts: number;
    totalSampleReels: number;
    reelSharePercent: number;
    averageViews: number | null;
    averageReelViews: number | null;
    averageComments: number | null;
    averageDurationSec: number | null;
    engagementRatePerPostPercent: number;
  };
  mix: {
    mediaTypes: BreakdownItem[];
    contentTypes: BreakdownItem[];
    hookTypes: BreakdownItem[];
    captionTypes: BreakdownItem[];
  };
  topPosts: LivePostSample[];
  signals: string[];
  candidates?: Array<{
    handle: string;
    fullName: string | null;
    bio: string | null;
    followers: number | null;
    verified: boolean;
    score: number;
  }>;
};

export type LiveResearchResponse = {
  generatedAt: string;
  sourceMode: string;
  sessionId: string;
  target: {
    brandName: string;
    handle: string;
    profileUrl: string;
    category: string;
    bio: string;
    followers: number | null;
    verified: boolean;
    screenshotPath: string;
  };
  collection: {
    summary: string;
    warnings: string[];
  };
  competitors: LiveCompetitorResearch[];
  marketSummary: {
    competitorCount: number;
    averageFollowers: number;
    averageViewsAcrossCompetitors: number | null;
    averageReelViewsAcrossCompetitors: number | null;
    topHookThemes: string[];
    topCaptionStyles: string[];
    bestPostingWindows: string[];
    bestPerformingPostSamples: LivePostSample[];
  };
  recommendations: {
    targetObservation: string;
    priorities: string[];
    buildNext: string[];
  };
  discovery?: {
    needsConfirmation: boolean;
    competitors: any[];
  };
};

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    let message = `API request failed: ${response.status}`;
    try {
      const payload = await response.json();
      message = payload?.message ?? payload?.error ?? message;
    } catch {
      // Keep default message.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const api = {
  runLiveInstagramResearch: (payload: {
    companyName: string;
    instagramHandle: string;
    industry?: string;
    notes?: string;
    competitorLimit?: number;
    recentPostLimit?: number;
    forceRefresh?: number;
    confirmedCompetitors?: Array<{ companyName: string; handle: string }>;
  }) =>
    fetchJson<LiveResearchResponse>('/analysis/instagram-research/live', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
