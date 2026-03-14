import { Injectable } from '@nestjs/common';
import { RecalculateGtmDto } from './dto/recalculate-gtm.dto';
import { CompetitorsService } from '../competitors/competitors.service';
import { InstagramPost, InstagramProfile } from '../competitors/competitor.model';

@Injectable()
export class AnalysisService {
  constructor(private readonly competitorsService: CompetitorsService) {}

  getCatalog() {
    return this.competitorsService.findAll();
  }

  runInstagramResearch(input: RecalculateGtmDto) {
    const catalog = this.competitorsService.findAll();
    const target = this.findTargetProfile(catalog, input);
    const competitorLimit = input.competitorLimit ?? 4;
    const competitors = this.rankCompetitors(catalog, target, input).slice(0, competitorLimit);
    const competitorAnalyses = competitors.map((profile) => this.buildCompetitorAnalysis(profile));
    const marketSummary = this.buildMarketSummary(competitorAnalyses);
    const recommendations = this.buildRecommendations(target, competitorAnalyses, marketSummary);

    return {
      generatedAt: new Date().toISOString(),
      sourceMode: 'seeded-demo-ready-for-live-collector',
      target: target ? this.buildTargetSummary(target) : this.buildSyntheticTarget(input),
      competitors: competitorAnalyses,
      marketSummary,
      recommendations,
      collectorBlueprint: {
        officialApiConstraint:
          'Meta official APIs do not provide this level of competitor post intelligence for arbitrary accounts. Use a compliant third-party collector or approved browser automation for live data.',
        suggestedCollectors: [
          'Third-party Instagram dataset provider with reels/post metadata export',
          'Playwright-based browser collector for owned workflows and manual review',
          'Human-in-the-loop CSV import for high-confidence audits',
        ],
      },
    };
  }

  private buildTargetSummary(profile: InstagramProfile) {
    return {
      mode: 'matched-catalog',
      brandName: profile.brandName,
      handle: profile.handle,
      profileUrl: profile.profileUrl,
      category: profile.category,
      businessModel: profile.businessModel,
      targetAudience: profile.targetAudience,
      bio: profile.bio,
      contentPillars: profile.contentPillars,
      postCount: profile.postCount,
      followerCount: profile.followerCount,
    };
  }

  private buildSyntheticTarget(input: RecalculateGtmDto) {
    return {
      mode: 'synthetic-from-query',
      brandName: input.companyName,
      handle: input.instagramHandle?.replace(/^@/, '') ?? 'unknown',
      profileUrl: input.instagramHandle
        ? `https://www.instagram.com/${input.instagramHandle.replace(/^@/, '')}/`
        : '',
      category: input.industry || 'Unknown industry',
      businessModel: 'Not provided',
      targetAudience: 'Not provided',
      bio: input.notes || 'No catalog match found. Showing nearest known Instagram competitors from the local dataset.',
      contentPillars: [],
      postCount: 0,
      followerCount: 0,
    };
  }

