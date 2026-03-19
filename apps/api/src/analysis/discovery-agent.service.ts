import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';
import { LiveInstagramResearchDto } from './dto/live-instagram-research.dto';
import { InstagramPlaywrightService } from './instagram-playwright.service';

type DiscoveryScoring = {
  productSimilarity: number;
  targetMarketFit: number;
  aspFit: number;
  placeFit: number;
  promotionFit: number;
  total: number;
};

type DiscoveryCompetitor = {
  companyName: string;
  canonicalName: string;
  officialInstagramHandle: string | null;
  instagramProfileUrl: string | null;
  confidence: number;
  confidenceLabel: string;
  officialSignals: string[];
  whyItMatched: string[];
  website?: string;
  scoring: DiscoveryScoring;
  instagramProfile?: {
    fullName: string | null;
    bio: string | null;
    category: string | null;
    followers: number | null;
    verified: boolean;
    posts: number | null;
  };
  candidates?: Array<{
    handle: string;
    fullName: string | null;
    bio: string | null;
    followers: number | null;
    verified: boolean;
    score: number;
  }>;
};

type DiscoveryResponse = {
  generatedAt: string;
  sourceMode: string;
  target: {
    inputCompanyName: string;
    inputInstagramHandle: string;
    resolvedInstagramHandle: string;
    exactHandleMatch: boolean;
    profileUrl: string;
    bio: string | null;
    category: string | null;
    followers: number | null;
    verified: boolean;
  };
  discovery: {
    searchQueries: string[];
    competitorCount: number;
    notes: string[];
    needsConfirmation?: boolean;
  };
  competitors: DiscoveryCompetitor[];
};

type SearchResult = {
  title: string;
  snippet: string;
  url: string;
};

type CompanyCandidate = {
  name: string;
  website?: string;
  instagramHandle?: string | null;
  snippets: string[];
  titles: string[];
  score: number;
  preferredFollowers?: number | null;
  preferredCategory?: string;
  preferredPositioning?: string;
  source?: 'csv' | 'document' | 'seed' | 'web';
};

type OfficialHandleAssessment = {
  totalScore: number;
  signals: string[];
};

type CategoryProfile = {
  id: string;
  label: string;
  keywords: string[];
  productKeywords: string[];
  targetMarketKeywords: string[];
  aspKeywords: string[];
  placeKeywords: string[];
  promotionKeywords: string[];
  seeds: Array<{ name: string; website?: string; score: number; reason: string }>;
};

type CategoryContext = {
  profile: CategoryProfile;
  score: number;
  matchedKeywords: string[];
  queryKeywords: string[];
  summary: string;
};

type BrandDocumentRecord = {
  brand: string;
  canonicalBrand: string;
  instagramHandle: string | null;
  followers: number | null;
  category: string;
  positioning: string;
  source: 'd2c-bible' | 'non-d2c';
  verifiedHint: boolean;
};

type CsvBrandRecord = {
  brand: string;
  canonicalBrand: string;
  instagramHandle: string | null;
  domain: string;
  proposition: string;
};

@Injectable()
export class DiscoveryAgentService {
  private readonly csvPathCandidates = [
    join(process.cwd(), '..', '..', 'data', 'brands_with_unique_propositions.csv'),
    join(process.cwd(), '..', '..', 'data', 'Missing_Brands_Not_In_CSV-Default-view-export-1773647059137.csv'),
    join(process.cwd(), '..', '..', 'brands_with_unique_propositions.csv'),
    join(process.cwd(), '..', '..', 'Missing_Brands_Not_In_CSV-Default-view-export-1773647059137.csv'),
    'C:\\Users\\aryaf\\Downloads\\brands_with_unique_propositions.csv',
    'C:\\Users\\aryaf\\Downloads\\Missing_Brands_Not_In_CSV-Default-view-export-1773647059137.csv',
  ];
  private readonly documentPaths = [
    'C:\\Users\\aryaf\\Downloads\\India_D2C_Brand_Bible_With_Instagram.md',
    'C:\\Users\\aryaf\\Downloads\\Altera_Institute_Non_D2C_Recruiters_Instagram.md',
    join(process.cwd(), '..', '..', 'Downloads', 'India_D2C_Brand_Bible_With_Instagram.md'),
    join(process.cwd(), '..', '..', 'Downloads', 'Altera_Institute_Non_D2C_Recruiters_Instagram.md'),
  ];
  private brandsCache: CsvBrandRecord[] | null = null;
  private documentBrandCache: BrandDocumentRecord[] | null = null;

  constructor(private readonly instagramPlaywrightService: InstagramPlaywrightService) {}

  async run(input: LiveInstagramResearchDto): Promise<DiscoveryResponse> {
    const exactHandle = input.instagramHandle.replace('@', '').trim();
    const targetMeta = await this.instagramPlaywrightService.scrapeProfileMeta(exactHandle, true);

    // If we have confirmed competitors from the user, we skip discovery and use them.
    if (input.confirmedCompetitors) {
      console.log(`[DiscoveryAgent] Resuming with confirmed competitors: ${input.confirmedCompetitors.length}`);
      const resolvedCompetitors = await this.resolveConfirmedCompetitors(input.confirmedCompetitors, exactHandle);
      console.log(`[DiscoveryAgent] Resolved ${resolvedCompetitors.length} competitors from confirmation.`);
      return {
        generatedAt: new Date().toISOString(),
        sourceMode: 'agent-1-discovery-resumed',
        target: {
          inputCompanyName: input.companyName,
          inputInstagramHandle: exactHandle,
          resolvedInstagramHandle: exactHandle,
          exactHandleMatch: true,
          profileUrl: targetMeta.profileUrl,
          bio: targetMeta.bio,
          category: targetMeta.category,
          followers: targetMeta.followers,
          verified: targetMeta.verified,
        },
        discovery: {
          searchQueries: [],
          competitorCount: resolvedCompetitors.length,
          notes: ['Research resumed with user-confirmed Instagram handles.'],
          needsConfirmation: false,
        },
        competitors: resolvedCompetitors,
      };
    }
    const excelMatch = this.findBrandInExcel(input.companyName, exactHandle);
    const categoryContext = this.inferCategoryContext(
      input,
      targetMeta.bio ?? '',
      targetMeta.category ?? '',
      excelMatch?.domain,
      excelMatch?.proposition,
    );
    console.log(`[DiscoveryAgent] Inferred Category: ${categoryContext.profile.label} (ID: ${categoryContext.profile.id})`);
    const seedCompanies = this.getIndustrySeedCompanies(categoryContext);
    const requestedCompetitorCount = input.competitorLimit ?? 4;

    const searchQueries = this.buildCompetitorQueries(input, targetMeta.bio ?? targetMeta.fullName ?? '', categoryContext);
    const csvCompanies = excelMatch
      ? this.getCsvCompetitors(excelMatch, input.companyName, requestedCompetitorCount)
      : this.getCompetitorsByDomain(categoryContext.profile.label, input.companyName, requestedCompetitorCount);

    const docBrand = this.findDocumentBrand(input.companyName, exactHandle);
    const docCompanies = docBrand ? this.getDocumentCompetitors(docBrand, input.companyName, requestedCompetitorCount, targetMeta.followers) : [];

    const discoveryLimit = 15; // User target: 10-15 internal candidates
    const showcaseLimit = requestedCompetitorCount;

    const allLibraryCompanies = [...csvCompanies, ...docCompanies];

    const discoveredCompanies = allLibraryCompanies.length > 0
      ? this.mergeCompanyCandidates(allLibraryCompanies, input.companyName)
      : this.mergeCompanyCandidates(
          this.extractCompetitorCompanies(input.companyName, targetMeta.bio ?? '', await this.collectSearchResults(searchQueries), input),
          input.companyName
        );
    
    console.log(`[DiscoveryAgent] Discovered ${discoveredCompanies.length} potential company candidates.`);

    // Resolve up to 15 candidates to find the best 4P fits
    const resolvedCandidates = await this.resolveInstagramHandles(
      discoveredCompanies,
      exactHandle,
      discoveryLimit,
      categoryContext,
    );

    console.log(`[DiscoveryAgent] Resolved ${resolvedCandidates.length} Instagram handles.`);
    resolvedCandidates.forEach((c, i) => {
      console.log(`   ${i+1}. ${c.companyName} - Total 4P Score: ${c.scoring?.total ?? 0} (Handle: @${c.officialInstagramHandle || 'none'})`);
    });

    // Rank by 4P Total Score (stored in resolvedCandidates[i].scoring.total)
    const rankedCompetitors = resolvedCandidates
      .filter((c) => c.officialInstagramHandle || (c.candidates && c.candidates.length > 0)) // Keep those with at least handle candidates
      .sort((a, b) => (b.scoring?.total ?? 0) - (a.scoring?.total ?? 0));

    const needsConfirmation = rankedCompetitors.some((c) => !c.officialInstagramHandle && c.candidates && c.candidates.length > 0);

    // Showcase ONLY the top 4 (or requested limit) to the user
    const finalCompetitors = rankedCompetitors.slice(0, showcaseLimit);

    return {
      generatedAt: new Date().toISOString(),
      sourceMode: 'agent-1-discovery',
      target: {
        inputCompanyName: input.companyName,
        inputInstagramHandle: exactHandle,
        resolvedInstagramHandle: exactHandle,
        exactHandleMatch: true,
        profileUrl: targetMeta.profileUrl,
        bio: targetMeta.bio,
        category: targetMeta.category,
        followers: targetMeta.followers,
        verified: targetMeta.verified,
      },
      discovery: {
        searchQueries,
        competitorCount: finalCompetitors.length,
        notes: [
          'Agent 1 is anchored on the exact Instagram username you pasted.',
          targetMeta.loginWall
            ? 'Public profile metadata was captured without deep login access. Deep media collection requires a saved Instagram session.'
            : 'Target profile metadata was captured directly from Instagram through the free local collector.',
          (csvCompanies.length || docCompanies.length)
            ? 'Primary competitor source came from your local brand library (CSV/MD).'
            : 'Brand was not found in the local library, so fallback web discovery (15 candidates) was used.',
          `Free category engine inferred the brand category as: ${categoryContext.profile.label}`,
          (csvCompanies.length || docCompanies.length)
            ? 'Known-brand competitors and their Instagram IDs were taken strictly from the library list. No live Instagram handle guessing was used for those competitors.'
            : '15 candidates were discovered from web signals and ranked by 4Ps (Product, Price, Place, Promotion).',
          'Only the top-scoring business/brand profiles are showcased for downstream analysis.',
        ],
        needsConfirmation,
      },
      competitors: finalCompetitors,
    };
  }

