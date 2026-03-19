import { Injectable } from '@nestjs/common';
import { CollectionAgentService } from './collection-agent.service';
import { LiveInstagramResearchDto } from './dto/live-instagram-research.dto';

type BreakdownItem = {
  label: string;
  count: number;
  sharePercent: number;
};

@Injectable()
export class InsightAgentService {
  constructor(private readonly collectionAgentService: CollectionAgentService) {}

  async run(input: LiveInstagramResearchDto) {
    const collection = await this.collectionAgentService.run(input);

    if (collection.discovery?.needsConfirmation) {
      return {
        generatedAt: new Date().toISOString(),
        sourceMode: 'agent-3-insights-pending',
        collectionSummary: collection.summary,
        targetDetail: this.analyzeAccount(collection.target),
        competitors: collection.competitors.map((account) => ({
          ...this.analyzeAccount(account),
          candidates: account.candidates,
        })),
        marketSummary: {
          competitorCount: collection.competitors.length,
          averageFollowers: 0,
          averageViewsAcrossCompetitors: null,
          averageReelViewsAcrossCompetitors: null,
          topHookThemes: [],
          topCaptionStyles: [],
          bestPostingWindows: [],
          bestPerformingPostSamples: [],
        },
        recommendations: {
          targetObservation: 'Discovery Agent found multiple Instagram handles that look correct. Please confirm the right IDs below to proceed with deep data collection.',
          priorities: ['Confirm official Instagram handles for competitors labeled "Unsure".'],
          buildNext: [],
        },
        discovery: collection.discovery,
      };
    }

    const targetDetail = this.analyzeAccount(collection.target);
    const competitors = collection.competitors.map((account) => this.analyzeAccount(account));
    const rankedCompetitors = [...competitors].sort(
      (a, b) => (b.competitorScore - a.competitorScore) || ((b.metrics.averageViews ?? 0) - (a.metrics.averageViews ?? 0)),
    );
    const bestPerforming = rankedCompetitors
      .flatMap((competitor) => competitor.topPosts)
      .sort((a, b) => (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0))
      .slice(0, 10);

    return {
      generatedAt: new Date().toISOString(),
      sourceMode: 'agent-3-insights',
      collectionSummary: collection.summary,
      targetDetail,
      competitors: rankedCompetitors,
      marketSummary: {
        competitorCount: rankedCompetitors.length,
        averageFollowers: this.round(this.average(rankedCompetitors.map((item) => item.followerCount ?? 0))),
        averageViewsAcrossCompetitors: this.roundOrNull(this.averageNullable(rankedCompetitors.map((item) => item.metrics.averageViews))),
        averageReelViewsAcrossCompetitors: this.roundOrNull(this.averageNullable(rankedCompetitors.map((item) => item.metrics.averageReelViews))),
        topHookThemes: this.topLabels(rankedCompetitors.flatMap((item) => item.mix.hookTypes.map((entry) => entry.label)), 5),
        topCaptionStyles: this.topLabels(rankedCompetitors.flatMap((item) => item.mix.captionTypes.map((entry) => entry.label)), 5),
        bestPostingWindows: this.topLabels(rankedCompetitors.flatMap((item) => item.postingCadence.preferredWindows), 5),
        bestPerformingPostSamples: bestPerforming,
      },
      recommendations: {
        targetObservation: `Insights are based on ${collection.summary.totalMediaItems} collected post/reel items across ${collection.summary.totalAccountsCollected} Instagram accounts.`,
        priorities: [
          'Start with the highest-frequency hook patterns among the top-ranked competitors.',
          'Use the repeated posting windows and interval patterns as the first scheduling benchmark.',
          'Borrow thumbnail patterns from the top-performing reels before changing copy structure.',
        ],
        buildNext: [
          'Add longitudinal saved runs so the dashboard can compare hook and posting changes over time.',
          'Add CSV export for the normalized media inventory per competitor.',
          'Wire Instagram login fallback only for accounts where provider collection is incomplete.',
        ],
      },
      discovery: collection.discovery,
    };
  }

