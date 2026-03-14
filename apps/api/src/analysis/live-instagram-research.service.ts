import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as cheerio from 'cheerio';
import { LiveInstagramResearchDto } from './dto/live-instagram-research.dto';

type ApifyRelatedProfile = {
  username?: string;
  full_name?: string;
  is_verified?: boolean;
};

type ApifyPost = {
  id?: string;
  type?: string;
  shortCode?: string;
  caption?: string;
  url?: string;
  commentsCount?: number;
  displayUrl?: string;
  likesCount?: number;
  timestamp?: string;
  alt?: string;
};

type ApifyProfile = {
  username: string;
  url?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  businessCategoryName?: string;
  private?: boolean;
  verified?: boolean;
  profilePicUrlHD?: string;
  externalUrl?: string;
  relatedProfiles?: ApifyRelatedProfile[];
  latestPosts?: ApifyPost[];
};

type ApifyReel = {
  id?: string;
  shortCode?: string;
  caption?: string;
  url?: string;
  commentsCount?: number;
  displayUrl?: string;
  likesCount?: number;
  timestamp?: string;
  videoDuration?: number;
  videoViewCount?: number;
  ownerUsername?: string;
  alt?: string;
};

interface CachedRun {
  key: string;
  generatedAt: string;
  input: LiveInstagramResearchDto;
  result: unknown;
}

@Injectable()
export class LiveInstagramResearchService {
  private readonly cachePath = join(process.cwd(), 'db', 'live-research-cache.json');
  private readonly envPath = join(process.cwd(), '.env');
  private readonly profileActor = 'apify~instagram-profile-scraper';
  private readonly reelActor = 'apify~instagram-reel-scraper';

  constructor() {
    this.ensureStorage();
  }

  async run(input: LiveInstagramResearchDto) {
    const token = this.getApifyToken();
    if (!token) {
      throw new BadRequestException('APIFY_TOKEN is missing in apps/api/.env.');
    }

    const cacheKey = this.buildCacheKey(input);
    if (!input.forceRefresh) {
      const cached = this.readCache().find((item) => item.key === cacheKey);
      if (cached) {
        return cached.result;
      }
    }

    const resolvedHandle = await this.resolveTargetHandle(input.companyName, input.instagramHandle, token);
    const targetProfiles = await this.fetchProfiles([resolvedHandle], token);
    const target = targetProfiles[0];

    if (!target) {
      throw new BadRequestException(`No Instagram profile data returned for @${resolvedHandle}.`);
    }

    const competitorHandles = await this.discoverCompetitorHandles(input, target);
    const candidateProfiles = await this.fetchProfiles(competitorHandles.slice(0, 12), token);
    const selectedCompetitors = candidateProfiles
      .map((profile) => ({ profile, score: this.scoreProfile(profile, target, input) }))
      .filter((item) => item.score >= 1 && !item.profile.private)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.competitorLimit ?? 4)
      .map((item) => item.profile);

    const reelMap = new Map<string, ApifyReel[]>();
    for (const profile of [target, ...selectedCompetitors]) {
      const reels = await this.fetchReels(profile.username, input.recentPostLimit ?? 5, token).catch(() => []);
      reelMap.set(profile.username, reels);
    }