  private buildCompetitorQueries(input: LiveInstagramResearchDto, targetText: string, categoryContext: CategoryContext) {
    const categoryKeywords = categoryContext.queryKeywords.slice(0, 5).join(' ');
    const genericKeywords = this.extractKeywords(input.industry ?? targetText).slice(0, 5).join(' ');
    const keywords = categoryKeywords || genericKeywords;
    return [
      `${input.companyName} competitors india`,
      `${input.companyName} alternatives india`,
      `${input.companyName} brands similar to ${categoryContext.profile.label} india`.trim(),
      `top 10 brands in ${categoryContext.profile.label} india`.trim(),
      `popular ${keywords} companies india`.trim(),
      `${input.companyName} vs competitors india ${keywords}`.trim(),
      `${input.companyName} pricing alternatives india ${keywords}`.trim(),
      `${keywords} brands d2c india`.trim(),
    ];
  }

  private inferCategoryContext(
    input: LiveInstagramResearchDto,
    targetBio: string,
    targetCategory: string,
    documentCategory?: string | null,
    documentPositioning?: string | null,
  ): CategoryContext {
    const text = `${input.companyName} ${input.industry ?? ''} ${targetBio} ${targetCategory} ${documentCategory ?? ''} ${documentPositioning ?? ''}`.toLowerCase();
    const profiles = this.getCategoryProfiles();
    const scored = profiles.map((profile) => {
      const matchedKeywords = profile.keywords.filter((keyword) => text.includes(keyword));
      const score = matchedKeywords.length;
      return {
        profile,
        score,
        matchedKeywords,
        queryKeywords: Array.from(new Set([
          ...profile.productKeywords,
          ...profile.targetMarketKeywords,
          ...profile.aspKeywords,
        ])).slice(0, 8),
        summary: `${profile.label}${matchedKeywords.length ? ` (${matchedKeywords.slice(0, 4).join(', ')})` : ''}`,
      };
    }).sort((a, b) => b.score - a.score);

    if (scored[0] && scored[0].score > 0) {
      return scored[0];
    }

      const genericKeywords = this.extractKeywords(text).slice(0, 8);
    return {
      profile: {
        id: 'generic-brand-business',
        label: 'brand/business',
        keywords: genericKeywords,
        productKeywords: genericKeywords,
        targetMarketKeywords: ['india', 'consumer', 'startup'],
        aspKeywords: ['premium', 'affordable', 'price'],
        placeKeywords: ['india'],
        promotionKeywords: ['shop', 'book', 'buy', 'demo'],
        seeds: [],
      },
      score: 0,
      matchedKeywords: genericKeywords,
      queryKeywords: genericKeywords,
      summary: `brand/business (${genericKeywords.join(', ')})`,
    };
  }

  private async collectSearchResults(queries: string[]) {
    const results: SearchResult[] = [];
    for (const query of queries) {
      const items = await this.searchWeb(query).catch((err) => {
        console.error(`[DiscoveryAgent] Search failed for query "${query}":`, err.message);
        return [] as SearchResult[];
      });
      results.push(...items);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Increased delay to prevent AbortError
    }
    return results;
  }