  private analyzeAccount(account: any) {
    const mappedPosts = account.mediaItems.map((item: any) => ({
      id: item.id,
      url: item.url ?? '',
      postedAt: item.timestamp,
      mediaType: item.mediaType === 'carousel' ? 'post' : item.mediaType,
      captionPreview: (item.caption ?? '').slice(0, 220),
      hookType: this.classifyHook(item.caption ?? ''),
      captionType: this.classifyCaptionType(item.caption ?? ''),
      contentType: this.classifyContentType(item.caption ?? '', account.businessCategory ?? '', account.bio ?? ''),
      thumbnailLabel: this.buildThumbnailLabel(item.caption ?? '', item.displayAlt ?? ''),
      durationSec: item.durationSec ?? null,
      views: item.views ?? item.likes ?? null,
      likes: item.likes ?? null,
      comments: item.comments ?? null,
      screenshotPath: item.thumbnailUrl ?? '',
    }));

    const reelsOnly = mappedPosts.filter((post: any) => post.mediaType === 'reel');
    const viewSignals = mappedPosts
      .map((post: any) => post.views ?? post.likes)
      .filter((value: number | null | undefined): value is number => value !== null && value !== undefined);
    const reelViewSignals = reelsOnly
      .map((post: any) => post.views ?? post.likes)
      .filter((value: number | null | undefined): value is number => value !== null && value !== undefined);
    const commentSignals = mappedPosts
      .map((post: any) => post.comments)
      .filter((value: number | null | undefined): value is number => value !== null && value !== undefined);
    const durationSignals = reelsOnly
      .map((post: any) => post.durationSec)
      .filter((value: number | null | undefined): value is number => value !== null && value !== undefined);
    const intervals = this.getIntervals(mappedPosts);
    const contentPillars = this.topLabels(mappedPosts.map((post: any) => post.contentType), 4);
    const confidence = this.scoreConfidence(account, mappedPosts.length);
    const averageViews = this.averageNullable(viewSignals);
    const averageReelViews = this.averageNullable(reelViewSignals);
    const averageComments = this.averageNullable(commentSignals);
    const averageDurationSec = this.averageNullable(durationSignals);
    const competitorScore = this.round(
      confidence * 10 +
      this.average([
        this.round((averageReelViews ?? 0) / 1000),
        this.round(averageComments ?? 0),
        mappedPosts.length,
      ]),
    );

    return {
      id: account.handle,
      brandName: account.brandName ?? account.handle,
      handle: account.handle,
      profileUrl: account.profileUrl,
      category: account.businessCategory ?? 'Unknown category',
      businessModel: account.businessCategory ?? 'Unknown',
      targetAudience: account.bio ?? '',
      bio: account.bio ?? '',
      about: this.buildAbout(account),
      followerCount: account.followerCount ?? null,
      followingCount: account.followingCount ?? null,
      postCount: account.postCount ?? null,
      verified: account.verified ?? false,
      confidence,
      competitorScore,
      screenshotPath: account.profileImage ?? '',
      contentPillars,
      hookPatterns: this.topLabels(mappedPosts.map((post: any) => post.hookType), 4),
      captionStyles: this.topLabels(mappedPosts.map((post: any) => post.captionType), 4),
      thumbnailStyles: this.topLabels(mappedPosts.map((post: any) => post.thumbnailLabel), 4),
      postingCadence: {
        averageIntervalHours: this.round(intervals.average),
        shortestIntervalHours: this.round(intervals.shortest),
        longestIntervalHours: this.round(intervals.longest),
        preferredWindows: this.topLabels(mappedPosts.map((post: any) => this.formatWindow(post.postedAt)), 3),
      },
      metrics: {
        totalSamplePosts: mappedPosts.length,
        totalSampleReels: reelsOnly.length,
        reelSharePercent: this.round(mappedPosts.length ? (reelsOnly.length / mappedPosts.length) * 100 : 0),
        averageViews: averageViews === null ? null : this.round(averageViews),
        averageReelViews: averageReelViews === null ? null : this.round(averageReelViews),
        averageComments: averageComments === null ? null : this.round(averageComments),
        averageDurationSec: averageDurationSec === null ? null : this.round(averageDurationSec),
        engagementRatePerPostPercent: this.round(this.average(mappedPosts.map((post: any) => (((post.likes ?? 0) + (post.comments ?? 0)) / Math.max(account.followerCount ?? 1, 1)) * 100))),
      },
      mix: {
        mediaTypes: this.toBreakdown(mappedPosts.map((post: any) => post.mediaType)),
        contentTypes: this.toBreakdown(mappedPosts.map((post: any) => post.contentType)),
        hookTypes: this.toBreakdown(mappedPosts.map((post: any) => post.hookType)),
        captionTypes: this.toBreakdown(mappedPosts.map((post: any) => post.captionType)),
      },
      topPosts: [...mappedPosts].sort((a: any, b: any) => (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0)).slice(0, 5),
      signals: account.officialSignals?.length
        ? account.officialSignals
        : [
          account.verified ? 'verified' : 'not-verified',
          account.businessCategory ? 'business-category-visible' : 'business-category-hidden',
          account.collectionSource,
          `${mappedPosts.length} collected items`,
        ],
    };
  }