    const result = this.buildResult(input, target, selectedCompetitors, reelMap, resolvedHandle !== input.instagramHandle.replace('@', ''));
    const cache = this.readCache().filter((item) => item.key !== cacheKey);
    cache.unshift({ key: cacheKey, generatedAt: new Date().toISOString(), input, result });
    writeFileSync(this.cachePath, JSON.stringify(cache.slice(0, 20), null, 2), 'utf8');
    return result;
  }

  private async resolveTargetHandle(companyName: string, providedHandle: string, token: string) {
    const normalized = providedHandle.replace('@', '').trim();
    const guessedHandles = this.generateHandleCandidates(companyName, normalized);
    const searchHandles = await this.searchInstagramHandles(`${companyName} official instagram`).catch(() => []);
    const candidates = Array.from(new Set([normalized, ...guessedHandles, ...searchHandles.slice(0, 6)]));
    const profiles = await this.fetchProfiles(candidates, token).catch(() => [] as ApifyProfile[]);

    if (!profiles.length) {
      return normalized;
    }

    return profiles
      .map((profile) => ({ profile, score: this.scoreResolvedTarget(profile, companyName) }))
      .sort((a, b) => b.score - a.score)[0]?.profile.username ?? normalized;
  }

  private async discoverCompetitorHandles(input: LiveInstagramResearchDto, target: ApifyProfile) {
    const searchQueries = [
      `${input.companyName} competitors instagram ${input.industry ?? ''}`,
      `site:instagram.com ${target.businessCategoryName ?? ''} ${this.extractKeywords(target.biography ?? '').slice(0, 4).join(' ')} instagram`,
      `site:instagram.com insurance employee benefits startup hr instagram india`,
    ];

    const handles = new Set<string>();
    (target.relatedProfiles ?? []).forEach((profile) => {
      if (profile.username) {
        handles.add(profile.username);
      }
    });

    this.getFallbackHandles(input, target).forEach((handle) => handles.add(handle));

    for (const query of searchQueries) {
      const found = await this.searchInstagramHandles(query).catch(() => []);
      found.forEach((handle) => handles.add(handle));
    }

    handles.delete(target.username);
    return Array.from(handles).filter((handle) => !this.isLikelyGenericPath(handle));
  }

  private getFallbackHandles(input: LiveInstagramResearchDto, target: ApifyProfile) {
    const haystack = `${input.companyName} ${input.industry ?? ''} ${target.businessCategoryName ?? ''} ${target.biography ?? ''}`.toLowerCase();
    if (/insurance|benefit|claims|policy/.test(haystack)) {
      return ['onsurity', 'loophealth', 'novabenefits', 'joinditto', 'ackoindia'];
    }
    if (/health\/beauty|face yoga|fascia|posture|beauty/.test(haystack)) {
      return ['faceyogaexpert', 'allyoucanface', 'skingymco'];
    }
    return [] as string[];
  }
  private async searchInstagramHandles(query: string) {
    const response = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) {
      throw new Error(`Search request failed with ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const handles = new Set<string>();

    $('a').each((_, element) => {
      const href = $(element).attr('href') ?? '';
      const decoded = this.decodeDuckDuckGoUrl(href);
      const match = decoded.match(/instagram\.com\/([A-Za-z0-9._]+)\/?/i);
      const handle = match?.[1];
      if (handle && !this.isLikelyGenericPath(handle)) {
        handles.add(handle);
      }
    });

    return Array.from(handles).slice(0, 20);
  }

  private async fetchProfiles(usernames: string[], token: string) {
    const uniqueUsernames = Array.from(new Set(usernames.map((item) => item.replace('@', '').trim()).filter(Boolean)));
    if (!uniqueUsernames.length) {
      return [] as ApifyProfile[];
    }

    return this.runActor<ApifyProfile[]>(this.profileActor, { usernames: uniqueUsernames }, token);
  }

  private async fetchReels(username: string, resultsLimit: number, token: string) {
    return this.runActor<ApifyReel[]>(this.reelActor, { username: [username], resultsLimit }, token);
  }

  private async runActor<T>(actor: string, input: Record<string, unknown>, token: string): Promise<T> {
    const response = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const payload = await response.text();
      throw new Error(payload);
    }

    return response.json() as Promise<T>;
  }

  private buildResult(
    input: LiveInstagramResearchDto,
    target: ApifyProfile,
    competitors: ApifyProfile[],
    reelMap: Map<string, ApifyReel[]>,
    resolvedHandleChanged: boolean,
  ) {
    const analyzedCompetitors = competitors.map((profile) => this.analyzeProfile(profile, reelMap.get(profile.username) ?? []));
    const analyzedTarget = this.analyzeProfile(target, reelMap.get(target.username) ?? []);
    const topPosts = analyzedCompetitors.flatMap((item) => item.topPosts).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 8);

    return {
      generatedAt: new Date().toISOString(),
      sourceMode: 'apify-instagram-live',
      sessionId: `apify-${Date.now()}`,
      target: {
        brandName: input.companyName,
        handle: target.username,
        profileUrl: target.url ?? `https://www.instagram.com/${target.username}/`,
        category: target.businessCategoryName ?? 'Unknown category',
        bio: target.biography ?? '',
        followers: target.followersCount ?? null,
        verified: target.verified ?? false,
        screenshotPath: target.profilePicUrlHD ?? '',
      },
      collection: {
        summary: `Resolved target @${target.username}, discovered ${competitors.length} relevant competitor profiles, and analyzed live profile + reel metadata from Apify-backed Instagram actors.`,
        warnings: [
          ...(resolvedHandleChanged ? [`The input handle was corrected to @${target.username} using discovery.`] : []),
          'Data is provider-backed live Instagram metadata, not seeded sample content.',
          'Some profiles have few or no reels, so reel averages may be based on a small sample.',
        ],
      },
      competitors: analyzedCompetitors,
      marketSummary: {
        competitorCount: analyzedCompetitors.length,
        averageFollowers: this.round(this.average(analyzedCompetitors.map((item) => item.followerCount ?? 0))),
        averageViewsAcrossCompetitors: this.round(this.average(analyzedCompetitors.map((item) => item.metrics.averageViews))),
        averageReelViewsAcrossCompetitors: this.round(this.average(analyzedCompetitors.map((item) => item.metrics.averageReelViews))),
        topHookThemes: this.topLabels(analyzedCompetitors.flatMap((item) => item.mix.hookTypes.map((entry) => entry.label))),
        topCaptionStyles: this.topLabels(analyzedCompetitors.flatMap((item) => item.mix.captionTypes.map((entry) => entry.label))),
        bestPostingWindows: this.topLabels(analyzedCompetitors.flatMap((item) => item.postingCadence.preferredWindows), 4),
        bestPerformingPostSamples: topPosts,
      },
      recommendations: {
        targetObservation: `Target profile analysis is now sourced from Apify provider data for @${target.username}, and competitor selection is filtered by bio/category similarity to ${input.companyName}.`,
        priorities: [
          'Start with the top hook patterns and caption types that dominate competitor reels.',
          'Test the repeated posting windows first because they reflect actual live timestamps.',
          'Use the post thumbnails and cover imagery in the dashboard as creative references, not just the numeric metrics.',
        ],
        buildNext: [
          'Add saved run history and trend comparisons over time.',
          'Export the normalized research output to Sheets or CSV.',
          'Add a richer competitor discovery layer using website/company graph enrichment.',
        ],
      },
      targetDetail: analyzedTarget,
    };
  }

  private analyzeProfile(profile: ApifyProfile, reels: ApifyReel[]) {
    const latestPosts = (profile.latestPosts ?? []).slice(0, 8);
    const mappedPosts = latestPosts.map((post) => {
      const matchingReel = reels.find((reel) => reel.shortCode && reel.shortCode === post.shortCode);
      const caption = matchingReel?.caption ?? post.caption ?? '';
      const mediaType = matchingReel ? 'reel' : this.mapPostType(post.type);
      return {
        id: post.id ?? matchingReel?.id ?? post.shortCode ?? `${profile.username}-${Math.random()}`,
        url: matchingReel?.url ?? post.url ?? '',
        postedAt: matchingReel?.timestamp ?? post.timestamp,
        mediaType,
        captionPreview: caption.slice(0, 220),
        hookType: this.classifyHook(caption),
        captionType: this.classifyCaptionType(caption),
        contentType: this.classifyContentType(caption, profile),
        thumbnailLabel: this.buildThumbnailLabel(caption, post.alt),
        durationSec: matchingReel?.videoDuration ?? null,
        views: matchingReel?.videoViewCount ?? null,
        likes: matchingReel?.likesCount ?? post.likesCount ?? null,
        comments: matchingReel?.commentsCount ?? post.commentsCount ?? null,
        screenshotPath: matchingReel?.displayUrl ?? post.displayUrl ?? '',
      };
    });

    const reelsOnly = mappedPosts.filter((post) => post.mediaType === 'reel');
    const intervals = this.getIntervals(mappedPosts);

    return {
      id: profile.username,
      brandName: profile.fullName ?? profile.username,
      handle: profile.username,
      profileUrl: profile.url ?? `https://www.instagram.com/${profile.username}/`,
      category: profile.businessCategoryName ?? 'Unknown category',
      businessModel: profile.businessCategoryName ?? 'Unknown',
      targetAudience: profile.biography ?? '',
      bio: profile.biography ?? '',
      about: profile.biography ?? '',
      followerCount: profile.followersCount ?? null,
      followingCount: profile.followsCount ?? null,
      postCount: profile.postsCount ?? null,
      verified: profile.verified ?? false,
      confidence: this.scoreConfidence(profile, mappedPosts),
      screenshotPath: profile.profilePicUrlHD ?? '',
      contentPillars: this.topLabels(mappedPosts.map((post) => post.contentType), 4),
      hookPatterns: this.topLabels(mappedPosts.map((post) => post.hookType), 4),
      captionStyles: this.topLabels(mappedPosts.map((post) => post.captionType), 4),
      thumbnailStyles: this.topLabels(mappedPosts.map((post) => post.thumbnailLabel), 4),
      postingCadence: {
        averageIntervalHours: this.round(intervals.average),
        shortestIntervalHours: this.round(intervals.shortest),
        longestIntervalHours: this.round(intervals.longest),
        preferredWindows: this.topLabels(mappedPosts.map((post) => this.formatWindow(post.postedAt)), 3),
      },
      metrics: {
        totalSamplePosts: mappedPosts.length,
        totalSampleReels: reelsOnly.length,
        reelSharePercent: this.round(mappedPosts.length ? (reelsOnly.length / mappedPosts.length) * 100 : 0),
        averageViews: this.round(this.average(mappedPosts.map((post) => post.views ?? 0))),
        averageReelViews: this.round(this.average(reelsOnly.map((post) => post.views ?? 0))),
        averageComments: this.round(this.average(mappedPosts.map((post) => post.comments ?? 0))),
        averageDurationSec: this.round(this.average(reelsOnly.map((post) => post.durationSec ?? 0))),
        engagementRatePerPostPercent: this.round(this.average(mappedPosts.map((post) => (((post.likes ?? 0) + (post.comments ?? 0)) / Math.max(profile.followersCount ?? 1, 1)) * 100))),
      },
      mix: {
        mediaTypes: this.toBreakdown(mappedPosts.map((post) => post.mediaType)),
        contentTypes: this.toBreakdown(mappedPosts.map((post) => post.contentType)),
        hookTypes: this.toBreakdown(mappedPosts.map((post) => post.hookType)),
        captionTypes: this.toBreakdown(mappedPosts.map((post) => post.captionType)),
      },
      topPosts: [...mappedPosts].sort((a, b) => (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0)).slice(0, 5),
      signals: [
        profile.verified ? 'verified' : 'not-verified',
        profile.private ? 'private' : 'public',
        profile.businessCategoryName ? 'business-category-visible' : 'business-category-hidden',
      ],
    };
  }

  private generateHandleCandidates(companyName: string, providedHandle: string) {
    const rawTokens = this.extractKeywords(companyName).filter((token) => !['insurance', 'company', 'official'].includes(token));
    const primary = rawTokens[0] ?? providedHandle;
    const joined = rawTokens.join('');
    return Array.from(new Set([
      providedHandle,
      primary,
      `${primary}hq`,
      `get${primary}`,
      `get${primary}hq`,
      joined,
      `${joined}hq`,
      `join${primary}`,
      `${primary}india`,
    ])).filter(Boolean);
  }
  private scoreResolvedTarget(profile: ApifyProfile, companyName: string) {
    const haystack = `${profile.username} ${profile.fullName ?? ''} ${profile.biography ?? ''}`.toLowerCase();
    const tokens = this.extractKeywords(companyName);
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += 3;
      }
    }
    if ((profile.followersCount ?? 0) > 0) score += 4;
    if ((profile.postsCount ?? 0) > 0) score += 3;
    if ((profile.biography ?? '').length > 10) score += 3;
    return score;
  }
  private scoreProfile(profile: ApifyProfile, target: ApifyProfile, input: LiveInstagramResearchDto) {
    const haystack = `${profile.fullName ?? ''} ${profile.biography ?? ''} ${profile.businessCategoryName ?? ''}`.toLowerCase();
    const keywords = Array.from(new Set([
      ...this.extractKeywords(input.companyName),
      ...this.extractKeywords(input.industry ?? ''),
      ...this.extractKeywords(target.biography ?? ''),
      ...this.extractKeywords(target.businessCategoryName ?? ''),
    ]));

    let score = 0;
    for (const keyword of keywords) {
      if (haystack.includes(keyword)) {
        score += 2;
      }
    }
    if ((profile.businessCategoryName ?? '').toLowerCase() === (target.businessCategoryName ?? '').toLowerCase()) {
      score += 4;
    }
    if (/insurance|benefit|health/.test(`${input.companyName} ${input.industry ?? ''} ${target.businessCategoryName ?? ''}`.toLowerCase())) {
      if (/insurance|benefit|health/.test(haystack)) {
        score += 5;
      } else {
        score -= 4;
      }
    }
    if (profile.verified) {
      score += 1;
    }
    return score;
  }

  private scoreConfidence(profile: ApifyProfile, posts: Array<{ mediaType: string }>) {
    let confidence = 0.4;
    if (profile.biography) confidence += 0.2;
    if (profile.businessCategoryName) confidence += 0.15;
    if (profile.followersCount) confidence += 0.15;
    if (posts.length >= 3) confidence += 0.1;
    return Math.min(1, confidence);
  }

  private mapPostType(type?: string) {
    if ((type ?? '').toLowerCase().includes('video')) return 'reel';
    return 'post';
  }

  private classifyHook(caption: string) {
    if (/\?/.test(caption)) return 'question opener';
    if (/myth|mistake|wrong|truth/i.test(caption)) return 'myth-busting opener';
    if (/how|why|here is|here are/i.test(caption)) return 'problem-solution opener';
    if (/\b[0-9]+\b|%/.test(caption)) return 'stat-led opener';
    return 'story opener';
  }

  private classifyCaptionType(caption: string) {
    if (/save|checklist|steps|1\.|2\./i.test(caption)) return 'checklist';
    if (/book|demo|learn more|link in bio|dm/i.test(caption)) return 'CTA';
    if (/story|once|when/i.test(caption)) return 'storytelling';
    if (/\?/.test(caption)) return 'FAQ';
    return 'educational';
  }

  private classifyContentType(caption: string, profile: ApifyProfile) {
    const combined = `${caption} ${profile.businessCategoryName ?? ''} ${profile.biography ?? ''}`;
    if (/claim|coverage|policy|insurance/i.test(combined)) return 'insurance explainer';
    if (/employee|benefit|hr|team/i.test(combined)) return 'employee benefits';
    if (/health|care|wellness|doctor/i.test(combined)) return 'health education';
    if (/founder|startup|business/i.test(combined)) return 'founder education';
    return 'general education';
  }

  private buildThumbnailLabel(caption: string, alt?: string) {
    const seed = caption || alt || 'Instagram post';
    return seed.split(/[.!?\n]/)[0].trim().split(/\s+/).slice(0, 5).join(' ');
  }

  private getIntervals(posts: Array<{ postedAt?: string }>) {
    const times = posts.map((post) => post.postedAt ? new Date(post.postedAt).getTime() : null).filter((value): value is number => value !== null).sort((a, b) => a - b);
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

  private toBreakdown(items: string[]) {
    const counts = new Map<string, number>();
    items.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1));
    const total = items.length || 1;
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count, sharePercent: this.round((count / total) * 100) }));
  }

  private topLabels(items: string[], limit = 3) {
    return this.toBreakdown(items).slice(0, limit).map((item) => item.label);
  }

  private extractKeywords(input: string) {
    const stop = new Set(['instagram', 'official', 'follow', 'followers', 'following', 'posts', 'and', 'the', 'with', 'for', 'your', 'from', 'into', 'that', 'company']);
    return input.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((token) => token.length > 3 && !stop.has(token)).slice(0, 12);
  }

  private average(values: number[]) {
    const valid = values.filter((value) => Number.isFinite(value));
    if (!valid.length) return 0;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  private round(value: number) {
    return Number(value.toFixed(2));
  }

  private decodeDuckDuckGoUrl(href: string) {
    const match = href.match(/[?&]uddg=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : href;
  }

  private isLikelyGenericPath(handle: string) {
    return ['p', 'reel', 'explore', 'accounts', 'stories', 'directory'].includes(handle.toLowerCase());
  }

  private getApifyToken() {
    const direct = process.env.APIFY_TOKEN;
    if (direct) return direct;
    if (!existsSync(this.envPath)) return '';
    const raw = readFileSync(this.envPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
    const match = raw.match(/^APIFY_TOKEN=(.+)$/m);
    return match?.[1]?.trim() ?? '';
  }

  private buildCacheKey(input: LiveInstagramResearchDto) {
    return JSON.stringify({
      companyName: input.companyName.toLowerCase(),
      instagramHandle: input.instagramHandle.toLowerCase(),
      industry: input.industry?.toLowerCase() ?? '',
      competitorLimit: input.competitorLimit ?? 4,
      recentPostLimit: input.recentPostLimit ?? 5,
    });
  }

  private ensureStorage() {
    const dbDir = join(process.cwd(), 'db');
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    if (!existsSync(this.cachePath)) writeFileSync(this.cachePath, '[]', 'utf8');
  }

  private readCache() {
    return JSON.parse(readFileSync(this.cachePath, 'utf8')) as CachedRun[];
  }
}







