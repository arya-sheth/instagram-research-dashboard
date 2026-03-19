import { Injectable } from '@nestjs/common';
import { DiscoveryAgentService } from './discovery-agent.service';
import { LiveInstagramResearchDto } from './dto/live-instagram-research.dto';
import { InstagramPlaywrightService } from './instagram-playwright.service';

type CollectionMediaItem = {
  id: string;
  shortcode: string | null;
  mediaType: 'reel' | 'post' | 'carousel';
  caption: string;
  thumbnailUrl: string | null;
  displayAlt: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  durationSec: number | null;
  timestamp: string | null;
  hashtags: string[];
  mentions: string[];
  taggedUsers: string[];
  url: string | null;
};

type AccountCollection = {
  handle: string;
  profileUrl: string;
  brandName: string | null;
  bio: string | null;
  businessCategory: string | null;
  followerCount: number | null;
  followingCount: number | null;
  postCount: number | null;
  verified: boolean;
  profileImage: string | null;
  collectionSource: string;
  collectionWarnings: string[];
  officialSignals: string[];
  whyItMatched: string[];
  mediaItems: CollectionMediaItem[];
  candidates?: Array<{
    handle: string;
    fullName: string | null;
    bio: string | null;
    followers: number | null;
    verified: boolean;
    score: number;
  }>;
};

type CollectionResponse = {
  generatedAt: string;
  sourceMode: string;
  target: AccountCollection;
  competitors: AccountCollection[];
  summary: {
    competitorCount: number;
    totalAccountsCollected: number;
    totalMediaItems: number;
    collectionCapPerAccount: number;
    warnings: string[];
  };
  discovery?: {
    needsConfirmation: boolean;
    competitors: any[];
  };
};

@Injectable()
export class CollectionAgentService {
  constructor(
    private readonly discoveryAgentService: DiscoveryAgentService,
    private readonly instagramPlaywrightService: InstagramPlaywrightService,
  ) {}

  async run(input: LiveInstagramResearchDto): Promise<CollectionResponse> {
    const discovery = await this.discoveryAgentService.run(input);
    const requestedCompetitorLimit = Math.min(4, Math.max(2, input.competitorLimit ?? 4));
    const requestedCap = Math.min(20, Math.max(5, input.recentPostLimit ?? 8));
    const effectiveCompetitorCount = Math.max(1, discovery.competitors.length || requestedCompetitorLimit);
    const safePerAccountCap = Math.max(6, Math.floor(40 / (effectiveCompetitorCount + 1)));
    const cap = Math.min(requestedCap, 8, safePerAccountCap);

    if (discovery.discovery.needsConfirmation) {
      return {
        generatedAt: new Date().toISOString(),
        sourceMode: 'agent-2-collection-pending',
        target: {
          handle: discovery.target.resolvedInstagramHandle,
          profileUrl: discovery.target.profileUrl,
          brandName: discovery.target.inputCompanyName,
          bio: discovery.target.bio,
          businessCategory: discovery.target.category,
          followerCount: discovery.target.followers,
          followingCount: null,
          postCount: null,
          verified: discovery.target.verified,
          profileImage: null,
          collectionSource: 'discovery-pending',
          collectionWarnings: [],
          officialSignals: [],
          whyItMatched: [],
          mediaItems: [],
        },
        competitors: discovery.competitors.map(c => ({
          handle: c.officialInstagramHandle ?? '',
          profileUrl: c.instagramProfileUrl ?? '',
          brandName: c.companyName,
          bio: c.instagramProfile?.bio ?? null,
          businessCategory: c.instagramProfile?.category ?? null,
          followerCount: c.instagramProfile?.followers ?? null,
          followingCount: null,
          postCount: c.instagramProfile?.posts ?? null,
          verified: c.instagramProfile?.verified ?? false,
          profileImage: null,
          collectionSource: 'discovery-pending',
          collectionWarnings: [],
          officialSignals: c.officialSignals,
          whyItMatched: c.whyItMatched,
          mediaItems: [],
          candidates: c.candidates,
        })),
        summary: {
          competitorCount: discovery.competitors.length,
          totalAccountsCollected: 0,
          totalMediaItems: 0,
          collectionCapPerAccount: cap,
          warnings: ['Discovery Agent found ambiguous Instagram handles that require user confirmation before collection.'],
        },
        discovery: {
          needsConfirmation: true,
          competitors: discovery.competitors,
        },
      };
    }

    const target = await this.collectAccount(discovery.target.resolvedInstagramHandle, cap);
    const competitorHandles = discovery.competitors
      .slice(0, requestedCompetitorLimit)
      .map((competitor) => competitor.officialInstagramHandle)
      .filter((handle): handle is string => Boolean(handle));
    const competitorMap = new Map(
      discovery.competitors
        .filter((competitor) => competitor.officialInstagramHandle)
        .map((competitor) => [competitor.officialInstagramHandle as string, competitor]),
    );
    const competitors: AccountCollection[] = [];
    for (const handle of competitorHandles) {
      const competitor = await this.collectAccount(handle, cap, competitorMap.get(handle));
      competitors.push(competitor);
    }

    return {
      generatedAt: new Date().toISOString(),
      sourceMode: 'agent-2-collection',
      target,
      competitors,
      summary: {
        competitorCount: competitors.length,
        totalAccountsCollected: competitors.length + 1,
        totalMediaItems: [target, ...competitors].reduce((sum, account) => sum + account.mediaItems.length, 0),
        collectionCapPerAccount: cap,
        warnings: [
          'Free local collector is running through Playwright instead of a paid provider.',
          this.instagramPlaywrightService.hasSavedSession()
            ? 'Saved Instagram session detected. Deep post and reel collection is enabled.'
            : 'No saved Instagram session detected. Profile metadata works, but deep post and reel collection will stay limited until you run npm.cmd run instagram:login once.',
          requestedCap > cap || requestedCompetitorLimit >= 6
            ? `Requested workload was auto-clamped for stability. Using ${cap} items per account across up to ${requestedCompetitorLimit} competitors in this run.`
            : 'Large runs are slower now because each post or reel is collected directly from Instagram pages on your machine.',
        ],
      },
    };
  }

  private async collectAccount(handle: string, cap: number, competitorMeta?: any): Promise<AccountCollection> {
    const result = await this.instagramPlaywrightService.collectProfileMedia(handle, cap);
    const meta = result.profileMeta;

    return {
      handle: meta.handle,
      profileUrl: meta.profileUrl,
      brandName: competitorMeta?.companyName ?? meta.fullName,
      bio: meta.bio,
      businessCategory: meta.category,
      followerCount: meta.followers,
      followingCount: meta.following,
      postCount: meta.posts,
      verified: meta.verified,
      profileImage: meta.profileImage,
      collectionSource: result.usedSession ? 'playwright-session-collector' : 'playwright-public-metadata',
      collectionWarnings: result.warnings,
      officialSignals: competitorMeta?.officialSignals ?? [],
      whyItMatched: competitorMeta?.whyItMatched ?? [],
      mediaItems: result.mediaItems.map((item) => ({
        id: item.id,
        shortcode: item.shortcode,
        mediaType: item.mediaType,
        caption: item.caption,
        thumbnailUrl: item.thumbnailUrl,
        displayAlt: item.displayAlt,
        likes: item.likes,
        comments: item.comments,
        views: item.views,
        durationSec: item.durationSec,
        timestamp: item.timestamp,
        hashtags: item.hashtags,
        mentions: item.mentions,
        taggedUsers: item.taggedUsers,
        url: item.url,
      })),
    };
  }
}