  private buildCompetitorAnalysis(profile: InstagramProfile) {
    const posts = [...profile.posts].sort(
      (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime(),
    );
    const reels = posts.filter((post) => post.mediaType === 'reel');
    const averageViews = this.average(posts.map((post) => post.views));
    const averageReelViews = this.average(reels.map((post) => post.views));
    const averageComments = this.average(posts.map((post) => post.comments));
    const averageDuration = this.average(reels.map((post) => post.durationSec ?? 0));
    const intervals = this.getIntervalsInHours(posts);
    const topPosts = [...posts]
      .sort((a, b) => b.views - a.views)
      .slice(0, 3)
      .map((post) => ({
        id: post.id,
        postedAt: post.postedAt,
        thumbnailLabel: post.thumbnailLabel,
        mediaType: post.mediaType,
        contentType: post.contentType,
        hookType: post.hookType,
        captionType: post.captionType,
        durationSec: post.durationSec ?? null,
        views: post.views,
        comments: post.comments,
        captionPreview: post.captionPreview,
      }));

    return {
      id: profile.id,
      brandName: profile.brandName,
      handle: profile.handle,
      profileUrl: profile.profileUrl,
      category: profile.category,
      businessModel: profile.businessModel,
      targetAudience: profile.targetAudience,
      bio: profile.bio,
      about: profile.about,
      followerCount: profile.followerCount,
      followingCount: profile.followingCount,
      postCount: profile.postCount,
      verified: profile.verified,
      contentPillars: profile.contentPillars,
      hookPatterns: profile.hookPatterns,
      captionStyles: profile.captionStyles,
      thumbnailStyles: profile.thumbnailStyles,
      postingCadence: {
        averageIntervalHours: this.round(intervals.average),
        shortestIntervalHours: this.round(intervals.shortest),
        longestIntervalHours: this.round(intervals.longest),
        preferredWindows: this.getPreferredWindows(posts),
      },
      metrics: {
        totalSamplePosts: posts.length,
        totalSampleReels: reels.length,
        reelSharePercent: this.round(posts.length ? (reels.length / posts.length) * 100 : 0),
        averageViews,
        averageReelViews,
        averageComments,
        averageDurationSec: this.round(averageDuration),
        engagementRatePerPostPercent: this.round(
          posts.length
            ? this.average(
                posts.map((post) => ((post.likes + post.comments) / Math.max(profile.followerCount, 1)) * 100),
              )
            : 0,
        ),
      },
      mix: {
        mediaTypes: this.toShareBreakdown(posts.map((post) => post.mediaType)),
        contentTypes: this.toShareBreakdown(posts.map((post) => post.contentType)),
        hookTypes: this.toShareBreakdown(posts.map((post) => post.hookType)),
        captionTypes: this.toShareBreakdown(posts.map((post) => post.captionType)),
      },
      topPosts,
    };
  }

  private buildMarketSummary(competitors: Array<ReturnType<AnalysisService['buildCompetitorAnalysis']>>) {
    const allTopPosts = competitors.flatMap((item) => item.topPosts);
    const allWindows = competitors.flatMap((item) => item.postingCadence.preferredWindows);
    const allHooks = competitors.flatMap((item) => item.mix.hookTypes.map((hook) => hook.label));
    const allCaptions = competitors.flatMap((item) => item.mix.captionTypes.map((caption) => caption.label));

    return {
      competitorCount: competitors.length,
      averageFollowers: this.round(this.average(competitors.map((item) => item.followerCount))),
      averageViewsAcrossCompetitors: this.round(
        this.average(competitors.map((item) => item.metrics.averageViews)),
      ),
      averageReelViewsAcrossCompetitors: this.round(
        this.average(competitors.map((item) => item.metrics.averageReelViews)),
      ),
      topHookThemes: this.topLabels(allHooks),
      topCaptionStyles: this.topLabels(allCaptions),
      bestPostingWindows: this.topLabels(allWindows),
      bestPerformingPostSamples: [...allTopPosts]
        .sort((a, b) => b.views - a.views)
        .slice(0, 5),
    };
  }

  private buildRecommendations(
    target: InstagramProfile | undefined,
    competitors: Array<ReturnType<AnalysisService['buildCompetitorAnalysis']>>,
    marketSummary: ReturnType<AnalysisService['buildMarketSummary']>,
  ) {
    const commonPillars = this.topLabels(
      competitors.flatMap((item) => item.contentPillars),
      4,
    );
    const strongestHooks = marketSummary.topHookThemes.slice(0, 3);
    const windows = marketSummary.bestPostingWindows.slice(0, 2);

    return {
      targetObservation: target
        ? `${target.brandName} is matched in the local catalog, so recommendations are anchored to nearby insurance and benefits brands.`
        : 'No exact target profile was found in the local catalog, so recommendations are based on nearest known Instagram competitors.',
      priorities: [
        `Bias toward ${strongestHooks.join(', ') || 'problem-solution hooks'} because those formats dominate the strongest competitor samples.`,
        `Test posting in ${windows.join(' and ') || 'the highest-density windows'} before broadening to other slots.`,
        `Build around ${commonPillars.join(', ') || 'educational pillars'} because the category is winning with repeatable, easy-to-serialize topics.`,
      ],
      buildNext: [
        'Add a live Instagram collector that stores recent post metadata into the same profile schema.',
        'Add LLM classification for hooks, content pillars, thumbnail style, and caption type from raw captions/transcripts.',
        'Add exports to CSV/Sheets so the research can be shared with growth, content, and brand teams.',
      ],
    };
  }

  private findTargetProfile(catalog: InstagramProfile[], input: RecalculateGtmDto) {
    const handle = input.instagramHandle?.replace(/^@/, '').toLowerCase();
    const company = this.normalize(input.companyName);

    return catalog.find((profile) => {
      const byHandle = handle && profile.handle.toLowerCase() === handle;
      const byBrand = this.normalize(profile.brandName).includes(company) || company.includes(this.normalize(profile.brandName));
      return Boolean(byHandle || byBrand);
    });
  }

  private rankCompetitors(
    catalog: InstagramProfile[],
    target: InstagramProfile | undefined,
    input: RecalculateGtmDto,
  ) {
    const searchTerms = this.tokenize([
      input.companyName,
      input.instagramHandle,
      input.industry,
      input.notes,
      target?.category,
      ...(target?.keywords ?? []),
    ]);

    return catalog
      .filter((profile) => profile.id !== target?.id)
      .map((profile) => ({
        profile,
        score: this.scoreProfile(profile, target, searchTerms),
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.profile);
  }

  private scoreProfile(profile: InstagramProfile, target: InstagramProfile | undefined, searchTerms: string[]) {
    let score = 0;
    const haystack = this.tokenize([
      profile.brandName,
      profile.handle,
      profile.category,
      profile.businessModel,
      profile.targetAudience,
      ...profile.keywords,
      ...profile.contentPillars,
    ]);

    const overlap = searchTerms.filter((term) => haystack.includes(term)).length;
    score += overlap * 3;

    if (target) {
      const targetKeywords = new Set(this.tokenize([target.category, target.businessModel, target.targetAudience, ...target.keywords]));
      score += haystack.filter((token) => targetKeywords.has(token)).length * 2;
      if (profile.category.split('/')[0].trim() === target.category.split('/')[0].trim()) {
        score += 5;
      }
    }

    return score;
  }

  private getIntervalsInHours(posts: InstagramPost[]) {
    if (posts.length < 2) {
      return { average: 0, shortest: 0, longest: 0 };
    }

    const sorted = [...posts].sort(
      (a, b) => new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime(),
    );
    const values: number[] = [];

    for (let index = 1; index < sorted.length; index += 1) {
      const current = new Date(sorted[index].postedAt).getTime();
      const previous = new Date(sorted[index - 1].postedAt).getTime();
      values.push((current - previous) / (1000 * 60 * 60));
    }

    return {
      average: this.average(values),
      shortest: Math.min(...values),
      longest: Math.max(...values),
    };
  }

  private getPreferredWindows(posts: InstagramPost[]) {
    const labels = posts.map((post) => {
      const label = new Intl.DateTimeFormat('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      }).format(new Date(post.postedAt));
      return `${label} IST`;
    });

    return this.topLabels(labels, 3);
  }

  private toShareBreakdown(values: string[]) {
    const total = values.length || 1;
    return Object.entries(
      values.reduce<Record<string, number>>((acc, value) => {
        acc[value] = (acc[value] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        label,
        count,
        sharePercent: this.round((count / total) * 100),
      }));
  }

  private topLabels(values: string[], limit = 3) {
    return Object.entries(
      values.reduce<Record<string, number>>((acc, value) => {
        acc[value] = (acc[value] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([label]) => label);
  }

  private tokenize(values: Array<string | undefined>) {
    return values
      .filter(Boolean)
      .flatMap((value) => this.normalize(value!).split(' '))
      .filter((value) => value.length > 2);
  }

  private normalize(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  private average(values: number[]) {
    if (!values.length) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private round(value: number) {
    return Number(value.toFixed(2));
  }
}