  private mergeCompanyCandidates(candidates: CompanyCandidate[], companyName: string) {
    const merged = new Map<string, CompanyCandidate>();
    const normalizedTarget = this.normalizeCompanyName(companyName).toLowerCase();

    for (const candidate of candidates) {
      const canonical = this.normalizeCompanyName(candidate.name);
      if (!canonical || canonical.toLowerCase() === normalizedTarget) continue;
      const existing = merged.get(canonical) ?? { name: canonical, website: candidate.website, instagramHandle: candidate.instagramHandle, snippets: [], titles: [], score: 0 };
      existing.website = existing.website ?? candidate.website;
      existing.instagramHandle = existing.instagramHandle ?? candidate.instagramHandle;
      existing.score = Math.max(existing.score, candidate.score);
      existing.preferredFollowers = existing.preferredFollowers ?? candidate.preferredFollowers;
      existing.preferredCategory = existing.preferredCategory ?? candidate.preferredCategory;
      existing.preferredPositioning = existing.preferredPositioning ?? candidate.preferredPositioning;
      existing.source = existing.source ?? candidate.source;
      existing.snippets.push(...candidate.snippets);
      existing.titles.push(...candidate.titles);
      merged.set(canonical, existing);
    }

    return Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, 30);
  }

  private extractCompetitorCompanies(companyName: string, targetBio: string, webResults: SearchResult[], input: LiveInstagramResearchDto) {
    const categoryContext = this.inferCategoryContext(input, targetBio, '');
    const stopPhrases = new Set([
      ...this.extractKeywords(companyName),
      'india', 'pricing', 'price', 'competitors', 'competitor', 'alternatives', 'alternative', 'companies', 'company',
      'employee', 'employees', 'benefits', 'benefit', 'health', 'insurance', 'instagram', 'official', 'blog', 'linkedin',
      'founder', 'founders', 'co-founder', 'ceo', 'cto', 'born', 'born in', 'alumni', 'hails from', 'graduate',
    ]);

    const candidates = new Map<string, CompanyCandidate>();

    for (const result of webResults) {
      const text = `${result.title}. ${result.snippet}`;
      for (const phrase of this.extractCompanyPhrases(text)) {
        const canonical = this.normalizeCompanyName(phrase);
        if (!canonical || canonical.toLowerCase() === this.normalizeCompanyName(companyName).toLowerCase()) continue;
        if (canonical.split(' ').every((token) => stopPhrases.has(token.toLowerCase()))) continue;
        const entry = candidates.get(canonical) ?? { name: canonical, website: this.extractDomain(result.url), snippets: [], titles: [], score: 0 };
        entry.snippets.push(result.snippet);
        entry.titles.push(result.title);
        entry.score += this.scoreCompanyCandidate(canonical, result, targetBio, categoryContext);
        entry.source = entry.source ?? 'web';
        candidates.set(canonical, entry);
      }
    }

    for (const seed of this.getIndustrySeedCompanies(categoryContext)) {
      const canonical = this.normalizeCompanyName(seed.name);
      if (!canonical || canonical.toLowerCase() === this.normalizeCompanyName(companyName).toLowerCase()) continue;
      const existing = candidates.get(canonical) ?? { name: canonical, website: seed.website, snippets: [], titles: [], score: 0 };
      existing.score += seed.score;
      existing.website = existing.website ?? seed.website;
      existing.snippets.push(`Industry seed for ${seed.reason}`);
      existing.titles.push(`${seed.reason} ${canonical}`);
      existing.source = existing.source ?? 'seed';
      candidates.set(canonical, existing);
    }

    return Array.from(candidates.values()).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 30);
  }

  private getIndustrySeedCompanies(categoryContext: CategoryContext) {
    return categoryContext.profile.seeds;
  }

  private enrichDocumentCompaniesWithSeedWebsites(
    companies: CompanyCandidate[],
    seeds: Array<{ name: string; website?: string; score: number; reason: string }>,
    companyName: string,
  ) {
    const seedMap = new Map(
      seeds.map((seed) => [this.normalizeCompanyName(seed.name).toLowerCase(), seed]),
    );

    const enriched = companies.map((company) => {
      const seed = seedMap.get(this.normalizeCompanyName(company.name).toLowerCase());
      if (!seed) return company;
      return {
        ...company,
        website: company.website ?? seed.website,
        snippets: [...company.snippets, seed.reason],
        titles: [...company.titles, `${seed.reason} ${company.name}`],
        score: Math.max(company.score, seed.score + 14),
      };
    });

    return this.mergeCompanyCandidates(enriched, companyName);
  }

  private async resolveInstagramHandles(
    companies: CompanyCandidate[],
    targetHandle: string,
    limit: number,
    categoryContext: CategoryContext,
  ) {
    const resolved: DiscoveryCompetitor[] = [];
    const seen = new Set<string>();

    for (const company of companies) {
      if (resolved.length >= limit) break;
      if (company.source === 'csv' && company.instagramHandle) {
        const listedHandle = company.instagramHandle.replace('@', '').trim();
        if (listedHandle && !seen.has(listedHandle.toLowerCase()) && listedHandle.toLowerCase() !== targetHandle.toLowerCase()) {
          const meta = await this.instagramPlaywrightService.scrapeProfileMeta(listedHandle, true).catch(() => null);
          const scoring = this.scoreCompetitorFit(meta ?? {
            handle: listedHandle,
            profileUrl: `https://www.instagram.com/${listedHandle}/`,
            title: `${listedHandle} • Instagram`,
            fullName: null,
            bio: null,
            profileWebsite: null,
            hasPublicEmail: false,
            followers: null,
            following: null,
            posts: null,
            verified: false,
            category: null,
            profileImage: null,
            loginWall: false,
            exists: true,
            usedSession: this.instagramPlaywrightService.hasSavedSession(),
          }, company, categoryContext);
          const confidence = this.round(Math.min(1, 0.82 + Math.min(0.12, scoring.total / 100)));
          resolved.push({
            companyName: company.name,
            canonicalName: this.normalizeCompanyName(company.name),
            officialInstagramHandle: listedHandle,
            instagramProfileUrl: `https://www.instagram.com/${listedHandle}/`,
            confidence,
            confidenceLabel: confidence >= 0.75 ? 'high' : 'medium',
            officialSignals: ['instagram id from master csv'],
            whyItMatched: [
              `Competitor came from the CSV list in the same domain: ${company.preferredCategory ?? 'same domain'}.`,
              company.preferredPositioning
                ? `Proposition overlap matched: ${company.preferredPositioning}.`
                : 'Competitor proposition overlapped with the target brand within the CSV domain.',
            ],
            website: company.website,
            scoring,
            instagramProfile: meta ? {
              fullName: meta.fullName,
              bio: meta.bio,
              category: meta.category,
              followers: meta.followers,
              verified: meta.verified,
              posts: meta.posts,
            } : undefined,
          });
          seen.add(listedHandle.toLowerCase());
          continue;
        }
      }
      const resolvedWebsite = await this.resolveCompanyWebsite(company).catch(() => company.website);
      company.website = resolvedWebsite ?? company.website;
      const websiteRoot = company.website ? this.domainRoot(company.website) : '';
      const websiteHandles = company.website
        ? await this.fetchInstagramHandlesFromWebsite(company.website).catch(() => [] as string[])
        : [];
      const searches = await Promise.all([
        this.searchInstagramHandles(`site:instagram.com "${company.name}" official instagram india`).catch(() => [] as string[]),
        this.searchInstagramHandles(`site:instagram.com "${company.name}" instagram india`).catch(() => [] as string[]),
        this.searchInstagramHandles(`site:instagram.com "${company.name}"`).catch(() => [] as string[]),
        this.searchInstagramHandles(`site:instagram.com "${company.name}" official`).catch(() => [] as string[]),
        this.searchInstagramHandles(`site:instagram.com "${company.name}" brand`).catch(() => [] as string[]),
        websiteRoot
          ? this.searchInstagramHandles(`site:instagram.com "${websiteRoot}" instagram`).catch(() => [] as string[])
          : Promise.resolve([] as string[]),
        websiteRoot
          ? this.searchInstagramHandles(`site:instagram.com "${websiteRoot}"`).catch(() => [] as string[])
          : Promise.resolve([] as string[]),
      ]);
      const handleCandidates = this.rankHandleCandidates(
        Array.from(
        new Set([
          ...websiteHandles,
          ...searches.flat(),
          ...this.companyNameToHandleCandidates(company.name, company.website),
        ]),
        ),
        company.name,
        company.website,
      ).slice(0, company.source === 'document' ? 80 : 30);
      if (!handleCandidates.length) {
        const unresolvedScoring = this.scoreCompetitorFit({
          handle: '',
          profileUrl: '',
          title: company.name,
          fullName: company.name,
          bio: `${company.snippets.join(' ')} ${company.titles.join(' ')}`.trim(),
          profileWebsite: company.website ?? null,
          hasPublicEmail: false,
          followers: company.preferredFollowers ?? null,
          following: null,
          posts: null,
          verified: false,
          category: company.preferredCategory ?? null,
          profileImage: null,
          loginWall: false,
          exists: false,
          usedSession: this.instagramPlaywrightService.hasSavedSession(),
        }, company, categoryContext);
        const fallbackCandidates = this.companyNameToHandleCandidates(company.name, company.website).slice(0, 3).map((handle, index) => ({
          handle,
          fullName: null,
          bio: null,
          followers: null,
          verified: false,
          score: Math.max(1, 3 - index),
        }));

        resolved.push({
          companyName: company.name,
          canonicalName: this.normalizeCompanyName(company.name),
          officialInstagramHandle: null,
          instagramProfileUrl: null,
          confidence: 0,
          confidenceLabel: 'low',
          officialSignals: ['no instagram handle candidates found'],
          whyItMatched: ['Competitor brand was discovered, but no reliable Instagram username candidates were found yet.'],
          website: company.website,
          scoring: unresolvedScoring,
          candidates: fallbackCandidates.length ? fallbackCandidates : undefined,
        });
        continue;
      }

      const evaluated: Array<{
        handle: string;
        meta: Awaited<ReturnType<InstagramPlaywrightService['scrapeProfileMeta']>>;
        score: number;
        signals: string[];
      }> = [];
      let matchedDocumentWebsiteCandidate: {
        handle: string;
        meta: Awaited<ReturnType<InstagramPlaywrightService['scrapeProfileMeta']>>;
        score: number;
        signals: string[];
      } | null = null;
      for (const handle of handleCandidates) {
        if (seen.has(handle.toLowerCase()) || handle.toLowerCase() === targetHandle.toLowerCase()) continue;
        await this.delay(company.source === 'document' ? 300 : 150);
        const meta = await this.instagramPlaywrightService.scrapeProfileMeta(handle, true).catch(() => null);
        if (!meta?.exists) continue;
        const assessment = this.evaluateOfficialBrandProfile(
          meta,
          company.name,
          company.website,
          company.score,
          websiteHandles.some((item) => item.toLowerCase() === meta.handle.toLowerCase()),
        );
        const evaluation = { handle, meta, score: assessment.totalScore, signals: assessment.signals };
        evaluated.push(evaluation);
        if (company.source === 'document' && this.profileWebsiteMatchesCompanyWebsite(meta.profileWebsite, company.website)) {
          matchedDocumentWebsiteCandidate = evaluation;
          break;
        }
      }

      const withWebsite = evaluated.filter((entry) => Boolean(entry.meta.profileWebsite));
      const withEmail = evaluated.filter((entry) => entry.meta.hasPublicEmail);
      const linkedFromOfficialWebsite = evaluated
        .filter((entry) => websiteHandles.some((item) => item.toLowerCase() === entry.meta.handle.toLowerCase()))
        .sort((a, b) => b.score - a.score)[0];
      const exactWebsiteMatch = matchedDocumentWebsiteCandidate ?? withWebsite
        .filter((entry) => this.profileWebsiteMatchesCompanyWebsite(entry.meta.profileWebsite, company.website))
        .sort((a, b) => b.score - a.score)[0];
      const best = company.source === 'document'
        ? exactWebsiteMatch ?? linkedFromOfficialWebsite
        : withWebsite
            .filter((entry) => entry.score >= 6)
            .sort((a, b) => b.score - a.score)[0]
          ?? withWebsite
            .filter((entry) => this.hasStrongOfficialSignal(entry.meta, company.name, company.website))
            .sort((a, b) => b.score - a.score)[0]
          ?? withWebsite
            .sort((a, b) => b.score - a.score)[0]
          ?? withEmail
            .filter((entry) => entry.score >= 6)
            .sort((a, b) => b.score - a.score)[0]
          ?? withEmail
            .filter((entry) => this.hasStrongOfficialSignal(entry.meta, company.name, company.website))
            .sort((a, b) => b.score - a.score)[0]
          ?? withEmail
            .sort((a, b) => b.score - a.score)[0]
          ?? evaluated
            .filter((entry) => this.hasStrongOfficialSignal(entry.meta, company.name, company.website) && entry.score >= 8)
            .sort((a, b) => b.score - a.score)[0]
          ?? evaluated
            .filter((entry) => entry.score >= 10)
            .sort((a, b) => b.score - a.score)[0]
          ?? evaluated
            .filter((entry) => entry.score >= 10 && websiteHandles.some((item) => item.toLowerCase() === entry.meta.handle.toLowerCase()))
            .sort((a, b) => b.score - a.score)[0];
      if (!best) {
        const topCandidates = evaluated
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(c => ({
            handle: c.handle,
            fullName: c.meta.fullName,
            bio: c.meta.bio,
            followers: c.meta.followers,
            verified: c.meta.verified,
            score: c.score,
          }));
        const fallbackCandidates = topCandidates.length > 0
          ? topCandidates
          : handleCandidates.slice(0, 3).map((handle, index) => ({
              handle,
              fullName: null,
              bio: null,
              followers: null,
              verified: false,
              score: Math.max(1, 3 - index),
            }));
        const unresolvedScoring = this.scoreCompetitorFit({
          handle: '',
          profileUrl: '',
          title: company.name,
          fullName: company.name,
          bio: `${company.snippets.join(' ')} ${company.titles.join(' ')}`.trim(),
          profileWebsite: company.website ?? null,
          hasPublicEmail: false,
          followers: company.preferredFollowers ?? null,
          following: null,
          posts: null,
          verified: false,
          category: company.preferredCategory ?? null,
          profileImage: null,
          loginWall: false,
          exists: false,
          usedSession: this.instagramPlaywrightService.hasSavedSession(),
        }, company, categoryContext);

        resolved.push({
          companyName: company.name,
          canonicalName: this.normalizeCompanyName(company.name),
          officialInstagramHandle: null,
          instagramProfileUrl: null,
          confidence: 0,
          confidenceLabel: 'low',
          officialSignals: ['no confident instagram match found'],
          whyItMatched: ['No Instagram profile clearly showed the competitor’s official website or met official-brand criteria.'],
          website: company.website,
          scoring: unresolvedScoring,
          candidates: fallbackCandidates,
        });
        continue;
      }

      const scoring = this.scoreCompetitorFit(best.meta, company, categoryContext);
      const totalConfidence = this.round(Math.min(1, (best.score + scoring.total) / 26));

      if (!this.isAcceptedCompetitor(best.signals, best.score, totalConfidence, company.source === 'document')) {
        const topCandidates = evaluated
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(c => ({
            handle: c.handle,
            fullName: c.meta.fullName,
            bio: c.meta.bio,
            followers: c.meta.followers,
            verified: c.meta.verified,
            score: c.score,
          }));

        resolved.push({
          companyName: company.name,
          canonicalName: this.normalizeCompanyName(company.name),
          officialInstagramHandle: null,
          instagramProfileUrl: null,
          confidence: totalConfidence,
          confidenceLabel: 'low',
          officialSignals: ['instagram candidate rejected by official-account checks'],
          whyItMatched: ['Instagram candidates were found but were too weak to accept confidently without user feedback.'],
          website: company.website,
          scoring,
          instagramProfile: {
            fullName: best.meta.fullName,
            bio: best.meta.bio,
            category: best.meta.category,
            followers: best.meta.followers,
            verified: best.meta.verified,
            posts: best.meta.posts,
          },
          candidates: topCandidates.length > 0 ? topCandidates : undefined,
        });
        continue;
      }
      resolved.push({
        companyName: company.name,
        canonicalName: this.normalizeCompanyName(company.name),
        officialInstagramHandle: best.meta.handle,
        instagramProfileUrl: best.meta.profileUrl,
        confidence: totalConfidence,
        confidenceLabel: totalConfidence >= 0.75 ? 'high' : totalConfidence >= 0.55 ? 'medium' : 'low',
        officialSignals: best.signals,
        whyItMatched: this.buildWhyItMatched(best.meta, company, scoring),
        website: company.website,
        scoring,
        instagramProfile: {
          fullName: best.meta.fullName,
          bio: best.meta.bio,
          category: best.meta.category,
          followers: best.meta.followers,
          verified: best.meta.verified,
          posts: best.meta.posts,
        },
      });
      seen.add(best.meta.handle.toLowerCase());
    }

    return resolved.sort((a, b) => b.scoring.total - a.scoring.total).slice(0, limit);
  }

  private isAcceptedCompetitor(signals: string[], rawScore: number, confidence: number, fromKnownList: boolean) {
    const hasWebsiteProof = signals.some((signal) => /linked from official website|profile website matches brand domain|brand domain visible in bio/i.test(signal));
    const hasEmailProof = signals.some((signal) => /public contact email is present/i.test(signal));
    const hasNameProof = signals.some((signal) => /exact username match|username contains brand name|profile full name matches brand/i.test(signal));
    const hasDomainStrength = signals.some((signal) => /profile website matches brand domain|brand domain visible in bio|linked from official website/i.test(signal));
    const hasReasonableNameStrength = signals.some((signal) => /username contains brand name|profile full name matches brand|exact username match/i.test(signal));
    const onlyWeakNameMatch = signals.length === 1 && /exact username match/i.test(signals[0]);

    if (onlyWeakNameMatch) return false;
    if (hasWebsiteProof) return confidence >= 0.58;
    if (hasEmailProof && hasNameProof) return confidence >= 0.62;
    if (fromKnownList && hasDomainStrength && hasReasonableNameStrength && rawScore >= 10) return confidence >= 0.45;
    if (fromKnownList && hasNameProof && rawScore >= 12) return confidence >= 0.52;
    if (fromKnownList && rawScore >= 16 && hasReasonableNameStrength) return confidence >= 0.42;
    return false;
  }

  private companyNameToHandleCandidates(companyName: string, website?: string) {
    const normalized = this.normalizeCompanyName(companyName).toLowerCase();
    const joined = normalized.replace(/[^a-z0-9]+/g, '');
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const first = tokens[0] ?? joined;
    const last = tokens[tokens.length - 1] ?? '';
    const websiteToken = (website ? this.domainRoot(website) : '')
      .replace(/\.(com|in|co|io|net)$/i, '')
      .replace(/[^a-z0-9]+/gi, '')
      .toLowerCase();

    return Array.from(
      new Set([
        joined,
        `${first}${last}`,
        `${first}india`,
        `${joined}india`,
        `${joined}official`,
        `${first}official`,
        `get${first}`,
        `join${first}`,
        websiteToken,
      ]),
    ).filter((item) => item.length >= 3);
  }

  private rankHandleCandidates(candidates: string[], companyName: string, website?: string) {
    const joined = this.brandHandleName(companyName);
    const firstToken = this.normalizeCompanyName(companyName).toLowerCase().split(/\s+/).filter(Boolean)[0] ?? joined;
    const websiteRoot = website ? this.domainRoot(website).replace(/\.(com|in|co|io|net)$/i, '') : '';

    return candidates
      .map((candidate) => {
        let score = 0;
        const normalizedCandidate = candidate.toLowerCase();
        if (normalizedCandidate === joined) score += 30;
        else if (normalizedCandidate.includes(joined)) score += 20;
        if (joined.includes(normalizedCandidate)) score += 6;
        if (firstToken && normalizedCandidate.includes(firstToken)) score += 8;
        if (websiteRoot && normalizedCandidate.includes(websiteRoot.toLowerCase())) score += 16;
        if (/official|india/.test(normalizedCandidate)) score += 4;
        return { candidate, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((item) => item.candidate);
  }

  private scoreCompetitorFit(
    meta: Awaited<ReturnType<InstagramPlaywrightService['scrapeProfileMeta']>>,
    company: CompanyCandidate,
    categoryContext: CategoryContext,
  ) {
    const text = `${meta.fullName ?? ''} ${meta.bio ?? ''} ${company.snippets.join(' ')} ${company.titles.join(' ')}`.toLowerCase();
    
    // Strict 4P Ranking Parameters
    const productSimilarity = this.scoreByKeywords(text, categoryContext.profile.productKeywords, 10); // Product
    const targetMarketFit = this.scoreByKeywords(text, categoryContext.profile.targetMarketKeywords, 8); // Place (Target)
    const aspFit = this.scoreByKeywords(text, categoryContext.profile.aspKeywords, 8);               // Price
    const placeFit = this.scoreByKeywords(text, categoryContext.profile.placeKeywords, 7);           // Place
    const promotionFit = this.scoreByKeywords(text, categoryContext.profile.promotionKeywords, 6);   // Promotion
    
    let total = productSimilarity + targetMarketFit + aspFit + placeFit + promotionFit;

    // Founder/Personal Account Penalty (Ensuring only Business Brands stay in top 4)
    if (/(founder|ceo|owner|entrepreneur|co-founder|founder of|hails from)/i.test(text)) {
      total -= 20;
    }

    // Reward web signals (if multiple sources confirmed it)
    total += Math.min(5, Math.floor(company.score / 4));

    return { productSimilarity, targetMarketFit, aspFit, placeFit, promotionFit, total };
  }

  private async resolveConfirmedCompetitors(confirmed: Array<{ companyName: string; handle: string }>, targetHandle: string): Promise<DiscoveryCompetitor[]> {
    const resolved: DiscoveryCompetitor[] = [];
    const categoryContext = { profile: { label: 'confirmed', id: 'confirmed' } } as any;
    for (const item of confirmed) {
      try {
        const handle = (item.handle || '').replace('@', '').trim();
        console.log(`[DiscoveryAgent] Resolving confirmed competitor: ${item.companyName} (@${handle})`);
        
        const meta = await this.instagramPlaywrightService.scrapeProfileMeta(handle, true).catch((err) => {
          console.error(`[DiscoveryAgent] Failed to scrape meta for ${handle}:`, err.message);
          return null;
        });
        
        const competitor: CompanyCandidate = {
          name: item.companyName,
          instagramHandle: handle,
          snippets: [],
          titles: [],
          score: 100,
          source: 'web', // Placeholder for type compatibility
        };

        const scoring = meta ? this.scoreCompetitorFit(meta, competitor, categoryContext) : {
          productSimilarity: 20,
          targetMarketFit: 20,
          aspFit: 20,
          placeFit: 20,
          promotionFit: 20,
          total: 100,
        };

        resolved.push({
          companyName: item.companyName,
          canonicalName: this.normalizeCompanyName(item.companyName),
          officialInstagramHandle: handle,
          instagramProfileUrl: `https://www.instagram.com/${handle}/`,
          confidence: 1,
          confidenceLabel: 'high',
          officialSignals: ['user-confirmed'],
          whyItMatched: ['This competitor handle was explicitly confirmed by you.'],
          scoring,
          instagramProfile: meta ? {
            fullName: meta.fullName,
            bio: meta.bio,
            category: meta.category,
            followers: meta.followers,
            verified: meta.verified,
            posts: meta.posts,
          } : undefined,
        });
      } catch (err) {
        console.error(`[DiscoveryAgent] Critical error resolving ${item.companyName}:`, err);
      }
    }

    return resolved;
  }

  private buildWhyItMatched(meta: Awaited<ReturnType<InstagramPlaywrightService['scrapeProfileMeta']>>, company: CompanyCandidate, scoring: DiscoveryScoring) {
    const reasons: string[] = [];
    if (scoring.productSimilarity >= 3) reasons.push('Strong product/category overlap from public web + Instagram profile signals');
    if (scoring.targetMarketFit >= 3) reasons.push('Targets a similar Indian market or audience');
    if (scoring.aspFit >= 2) reasons.push('Public pricing or pack language suggests similar ASP positioning');
    if (scoring.placeFit >= 2) reasons.push('India-first market presence appears in public signals');
    if (scoring.promotionFit >= 2) reasons.push('Promotion style overlaps with the target category');
    if (!reasons.length) reasons.push('Matched from repeated public competitor mentions and official Instagram signals');
    if (meta.bio) reasons.push(`Instagram bio signal: ${meta.bio.slice(0, 120)}`);
    return reasons.slice(0, 4);
  }

  private evaluateOfficialBrandProfile(
    meta: Awaited<ReturnType<InstagramPlaywrightService['scrapeProfileMeta']>>,
    companyName: string,
    website: string | undefined,
    seedScore: number,
    websiteLinked = false,
  ): OfficialHandleAssessment {
    const normalizedName = this.normalizeCompanyName(companyName).toLowerCase();
    const joinedName = this.brandHandleName(companyName);
    const compactFullName = this.brandHandleName(meta.fullName ?? '');
    const handle = meta.handle.toLowerCase();
    const bio = (meta.bio ?? '').toLowerCase();
    const fullName = (meta.fullName ?? '').toLowerCase();
    const websiteRoot = website ? this.domainRoot(website) : '';
    const profileWebsiteRoot = meta.profileWebsite ? this.domainRoot(meta.profileWebsite) : '';
    let totalScore = 0;
    const signals: string[] = [];

    if (websiteLinked) {
      totalScore += 18;
      signals.push('linked from official website');
    }

    if (handle === joinedName) {
      totalScore += 14;
      signals.push('exact username match');
    } else if (handle.includes(joinedName)) {
      totalScore += 9;
      signals.push('username contains brand name');
    } else if (joinedName.includes(handle)) {
      totalScore += 4;
      signals.push('username is a shortened brand variant');
    } else {
      totalScore -= 2;
      signals.push('weak username match');
    }

    if (compactFullName && compactFullName.includes(joinedName)) {
      totalScore += 6;
      signals.push('profile full name matches brand');
    }

    if (/(official|brand|shop|product|store)/i.test(bio)) {
      totalScore += 3;
      signals.push('bio has official keywords');
    }

    if (/(fan|review|ratings|community|club|unofficial)/i.test(bio)) {
      totalScore -= 10;
      signals.push('bio looks like fan or review page');
    }

    if (/(entrepreneur|public figure|author|artist|personal blog|video creator|influencer|founder)/i.test(meta.category ?? '')) {
      totalScore -= 15;
      signals.push('category indicates a person/creator rather than a brand');
    }

    if (meta.category && /(company|brand|product|service|e-commerce|shopping|retail|restaurant|food)/i.test(meta.category)) {
      totalScore += 5;
      signals.push('category matches business/brand profile');
    }

    if (websiteRoot && profileWebsiteRoot && websiteRoot === profileWebsiteRoot) {
      totalScore += 12;
      signals.push('profile website matches brand domain');
    } else if (websiteRoot && meta.bio && meta.bio.toLowerCase().includes(websiteRoot.replace('.com', '').replace('.in', ''))) {
      totalScore += 8;
      signals.push('brand domain visible in bio');
    }

    if (meta.hasPublicEmail) {
      totalScore += 4;
      signals.push('public contact email is present');
    }

    if (meta.verified) {
      totalScore += 8;
      signals.push('verified account');
    }

    const followers = meta.followers ?? 0;
    if (followers >= 100000) {
      totalScore += 6;
      signals.push('strong follower base');
    } else if (followers >= 10000) {
      totalScore += 4;
      signals.push('good follower base');
    } else if (followers >= 1000) {
      totalScore += 2;
      signals.push('moderate follower base');
    } else if (followers > 0 && followers < 500) {
      totalScore -= 3;
      signals.push('very low follower base');
    }

    const posts = meta.posts ?? 0;
    if (posts >= 100) {
      totalScore += 4;
      signals.push('strong posting activity');
    } else if (posts >= 20) {
      totalScore += 2;
      signals.push('active posting history');
    } else if (posts > 0 && posts < 10) {
      totalScore -= 2;
      signals.push('very low posting activity');
    }

    if (!meta.verified && /(fan|community|review|club|updates)/i.test(`${handle} ${fullName}`)) {
      totalScore -= 8;
      signals.push('handle looks unofficial');
    }

    if (/official/.test(handle) && !handle.includes(joinedName)) {
      totalScore -= 6;
      signals.push('generic official-style handle without brand match');
    }

    if (meta.loginWall && followers === 0 && posts === 0 && !profileWebsiteRoot) {
      totalScore -= 6;
      signals.push('login-wall-only profile with weak visible signals');
    }

    totalScore += Math.min(3, Math.floor(seedScore / 6));
    return { totalScore, signals };
  }

  private scoreCompanyCandidate(name: string, result: SearchResult, targetBio: string, categoryContext: CategoryContext) {
    const text = `${result.title} ${result.snippet}`.toLowerCase();
    let score = 0;
    if (/competitor|alternative|vs|similar/.test(text)) score += 4;
    if (/india|indian/.test(text)) score += 2;
    if (this.extractKeywords(targetBio).some((token) => text.includes(token))) score += 2;
    if (/pricing|price|plans|premium|affordable/.test(text)) score += 2;
    score += this.scoreByKeywords(text, categoryContext.profile.targetMarketKeywords, 2);
    score += this.scoreByKeywords(text, categoryContext.profile.productKeywords, 3);
    if (name.split(' ').length <= 4) score += 1;
    return score;
  }

  private async searchWeb(query: string) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // Increased timeout to 15s
      const response = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return [];
      const html = await response.text();
      const $ = cheerio.load(html);
      const results: SearchResult[] = [];

      $('.result').each((_, element) => {
        const title = $(element).find('.result__title').text().trim() || $(element).find('.result__a').text().trim();
        const snippet = $(element).find('.result__snippet').text().trim();
        const href = $(element).find('.result__a').attr('href') ?? '';
        const url = this.decodeDuckDuckGoUrl(href);
        if (title && url) results.push({ title, snippet, url });
      });

      return results.slice(0, 10);
    } catch (error) {
      console.error(`Search request failed for query "${query}":`, error);
      return [];
    }
  }

  private async searchInstagramHandles(query: string) {
    const results = await this.searchWeb(query);
    const handles = new Set<string>();
    for (const result of results) {
      const match = result.url.match(/instagram\.com\/([A-Za-z0-9._]+)\/?/i);
      const handle = match?.[1];
      if (handle && !this.isLikelyGenericPath(handle)) handles.add(handle);
    }
    return Array.from(handles);
  }

  private async fetchInstagramHandlesFromWebsite(website: string) {
    try {
      const response = await fetch(website, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });
      if (!response.ok) return [];

      const html = await response.text();
      const $ = cheerio.load(html);
      const handles = new Set<string>();

      $('a[href*="instagram.com/"]').each((_, element) => {
        const href = $(element).attr('href') ?? '';
        const handle = href.match(/instagram\.com\/([A-Za-z0-9._]+)\/?/i)?.[1];
        if (handle && !this.isLikelyGenericPath(handle)) handles.add(handle);
      });

      for (const match of html.matchAll(/instagram\.com\/([A-Za-z0-9._]+)\/?/gi)) {
        const handle = match[1];
        if (handle && !this.isLikelyGenericPath(handle)) handles.add(handle);
      }

      return Array.from(handles);
    } catch (error) {
      console.error(`Website fetch failed for "${website}":`, error);
      return [];
    }
  }

  private findDocumentBrand(companyName: string, handle: string) {
    const brands = this.loadBrandDocuments();
    const canonicalCompany = this.normalizeCompanyName(companyName).toLowerCase();
    const normalizedHandle = handle.replace('@', '').trim().toLowerCase();
    return brands.find((brand) =>
      brand.canonicalBrand === canonicalCompany
      || (brand.instagramHandle ? brand.instagramHandle.toLowerCase() === normalizedHandle : false),
    ) ?? null;
  }

  private findBrandInExcel(companyName: string, handle: string) {
    const brands = this.loadBrandsFromExcel();
    const canonicalCompany = this.normalizeCompanyName(companyName).toLowerCase();
    const normalizedHandle = handle.replace('@', '').trim().toLowerCase();
    return brands.find((brand) =>
      brand.canonicalBrand === canonicalCompany
      || (brand.instagramHandle ? brand.instagramHandle.toLowerCase() === normalizedHandle : false),
    ) ?? null;
  }

  private getCsvCompetitors(target: CsvBrandRecord, companyName: string, limit: number): CompanyCandidate[] {
    const brands = this.loadBrandsFromExcel();
    const sameDomain = brands
      .filter((record) => record.domain === target.domain && record.canonicalBrand !== target.canonicalBrand)
      .map((record) => {
        const propositionScore = this.scoreCsvPropositionFit(target.proposition, record.proposition);
        return {
          name: this.normalizeCompanyName(record.brand),
          instagramHandle: record.instagramHandle,
          snippets: [record.proposition, record.domain],
          titles: [`${record.domain} ${record.brand}`],
          score: 20 + propositionScore,
          preferredCategory: record.domain,
          preferredPositioning: record.proposition,
          source: 'csv' as const,
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.name.localeCompare(b.name);
      })
      .slice(0, Math.max(limit * 3, 30));

    return this.mergeCompanyCandidates(sameDomain, companyName).slice(0, limit);
  }

  private getCompetitorsByDomain(domainLabel: string, companyName: string, limit: number): CompanyCandidate[] {
    const brands = this.loadBrandsFromExcel();
    const normalizedDomain = domainLabel.toLowerCase();
    
    // Map inferred label to CSV domain keywords
    // We split by / and space to get broader keywords
    const searchTerms = domainLabel.toLowerCase()
      .split(/[\/\s,]+/)
      .filter(t => t.length > 3 && !['brand', 'business', 'lifestyle', 'products', 'india'].includes(t));

    const matches = brands
      .filter((record) => {
        const d = (record.domain || '').toLowerCase();
        // Match if domain contains any of the label keywords
        return searchTerms.some(term => d.includes(term)) || d.includes(normalizedDomain) || normalizedDomain.includes(d);
      })
      .map((record) => {
        return {
          name: this.normalizeCompanyName(record.brand),
          instagramHandle: record.instagramHandle,
          snippets: [record.proposition, record.domain],
          titles: [`${record.domain} ${record.brand}`],
          score: 15, 
          preferredCategory: record.domain,
          preferredPositioning: record.proposition,
          source: 'csv' as const,
        };
      });

    return matches;
  }

  private scoreCsvPropositionFit(targetProposition: string, candidateProposition: string) {
    const targetTokens = new Set(this.extractKeywords(targetProposition));
    const candidateTokens = this.extractKeywords(candidateProposition);
    let overlap = 0;
    for (const token of candidateTokens) {
      if (targetTokens.has(token)) overlap += 1;
    }
    return overlap;
  }

  private getDocumentCompetitors(
    target: BrandDocumentRecord,
    companyName: string,
    limit: number,
    targetFollowers: number | null,
  ): CompanyCandidate[] {
    const brands = this.loadBrandDocuments();
    const sameCategory = brands
      .filter((record) => record.category === target.category && record.canonicalBrand !== target.canonicalBrand)
      .map((record) => {
        const positioningScore = this.scoreDocumentPositioningFit(target, record);
        const followerScore = this.scoreDocumentFollowerFit(targetFollowers, record.followers);
        return {
          name: this.normalizeCompanyName(record.brand),
          snippets: [record.positioning, record.category],
          titles: [`${record.category} ${record.brand}`],
          score: 16 + positioningScore + followerScore,
          preferredFollowers: record.followers,
          preferredCategory: record.category,
          preferredPositioning: record.positioning,
          source: 'document' as const,
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.preferredFollowers ?? 0) - (a.preferredFollowers ?? 0);
      })
      .slice(0, Math.max(limit * 2, 24));

    return this.mergeCompanyCandidates(sameCategory, companyName).slice(0, limit);
  }

  private scoreDocumentPositioningFit(target: BrandDocumentRecord, candidate: BrandDocumentRecord) {
    const targetTokens = new Set(this.extractKeywords(`${target.category} ${target.positioning}`));
    const candidateTokens = this.extractKeywords(`${candidate.category} ${candidate.positioning}`);
    let overlap = 0;
    for (const token of candidateTokens) {
      if (targetTokens.has(token)) overlap += 1;
    }
    return overlap;
  }

  private scoreDocumentFollowerFit(targetFollowers: number | null, candidateFollowers: number | null) {
    if (!targetFollowers || !candidateFollowers) return 0;
    const larger = Math.max(targetFollowers, candidateFollowers);
    const smaller = Math.min(targetFollowers, candidateFollowers);
    const ratio = smaller / larger;
    if (ratio >= 0.8) return 6;
    if (ratio >= 0.6) return 4;
    if (ratio >= 0.4) return 2;
    return 0;
  }

  private loadBrandsFromExcel() {
    if (this.brandsCache) return this.brandsCache;

    const records: CsvBrandRecord[] = [];
    for (const filePath of this.csvPathCandidates) {
      if (!existsSync(filePath)) continue;
      try {
        const content = readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/).filter((line) => line.trim());
        if (lines.length < 2) continue;

        const header = this.parseCsvRow(lines[0]);
        const companyIndex = header.findIndex((cell) => /^company$/i.test(cell));
        const directHandleIndex = header.findIndex((cell) => /^id$/i.test(cell));
        const computedHandleIndex = header.findIndex((cell) => /username - computed/i.test(cell));
        const handleIndex = directHandleIndex !== -1 ? directHandleIndex : computedHandleIndex;
        const directDomainIndex = header.findIndex((cell) => /^domain$/i.test(cell));
        const categoryDomainIndex = header.findIndex((cell) => /^category$/i.test(cell));
        const domainIndex = directDomainIndex !== -1 ? directDomainIndex : categoryDomainIndex;
        const propositionIndex = header.findIndex((cell) => /^proposition$/i.test(cell));

        if (companyIndex === -1 || handleIndex === -1 || domainIndex === -1) continue;

        for (const line of lines.slice(1)) {
          const cells = this.parseCsvRow(line);
          const brand = (cells[companyIndex] ?? '').trim();
          const instagramHandle = (cells[handleIndex] ?? '').trim().replace(/^@/, '') || null;
          const domain = (cells[domainIndex] ?? '').trim();
          const proposition = (cells[propositionIndex] ?? '').trim();
          if (!brand || !domain) continue;
          records.push({
            brand,
            canonicalBrand: this.normalizeCompanyName(brand).toLowerCase(),
            instagramHandle,
            domain,
            proposition,
          });
        }
      } catch (error) {
        console.error(`Failed to load brand CSV at ${filePath}:`, error);
      }
    }

    this.brandsCache = this.dedupeBrands(records);
    return this.brandsCache;
  }

  private parseCsvRow(row: string) {
    const cells: string[] = [];
    let current = '';
    let insideQuotes = false;
    for (let index = 0; index < row.length; index += 1) {
      const character = row[index];
      if (character === '"') {
        if (insideQuotes && row[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
        continue;
      }
      if (character === ',' && !insideQuotes) {
        cells.push(current.trim());
        current = '';
        continue;
      }
      current += character;
    }
    cells.push(current.trim());
    return cells;
  }

  private dedupeBrands(records: CsvBrandRecord[]) {
    const merged = new Map<string, CsvBrandRecord>();
    for (const record of records) {
      const key = record.canonicalBrand;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, record);
        continue;
      }
      merged.set(key, {
        ...existing,
        instagramHandle: existing.instagramHandle ?? record.instagramHandle,
        domain: existing.domain || record.domain,
        proposition: existing.proposition.length >= record.proposition.length ? existing.proposition : record.proposition,
      });
    }
    return Array.from(merged.values());
  }

  private loadBrandDocuments() {
    if (this.documentBrandCache) return this.documentBrandCache;

    const records: BrandDocumentRecord[] = [];
    for (const filePath of this.documentPaths) {
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, 'utf8');
      const source = filePath.includes('D2C_Brand_Bible') ? 'd2c-bible' as const : 'non-d2c' as const;
      records.push(...this.parseBrandDocument(content, source));
    }

    this.documentBrandCache = records;
    return records;
  }

  private parseBrandDocument(content: string, source: 'd2c-bible' | 'non-d2c') {
    const records: BrandDocumentRecord[] = [];
    const sections = content.split(/^##\s+/m).slice(1);

    for (const section of sections) {
      const lines = section.split(/\r?\n/);
      const headingLine = lines[0] ?? '';
      const category = this.cleanMarkdownHeading(headingLine);
      const tableLines = lines.filter((line) => line.trim().startsWith('|'));
      if (tableLines.length < 3) continue;

      const header = tableLines[0].split('|').map((item) => item.trim());
      const brandIndex = header.findIndex((item) => /brand|company/i.test(item));
      const handleIndex = header.findIndex((item) => /instagram handle/i.test(item));
      const followerIndex = header.findIndex((item) => /followers/i.test(item));
      const positioningIndex = header.findIndex((item) => /key positioning|what they do/i.test(item));
      const categoryIndex = header.findIndex((item) => /^category$/i.test(item));

      if (brandIndex === -1 || handleIndex === -1) continue;

      for (const rawLine of tableLines.slice(2)) {
        const cells = rawLine.split('|').map((item) => item.trim());
        const brand = this.cleanMarkdownCell(cells[brandIndex] ?? '');
        if (!brand || /already covered|summary table/i.test(brand)) continue;
        const handle = this.extractHandleFromCell(cells[handleIndex] ?? '');
        const followers = this.parseCompactNumberFromText(cells[followerIndex] ?? '');
        const positioning = this.cleanMarkdownCell(cells[positioningIndex] ?? '');
        const rowCategory = this.cleanMarkdownCell(cells[categoryIndex] ?? '') || category;
        records.push({
          brand,
          canonicalBrand: this.normalizeCompanyName(brand).toLowerCase(),
          instagramHandle: handle,
          followers,
          category: rowCategory,
          positioning,
          source,
          verifiedHint: /✅/.test(cells[handleIndex] ?? ''),
        });
      }
    }

    return records;
  }

  private cleanMarkdownHeading(input: string) {
    return input
      .replace(/^\d+\.\s*/, '')
      .replace(/[^\w/&,+ .-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private cleanMarkdownCell(input: string) {
    return input
      .replace(/\*\*/g, '')
      .replace(/✅|🔍|❌|🆕/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractHandleFromCell(input: string) {
    const match = input.match(/@([A-Za-z0-9._]+)/);
    return match?.[1] ?? null;
  }

  private parseCompactNumberFromText(input: string) {
    const normalized = this.cleanMarkdownCell(input).replace(/approx|global|~|\(.*?\)/gi, '').trim();
    const match = normalized.match(/([\d.,]+)\s*([KML])?/i);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ''));
    if (Number.isNaN(value)) return null;
    const suffix = (match[2] ?? '').toUpperCase();
    if (suffix === 'K') return value * 1_000;
    if (suffix === 'M') return value * 1_000_000;
    if (suffix === 'L') return value * 100_000;
    return value;
  }

  private async resolveCompanyWebsite(company: CompanyCandidate) {
    if (company.website) return company.website;
    const results = await this.searchWeb(`"${company.name}" official website india`).catch(() => [] as SearchResult[]);
    const ranked = results
      .filter((result) => !/instagram\.com|facebook\.com|linkedin\.com|youtube\.com|amazon\.|flipkart\.|blinkit\.|zepto\.|swiggy\.|zomato\./i.test(result.url))
      .map((result) => ({
        result,
        score: this.scoreWebsiteCandidate(result.url, company.name),
      }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0]?.result;
    return best ? `https://${this.extractDomain(best.url)}` : undefined;
  }

  private extractCompanyPhrases(input: string) {
    const matches = input.match(/([A-Z][A-Za-z0-9&.+-]*(?:\s+[A-Z][A-Za-z0-9&.+-]*){0,3})/g) ?? [];
    return Array.from(new Set(matches.map((item) => item.trim()).filter((item) => item.length > 2)));
  }

  private scoreWebsiteCandidate(url: string, companyName: string) {
    const domain = this.extractDomain(url);
    const handleName = this.brandHandleName(companyName);
    let score = 0;
    if (!domain) return score;
    const root = this.domainRoot(domain);
    if (root === handleName) score += 12;
    if (root.includes(handleName) || handleName.includes(root)) score += 8;
    const tokens = this.normalizeCompanyName(companyName).toLowerCase().split(' ').filter(Boolean);
    score += tokens.filter((token) => root.includes(token)).length * 2;
    if (/www\./i.test(url)) score += 1;
    return score;
  }

  private normalizeCompanyName(input: string) {
    return input
      .replace(/\b(official|instagram|india|private limited|pvt ltd|ltd|inc|llp|company|co)\b/gi, ' ')
      .replace(/[^A-Za-z0-9&+ .-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private brandHandleName(input: string) {
    return this.normalizeCompanyName(input)
      .toLowerCase()
      .replace(/\b(the|india|official|co|brand|foods)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, '');
  }

  private hasStrongOfficialSignal(
    meta: Awaited<ReturnType<InstagramPlaywrightService['scrapeProfileMeta']>>,
    companyName: string,
    website?: string,
  ) {
    const joinedName = this.brandHandleName(companyName);
    const compactFullName = this.brandHandleName(meta.fullName ?? '');
    const handle = meta.handle.toLowerCase();
    const websiteRoot = website ? this.domainRoot(website) : '';
    const profileWebsiteRoot = meta.profileWebsite ? this.domainRoot(meta.profileWebsite) : '';

    if (handle === joinedName || handle.includes(joinedName)) return true;
    if (compactFullName && compactFullName.includes(joinedName)) return true;
    if (websiteRoot && profileWebsiteRoot && websiteRoot === profileWebsiteRoot) return true;
    if (meta.hasPublicEmail && (handle.includes(joinedName) || compactFullName.includes(joinedName))) return true;
    if (meta.verified && (handle.includes(joinedName) || compactFullName.includes(joinedName))) return true;
    return false;
  }

  private profileWebsiteMatchesCompanyWebsite(profileWebsite: string | null, companyWebsite?: string) {
    if (!profileWebsite || !companyWebsite) return false;
    return this.domainRoot(profileWebsite) === this.domainRoot(companyWebsite);
  }

  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getCategoryProfiles(): CategoryProfile[] {
    return [
      {
        id: 'insurance-benefits',
        label: 'insurance / employee benefits',
        keywords: ['insurance', 'benefits', 'policy', 'claims', 'group health', 'employee health', 'broker', 'coverage'],
        productKeywords: ['insurance', 'benefits', 'policy', 'claims', 'coverage', 'group health'],
        targetMarketKeywords: ['hr', 'employee', 'startup', 'company', 'business', 'team'],
        aspKeywords: ['premium', 'plans', 'pricing', 'affordable', 'renewal'],
        placeKeywords: ['india', 'indian', 'bangalore', 'mumbai', 'delhi', 'gurgaon', 'pune'],
        promotionKeywords: ['demo', 'book', 'consult', 'call', 'apply'],
        seeds: [
          { name: 'Onsurity', website: 'https://www.onsurity.com', score: 16, reason: 'insurance and employee benefits India' },
          { name: 'Nova Benefits', website: 'https://www.novabenefits.com', score: 16, reason: 'employee benefits platform India' },
          { name: 'Loop Health', website: 'https://www.loophealth.com', score: 15, reason: 'group health insurance India' },
          { name: 'Ditto Insurance', website: 'https://joinditto.in', score: 14, reason: 'insurance advisory India' },
          { name: 'ACKO', website: 'https://www.acko.com', score: 13, reason: 'digital insurance India' },
          { name: 'Pazcare', website: 'https://www.pazcare.com', score: 14, reason: 'employee benefits and insurance India' },
          { name: 'CoverSure', website: 'https://www.coversure.in', score: 11, reason: 'employee insurance administration India' },
          { name: 'Policybazaar for Business', website: 'https://www.policybazaar.com', score: 10, reason: 'business insurance India' },
          { name: 'Care Health Insurance', website: 'https://www.careinsurance.com', score: 9, reason: 'health insurance India' },
        ],
      },
      {
        id: 'fresh-meat-seafood',
        label: 'fresh meat / seafood / D2C food',
        keywords: ['meat', 'seafood', 'chicken', 'fish', 'mutton', 'fresh', 'delivery', 'raw', 'cuts', 'marinated', 'cold chain'],
        productKeywords: ['meat', 'seafood', 'chicken', 'fish', 'mutton', 'fresh', 'raw', 'cuts', 'marinated', 'cold chain'],
        targetMarketKeywords: ['consumer', 'household', 'kitchen', 'cooking', 'freshness'],
        aspKeywords: ['premium', 'price', 'affordable', 'pack'],
        placeKeywords: ['india', 'online', 'bangalore', 'mumbai', 'delhi', 'delivery'],
        promotionKeywords: ['shop', 'order', 'buy', 'freshly cut', 'delivery'],
        seeds: [
          { name: 'FreshToHome', website: 'https://www.freshtohome.com', score: 16, reason: 'fresh meat and seafood India' },
          { name: 'Tendercut', website: 'https://www.tendercut.in', score: 15, reason: 'meat delivery India' },
          { name: 'Meatigo', website: 'https://www.meatigo.com', score: 14, reason: 'premium meat delivery India' },
          { name: 'Zappfresh', website: 'https://www.zappfresh.com', score: 14, reason: 'fresh meat online India' },
          { name: 'Meatwale', website: 'https://www.meatwale.com', score: 12, reason: 'meat shop chain India' },
          { name: 'Goodness Me', website: 'https://goodnessme.in', score: 11, reason: 'D2C food India' },
        ],
      },
      {
        id: 'healthy-snacks-nutrition',
        label: 'healthy snacks / nutrition',
        keywords: ['protein', 'snack', 'nutrition', 'muesli', 'granola', 'healthy food', 'bars', 'clean label', 'whey'],
        productKeywords: ['protein', 'snack', 'nutrition', 'bars', 'healthy', 'whey', 'muesli', 'granola'],
        targetMarketKeywords: ['fitness', 'wellness', 'consumer', 'health', 'family', 'kids'],
        aspKeywords: ['pack', 'combo', 'premium', 'affordable', 'price'],
        placeKeywords: ['india', 'indian', 'online', 'retail', 'quick commerce'],
        promotionKeywords: ['shop', 'order', 'buy', 'link in bio', 'try'],
        seeds: [
          { name: 'Yoga Bar', website: 'https://www.yogabar.in', score: 16, reason: 'healthy snacks and protein bars India' },
          { name: 'RiteBite', website: 'https://www.ritebite.co.in', score: 15, reason: 'protein and healthy snacking India' },
          { name: 'The Healthy Binge', website: 'https://thehealthybinge.com', score: 14, reason: 'clean-label snacking India' },
          { name: 'SuperYou', website: 'https://www.superyou.in', score: 13, reason: 'protein snacks India' },
          { name: 'Slurrp Farm', website: 'https://slurrpfarm.com', score: 11, reason: 'better-for-you packaged food India' },
          { name: 'Open Secret', website: 'https://www.opensecret.in', score: 13, reason: 'clean snack brand India' },
          { name: 'Phab', website: 'https://www.eatphab.com', score: 12, reason: 'functional snacks India' },
          { name: 'Snackible', website: 'https://www.snackible.com', score: 11, reason: 'healthy snacking India' },
          { name: 'Wellbeing Nutrition', website: 'https://wellbeingnutrition.com', score: 10, reason: 'wellness nutrition India' },
          { name: 'Eat Better', website: 'https://www.eatbetterco.com', score: 10, reason: 'healthy snacks India' },
        ],
      },
      {
        id: 'beauty-skincare',
        label: 'beauty / skincare',
        keywords: ['skincare', 'beauty', 'makeup', 'serum', 'face', 'skin', 'cosmetic', 'haircare'],
        productKeywords: ['skincare', 'beauty', 'makeup', 'serum', 'skin', 'haircare'],
        targetMarketKeywords: ['women', 'consumer', 'beauty', 'self-care', 'wellness'],
        aspKeywords: ['premium', 'luxury', 'affordable', 'price', 'range'],
        placeKeywords: ['india', 'online', 'retail', 'nykaa', 'marketplace'],
        promotionKeywords: ['shop', 'buy', 'launch', 'drops', 'offers'],
        seeds: [
          { name: 'Mamaearth', website: 'https://mamaearth.in', score: 14, reason: 'mass beauty and personal care India' },
          { name: 'Minimalist', website: 'https://beminimalist.co', score: 16, reason: 'ingredient-led skincare India' },
          { name: 'The Derma Co.', website: 'https://thedermaco.com', score: 15, reason: 'science-backed skincare India' },
          { name: 'Aqualogica', website: 'https://aqualogica.in', score: 12, reason: 'hydration skincare India' },
          { name: 'Dot & Key', website: 'https://dotandkey.com', score: 13, reason: 'consumer skincare India' },
        ],
      },
      {
        id: 'fintech-payments',
        label: 'fintech / payments',
        keywords: ['payments', 'upi', 'banking', 'credit card', 'loan', 'finance', 'wallet', 'money'],
        productKeywords: ['payments', 'upi', 'banking', 'finance', 'credit', 'loan', 'wallet'],
        targetMarketKeywords: ['consumer', 'merchant', 'business', 'startup', 'smb'],
        aspKeywords: ['fees', 'pricing', 'charges', 'interest', 'cashback'],
        placeKeywords: ['india', 'merchant', 'online', 'offline', 'retail'],
        promotionKeywords: ['download', 'sign up', 'pay', 'get started', 'apply'],
        seeds: [
          { name: 'PhonePe', website: 'https://www.phonepe.com', score: 16, reason: 'consumer payments India' },
          { name: 'Paytm', website: 'https://paytm.com', score: 16, reason: 'payments and financial services India' },
          { name: 'CRED', website: 'https://cred.club', score: 14, reason: 'consumer fintech India' },
          { name: 'MobiKwik', website: 'https://www.mobikwik.com', score: 13, reason: 'wallet and payments India' },
          { name: 'BharatPe', website: 'https://bharatpe.com', score: 12, reason: 'merchant payments India' },
        ],
      },
      {
        id: 'hr-saas',
        label: 'HR SaaS / workforce software',
        keywords: ['hrms', 'payroll', 'attendance', 'hiring', 'people ops', 'hr software', 'workforce'],
        productKeywords: ['hrms', 'payroll', 'attendance', 'hiring', 'hr software', 'people'],
        targetMarketKeywords: ['hr', 'startup', 'company', 'business', 'employees'],
        aspKeywords: ['pricing', 'subscription', 'plans', 'enterprise', 'smb'],
        placeKeywords: ['india', 'startup', 'smb', 'enterprise'],
        promotionKeywords: ['book demo', 'schedule demo', 'try', 'get started'],
        seeds: [
          { name: 'Keka', website: 'https://www.keka.com', score: 16, reason: 'HRMS India' },
          { name: 'Darwinbox', website: 'https://darwinbox.com', score: 15, reason: 'enterprise HR tech India' },
          { name: 'greytHR', website: 'https://www.greythr.com', score: 14, reason: 'payroll and HR software India' },
          { name: 'Zoho People', website: 'https://www.zoho.com/people', score: 13, reason: 'HR software India' },
          { name: 'HROne', website: 'https://hrone.cloud', score: 12, reason: 'HRMS India' },
        ],
      },
      {
        id: 'edtech-learning',
        label: 'edtech / learning',
        keywords: ['learning', 'education', 'course', 'upskilling', 'exam prep', 'students', 'school', 'edtech'],
        productKeywords: ['learning', 'education', 'course', 'upskilling', 'exam', 'study'],
        targetMarketKeywords: ['students', 'learners', 'professionals', 'parents', 'schools'],
        aspKeywords: ['fees', 'pricing', 'subscription', 'premium', 'affordable'],
        placeKeywords: ['india', 'online', 'app'],
        promotionKeywords: ['enroll', 'join', 'download', 'sign up', 'apply'],
        seeds: [
          { name: 'Unacademy', website: 'https://unacademy.com', score: 16, reason: 'edtech India' },
          { name: 'BYJUS', website: 'https://byjus.com', score: 15, reason: 'learning app India' },
          { name: 'Physics Wallah', website: 'https://www.pw.live', score: 14, reason: 'exam prep India' },
          { name: 'upGrad', website: 'https://www.upgrad.com', score: 13, reason: 'upskilling India' },
          { name: 'Vedantu', website: 'https://www.vedantu.com', score: 12, reason: 'online tutoring India' },
        ],
      },
      {
        id: 'fitness-wellness',
        label: 'fitness / wellness',
        keywords: ['fitness', 'workout', 'gym', 'wellness', 'training', 'nutrition', 'health'],
        productKeywords: ['fitness', 'workout', 'gym', 'wellness', 'training', 'health'],
        targetMarketKeywords: ['consumer', 'members', 'athletes', 'wellness', 'beginners'],
        aspKeywords: ['membership', 'plans', 'pricing', 'premium', 'affordable'],
        placeKeywords: ['india', 'online', 'offline', 'app'],
        promotionKeywords: ['join', 'book', 'subscribe', 'start today'],
        seeds: [
          { name: 'Cult.fit', website: 'https://www.cult.fit', score: 16, reason: 'fitness and wellness India' },
          { name: 'Healthify', website: 'https://www.healthifyme.com', score: 15, reason: 'health app India' },
          { name: 'Fast&Up', website: 'https://fastandup.in', score: 12, reason: 'fitness nutrition India' },
          { name: 'MyFitness', website: 'https://myfitness.in', score: 11, reason: 'fitness nutrition India' },
        ],
      },
      {
        id: 'fashion-apparel',
        label: 'fashion / apparel',
        keywords: ['fashion', 'apparel', 'clothing', 'wear', 'streetwear', 'ethnic', 'ethnicity', 'shirts', 'dresses', 'kurta', 'saree', 'co-ords', 'inclusive', 'size inclusive'],
        productKeywords: ['fashion', 'apparel', 'clothing', 'wear', 'streetwear', 'ethnic', 'kurta', 'saree', 'co-ords'],
        targetMarketKeywords: ['women', 'men', 'consumer', 'lifestyle', 'youth', 'inclusive', 'plus size'],
        aspKeywords: ['premium', 'affordable', 'price', 'range', 'sale'],
        placeKeywords: ['india', 'online', 'retail', 'stores'],
        promotionKeywords: ['shop', 'buy now', 'drops', 'collection', 'launch'],
        seeds: [
          { name: 'Bewakoof', website: 'https://www.bewakoof.com', score: 14, reason: 'D2C apparel India' },
          { name: 'Snitch', website: 'https://www.snitch.com', score: 13, reason: 'fashion brand India' },
          { name: 'The Souled Store', website: 'https://www.thesouledstore.com', score: 15, reason: 'youth apparel India' },
          { name: 'Libas', website: 'https://www.libas.in', score: 11, reason: 'fashion brand India' },
          { name: 'Berrylush', website: 'https://www.berrylush.com', score: 10, reason: 'fashion D2C India' },
          { name: 'Aachho', website: 'https://www.aachho.com', score: 13, reason: 'ethnic fashion India' },
          { name: 'House of Chikankari', website: 'https://www.houseofchikankari.in', score: 13, reason: 'women ethnic wear India' },
          { name: 'Indo Era', website: 'https://www.indoera.com', score: 12, reason: 'ethnic apparel India' },
          { name: 'Taneira', website: 'https://www.taneira.com', score: 11, reason: 'ethnic and saree fashion India' },
        ],
      },
      {
        id: 'airlines-aviation',
        label: 'airlines / aviation',
        keywords: ['airline', 'airlines', 'flight', 'flights', 'aviation', 'airport', 'boarding', 'jet', 'airways'],
        productKeywords: ['airline', 'flight', 'aviation', 'airways', 'air travel'],
        targetMarketKeywords: ['travellers', 'passengers', 'business', 'leisure', 'domestic', 'international'],
        aspKeywords: ['fare', 'ticket', 'price', 'premium', 'budget', 'booking'],
        placeKeywords: ['india', 'airport', 'domestic', 'international', 'routes'],
        promotionKeywords: ['book now', 'fly', 'travel', 'routes', 'offers'],
        seeds: [
          { name: 'IndiGo', website: 'https://www.goindigo.in', score: 18, reason: 'largest airline India' },
          { name: 'Air India', website: 'https://www.airindia.com', score: 17, reason: 'full-service airline India' },
          { name: 'Akasa Air', website: 'https://www.akasaair.com', score: 16, reason: 'new airline India' },
          { name: 'Air India Express', website: 'https://www.airindiaexpress.com', score: 15, reason: 'low-cost airline India' },
          { name: 'Alliance Air', website: 'https://www.allianceair.in', score: 11, reason: 'regional airline India' },
        ],
      },
      {
        id: 'travel-hospitality',
        label: 'travel / hospitality',
        keywords: ['travel', 'hotel', 'stay', 'trip', 'vacation', 'booking', 'holiday', 'resort', 'airline', 'flight', 'airlines', 'aviation'],
        productKeywords: ['travel', 'hotel', 'stay', 'trip', 'vacation', 'booking', 'flight', 'airline'],
        targetMarketKeywords: ['travellers', 'families', 'tourists', 'business'],
        aspKeywords: ['price', 'premium', 'budget', 'booking', 'fare', 'ticket'],
        placeKeywords: ['india', 'destinations', 'cities', 'resort', 'airport'],
        promotionKeywords: ['book now', 'plan', 'travel', 'stay', 'fly'],
        seeds: [
          { name: 'MakeMyTrip', website: 'https://www.makemytrip.com', score: 16, reason: 'travel booking India' },
          { name: 'Goibibo', website: 'https://www.goibibo.com', score: 14, reason: 'travel booking India' },
          { name: 'Yatra', website: 'https://www.yatra.com', score: 12, reason: 'travel platform India' },
          { name: 'EaseMyTrip', website: 'https://www.easemytrip.com', score: 13, reason: 'travel India' },
        ],
      },
    ];
  }

  private extractKeywords(input: string) {
    const stop = new Set(['instagram', 'official', 'follow', 'followers', 'following', 'posts', 'their', 'there', 'from', 'into', 'that', 'company', 'about', 'with']);
    return input.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((token) => token.length > 3 && !stop.has(token)).slice(0, 16);
  }

  private scoreByKeywords(text: string, keywords: string[], max: number) {
    const hits = keywords.filter((keyword) => text.includes(keyword)).length;
    return Math.min(max, hits);
  }

  private extractDomain(url: string) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return undefined;
    }
  }

  private domainRoot(url: string) {
    const domain = this.extractDomain(url) ?? '';
    const parts = domain.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : domain;
  }

  private decodeDuckDuckGoUrl(href: string) {
    const match = href.match(/[?&]uddg=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : href;
  }

  private isLikelyGenericPath(handle: string) {
    return ['p', 'reel', 'explore', 'accounts', 'stories', 'directory', 'reels'].includes(handle.toLowerCase());
  }

  private round(value: number) {
    return Number(value.toFixed(2));
  }

}