  private buildAbout(account: any) {
    const category = account.businessCategory?.trim();
    const bio = account.bio?.trim();
    if (category && bio) return category === bio ? category : `${category} | ${bio}`;
    return category || bio || 'No public bio captured.';
  }

  private scoreConfidence(account: any, itemCount: number) {
    let confidence = 0.4;
    if (account.bio) confidence += 0.15;
    if (account.businessCategory) confidence += 0.1;
    if (account.followerCount) confidence += 0.1;
    if (account.verified) confidence += 0.1;
    if (itemCount >= 10) confidence += 0.15;
    if ((account.collectionWarnings ?? []).length === 0) confidence += 0.1;
    return Math.min(1, this.round(confidence));
  }

  private classifyHook(caption: string) {
    const firstLine = caption.split(/\n|\./)[0] ?? caption;
    if (/\?/.test(firstLine)) return 'question opener';
    if (/myth|mistake|wrong|truth|misconception/i.test(firstLine)) return 'myth-busting opener';
    if (/\b[0-9]+\b|%|x\b/i.test(firstLine)) return 'stat-led opener';
    if (/when|once|we|i|our story|behind/i.test(firstLine)) return 'story opener';
    return 'problem-solution opener';
  }

  private classifyCaptionType(caption: string) {
    if (/meme|funny|lol|relatable/i.test(caption)) return 'Entertainment';
    if (/story|journey|learned|experience|grateful|inspire/i.test(caption)) return 'Inspiration';
    if (/team|office|culture|behind the scenes|bts|meet the/i.test(caption)) return 'Behind-the-Scenes';
    if (/offer|discount|demo|book|link in bio|sign up|get started|comment|dm/i.test(caption)) return 'Promotion';
    return 'Education';
  }

  private classifyContentType(caption: string, category: string, bio: string) {
    const combined = `${caption} ${category} ${bio}`;
    if (/launching|drop|new collection|shop now|edit|festive|summer|winter/i.test(combined)) return 'Launch / Promotion';
    if (/tutorial|how to|tips|guide|routine|step|hack/i.test(combined)) return 'Education / Tutorial';
    if (/story|journey|behind the scenes|bts|founder|team|culture/i.test(combined)) return 'Brand Story';
    if (/offer|pricing|plan|discount|book|buy now|shop now/i.test(combined)) return 'Offer / Conversion';
    return 'General Content';
  }

  private buildThumbnailLabel(caption: string, alt?: string) {
    const seed = caption || alt || 'Instagram post';
    return seed.split(/[.!?\n]/)[0].trim().split(/\s+/).slice(0, 6).join(' ');
  }

  private getIntervals(posts: Array<{ postedAt?: string }>) {
    const times = posts
      .map((post) => (post.postedAt ? new Date(post.postedAt).getTime() : null))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    if (times.length < 2) return { average: 0, shortest: 0, longest: 0 };
    const intervals: number[] = [];
    for (let index = 1; index < times.length; index += 1) {
      intervals.push((times[index] - times[index - 1]) / (1000 * 60 * 60));
    }
    return { average: this.average(intervals), shortest: Math.min(...intervals), longest: Math.max(...intervals) };
  }

  private formatWindow(postedAt?: string) {
    if (!postedAt) return 'time unavailable';
    return `${new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(postedAt))} IST`;
  }

  private toBreakdown(items: string[]): BreakdownItem[] {
    const counts = new Map<string, number>();
    items.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1));
    const total = items.length || 1;
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count, sharePercent: this.round((count / total) * 100) }));
  }

  private topLabels(items: string[], limit = 3) {
    return this.toBreakdown(items).slice(0, limit).map((item) => item.label);
  }

  private average(values: number[]) {
    const valid = values.filter((value) => Number.isFinite(value));
    if (!valid.length) return 0;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  private averageNullable(values: Array<number | null | undefined>) {
    const valid = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  private round(value: number) {
    return Number(value.toFixed(2));
  }

  private roundOrNull(value: number | null) {
    return value === null ? null : this.round(value);
  }
}
