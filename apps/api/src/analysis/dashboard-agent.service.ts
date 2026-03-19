import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { InsightAgentService } from './insight-agent.service';
import { LiveInstagramResearchDto } from './dto/live-instagram-research.dto';

type CachedDashboardRun = {
  key: string;
  generatedAt: string;
  result: unknown;
};

@Injectable()
export class DashboardAgentService {
  private readonly cachePath = join(process.cwd(), 'db', 'dashboard-agent-cache.json');

  constructor(private readonly insightAgentService: InsightAgentService) {
    const dbDir = join(process.cwd(), 'db');
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    if (!existsSync(this.cachePath)) writeFileSync(this.cachePath, '[]', 'utf8');
  }

  async run(input: LiveInstagramResearchDto) {
    const cacheKey = this.buildCacheKey(input);
    if (!input.forceRefresh) {
      const cached = this.readCache().find((entry) => entry.key === cacheKey);
      if (cached) {
        return cached.result;
      }
    }

    try {
      const insights = await this.insightAgentService.run(input);

      const result = {
        generatedAt: insights.generatedAt,
        sourceMode: 'agent-4-dashboard',
        sessionId: `dashboard-${Date.now()}`,
        target: {
          brandName: input.companyName,
          handle: insights.targetDetail.handle,
          profileUrl: insights.targetDetail.profileUrl,
          category: insights.targetDetail.category,
          bio: insights.targetDetail.bio,
          followers: insights.targetDetail.followerCount,
          verified: insights.targetDetail.verified,
          screenshotPath: insights.targetDetail.screenshotPath,
        },
        collection: {
          summary: `Discovery Agent validated @${insights.targetDetail.handle}, Collection Agent gathered ${insights.collectionSummary.totalMediaItems} items, and Insight Agent ranked ${insights.marketSummary.competitorCount} Indian competitors.`,
          warnings: insights.collectionSummary.warnings,
        },
        competitors: insights.competitors.map((competitor: any) => ({
          id: competitor.id,
          brandName: competitor.brandName,
          handle: competitor.handle,
          profileUrl: competitor.profileUrl,
          category: competitor.category,
          businessModel: competitor.businessModel,
          targetAudience: competitor.targetAudience,
          bio: competitor.bio,
          about: competitor.about,
          followerCount: competitor.followerCount,
          followingCount: competitor.followingCount,
          postCount: competitor.postCount,
          verified: competitor.verified,
          confidence: competitor.confidence,
          screenshotPath: competitor.screenshotPath,
          contentPillars: competitor.contentPillars,
          hookPatterns: competitor.hookPatterns,
          captionStyles: competitor.captionStyles,
          thumbnailStyles: competitor.thumbnailStyles,
          postingCadence: competitor.postingCadence,
          metrics: competitor.metrics,
          mix: competitor.mix,
          topPosts: competitor.topPosts,
          signals: competitor.signals,
          candidates: competitor.candidates,
        })),
        marketSummary: insights.marketSummary,
        recommendations: insights.recommendations,
        discovery: (insights as any).discovery,
      };

      const cache = this.readCache().filter((entry) => entry.key !== cacheKey);
      cache.unshift({ key: cacheKey, generatedAt: new Date().toISOString(), result });
      writeFileSync(this.cachePath, JSON.stringify(cache.slice(0, 20), null, 2), 'utf8');
      return result;
    } catch (error) {
      console.error('[DashboardAgent] Execution failed:', error);
      throw new Error(`Research failed: ${error instanceof Error ? error.message : 'Unknown internal error'}`);
    }
  }

  private buildCacheKey(input: LiveInstagramResearchDto) {
    return JSON.stringify({
      companyName: input.companyName.toLowerCase(),
      instagramHandle: input.instagramHandle.toLowerCase(),
      industry: input.industry?.toLowerCase() ?? '',
      competitorLimit: input.competitorLimit ?? 10,
      recentPostLimit: input.recentPostLimit ?? 500,
      confirmed: input.confirmedCompetitors?.map(c => `${c.companyName}:${c.handle}`).sort() ?? [],
    });
  }

  private readCache() {
    return JSON.parse(readFileSync(this.cachePath, 'utf8')) as CachedDashboardRun[];
  }
}
