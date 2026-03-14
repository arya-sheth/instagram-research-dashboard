import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { BrowserContext, chromium, Page } from 'playwright';

type InstagramProfileMeta = {
  handle: string;
  profileUrl: string;
  title: string;
  fullName: string | null;
  bio: string | null;
  profileWebsite: string | null;
  hasPublicEmail: boolean;
  followers: number | null;
  following: number | null;
  posts: number | null;
  verified: boolean;
  category: string | null;
  profileImage: string | null;
  loginWall: boolean;
  exists: boolean;
  usedSession: boolean;
};

type InstagramMediaItem = {
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
  url: string;
};

@Injectable()
export class InstagramPlaywrightService {
  private readonly artifactsDir = join(process.cwd(), 'artifacts');
  private readonly storageStatePath = join(this.artifactsDir, 'instagram-storage-state.json');
  private readonly profileMetaCache = new Map<string, InstagramProfileMeta>();
  private readonly profileMediaCache = new Map<string, {
    profileMeta: InstagramProfileMeta;
    mediaItems: InstagramMediaItem[];
    warnings: string[];
    usedSession: boolean;
  }>();

  constructor() {
    if (!existsSync(this.artifactsDir)) {
      mkdirSync(this.artifactsDir, { recursive: true });
    }
  }

  getStorageStatePath() {
    return this.storageStatePath;
  }

  hasSavedSession() {
    return existsSync(this.storageStatePath);
  }

  async scrapeProfileMeta(handle: string, preferSession = true): Promise<InstagramProfileMeta> {
    const normalizedHandle = handle.replace('@', '').trim();
    const cacheKey = `${normalizedHandle}:${preferSession && this.hasSavedSession() ? 'session' : 'public'}`;
    const cached = this.profileMetaCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.withPage(preferSession, async (page, usedSession) => {
      const profileUrl = `https://www.instagram.com/${normalizedHandle}/`;
      const loaded = await this.safeGoto(page, profileUrl, 'domcontentloaded');
      if (!loaded) {
        return {
          handle: normalizedHandle,
          profileUrl,
          title: `${normalizedHandle} • Instagram`,
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
          usedSession,
        };
      }

      const raw = await page.evaluate(() => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
        ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '',
        ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
        pageText: document.body.innerText ?? '',
        html: document.documentElement.innerHTML,
      }));

      const title = raw.title ?? '';
      const description = raw.description || raw.ogDescription || '';
      const loginWall = /See everyday moments from your close friends|Log into Instagram/i.test(raw.pageText || raw.html);
      const exists = title.includes(`(@${normalizedHandle})`) || description.includes(`(@${normalizedHandle})`) || !!raw.ogImage || raw.canonical.includes(`/${normalizedHandle}/`);
      const countsMatch = description.match(/([\d.,KM]+) Followers, ([\d.,KM]+) Following, ([\d.,KM]+) Posts/i);
      const bioMatch = description.match(/on Instagram: "([\s\S]*)"$/);
      const fullNameMatch = title.match(/^(.*?) \(@/);
      const websiteMatch = raw.html.match(/"external_url":"(https?:\\\/\\\/[^"]+)"/i);
      const publicEmailPresent = /"public_email":"[^"]+"/i.test(raw.html) || /email/i.test(raw.pageText);
      const categoryMatch = raw.html.match(/"category_name":"((?:\\.|[^"])*)"/i);
      const verified = /"is_verified":true/i.test(raw.html);

      return {
        handle: normalizedHandle,
        profileUrl,
        title,
        fullName: fullNameMatch?.[1]?.trim() ?? null,
        bio: this.cleanText(bioMatch?.[1] ?? ''),
        profileWebsite: this.decodeInstagramString(websiteMatch?.[1] ?? '').replace(/\\\//g, '/') || null,
        hasPublicEmail: publicEmailPresent,
        followers: this.parseCompactNumber(countsMatch?.[1]),
        following: this.parseCompactNumber(countsMatch?.[2]),
        posts: this.parseCompactNumber(countsMatch?.[3]),
        verified,
        category: this.cleanText(this.decodeInstagramString(categoryMatch?.[1] ?? '')),
        profileImage: raw.ogImage || null,
        loginWall,
        exists,
        usedSession,
      };
    });
    this.profileMetaCache.set(cacheKey, result);
    return result;
  }

  async collectProfileMedia(handle: string, limit: number) {
    const normalizedHandle = handle.replace('@', '').trim();
    const cacheKey = `${normalizedHandle}:${limit}:${this.hasSavedSession() ? 'session' : 'public'}`;
    const cached = this.profileMediaCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const profileMeta = await this.scrapeProfileMeta(handle, true);
    if (!this.hasSavedSession()) {
      const result = {
        profileMeta,
        mediaItems: [] as InstagramMediaItem[],
        warnings: ['No saved Instagram login session found. Run npm.cmd run instagram:login once to enable deep post and reel collection.'],
        usedSession: false,
      };
      this.profileMediaCache.set(cacheKey, result);
      return result;
    }

    const result = await this.withPage(true, async (page, usedSession) => {
      const warnings: string[] = [];
      const profileUrl = `https://www.instagram.com/${normalizedHandle}/`;
      const loaded = await this.safeGoto(page, profileUrl, 'domcontentloaded');
      if (!loaded) {
        warnings.push('Timed out while loading the Instagram profile feed. Returning profile-only data for this run.');
        return { profileMeta, mediaItems: [] as InstagramMediaItem[], warnings, usedSession };
      }
      await page.waitForTimeout(1500);

      const pageText = await page.locator('body').innerText().catch(() => '');
      if (/Log into Instagram|close friends/i.test(pageText)) {
        warnings.push('Saved session did not unlock the profile feed. Please refresh the Instagram session.');
        return { profileMeta, mediaItems: [] as InstagramMediaItem[], warnings, usedSession };
      }

      const postLinks = await this.collectLinksFromGrid(page, profileUrl, limit, 'post').catch(() => [] as string[]);
      const reelLinks = await this.collectLinksFromGrid(page, `${profileUrl}reels/`, limit, 'reel').catch(() => [] as string[]);
      const combinedLinks = Array.from(new Set([...postLinks, ...reelLinks])).slice(0, limit);
      const mediaItems: InstagramMediaItem[] = [];

      if (!combinedLinks.length) {
        warnings.push('No post or reel links were visible from the current Instagram session.');
      }

      for (const mediaUrl of combinedLinks) {
        try {
          mediaItems.push(await this.scrapeMediaPageWithPage(page, mediaUrl));
        } catch (error) {
          warnings.push(`Failed to scrape ${mediaUrl}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }

      return { profileMeta, mediaItems, warnings, usedSession };
    });
    this.profileMediaCache.set(cacheKey, result);
    return result;
  }

  private async collectLinksFromGrid(page: Page, url: string, limit: number, mode: 'post' | 'reel') {
    const loaded = await this.safeGoto(page, url, 'domcontentloaded');
    if (!loaded) {
      return [];
    }
    await page.waitForTimeout(1800);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await page.locator('button').filter({ hasText: /not now|allow all cookies|only allow essential cookies/i }).first().click({ timeout: 1500 }).catch(() => undefined);
    const links = new Set<string>();
    let stagnantPasses = 0;

    while (links.size < limit && stagnantPasses < 3) {
      const before = links.size;
      const batch = await page.$$eval('a[href*="/p/"], a[href*="/reel/"]', (anchors) =>
        anchors.map((anchor) => (anchor as HTMLAnchorElement).href).filter(Boolean),
      ).catch(() => [] as string[]);
      batch
        .filter((href) => (mode === 'reel' ? href.includes('/reel/') : href.includes('/p/') || href.includes('/reel/')))
        .forEach((href) => links.add(href));

      if (links.size < limit) {
        const html = await page.content().catch(() => '');
        this.extractLinksFromHtml(html, mode).forEach((href) => links.add(href));
      }

      stagnantPasses = links.size === before ? stagnantPasses + 1 : 0;
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.6)).catch(() => undefined);
      await page.mouse.wheel(0, 3500).catch(() => undefined);
      await page.waitForTimeout(900);
    }

    return Array.from(links).slice(0, limit);
  }

  private async scrapeMediaPage(url: string, useSession: boolean): Promise<InstagramMediaItem> {
    return this.withPage(useSession, async (page) => {
      return this.scrapeMediaPageWithPage(page, url);
    });
  }

  private async scrapeMediaPageWithPage(page: Page, url: string): Promise<InstagramMediaItem> {
    const loaded = await this.safeGoto(page, url, 'domcontentloaded');
    if (!loaded) {
      throw new Error('Timed out while loading media page');
    }
    await page.waitForTimeout(1200);
    const html = await page.content();
    const meta = await page.evaluate(() => ({
      ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      title: document.title,
    }));

    const shortcode = this.extractShortcode(url);
    const segment = this.extractMediaSegment(html, shortcode);
    const caption = this.decodeInstagramString(this.matchValue(segment, /"caption":\{"text":"((?:\\.|[^"])*)"/));
    const likes = this.parseNullableInt(this.matchValue(segment, /"like_count":(\d+|null)/));
    const comments = this.parseNullableInt(this.matchValue(segment, /"comment_count":(\d+|null)/));
    const views = this.parseNullableInt(this.matchValue(segment, /"view_count":(\d+|null)/));
    const fallbackCounts = this.parseEngagementFromDescription(meta.description);
    const timestampSeconds = this.parseNullableInt(this.matchValue(segment, /"taken_at":(\d+|null)/));
    const mediaType = this.detectMediaType(url, segment);
    const durationSec = this.parseNullableFloat(this.matchValue(segment, /"video_duration":([0-9.]+|null)/));
    const ownerHandle = this.matchValue(segment, /"username":"([A-Za-z0-9._]+)"/) ?? '';
    const taggedUsers = Array.from(new Set(Array.from(segment.matchAll(/"username":"([A-Za-z0-9._]+)"/g)).map((match) => match[1]).filter((username) => username.toLowerCase() !== ownerHandle.toLowerCase()))).slice(0, 8);
    const hashtags = Array.from(new Set((caption.match(/#[A-Za-z0-9_]+/g) ?? []).map((tag) => tag.slice(1))));
    const mentions = Array.from(new Set((caption.match(/@[A-Za-z0-9._]+/g) ?? []).map((tag) => tag.slice(1))));

    return {
      id: this.matchValue(segment, /"id":"?(\d+_[\d]+|\d+)"?/) ?? shortcode ?? url,
      shortcode,
      mediaType,
      caption,
      thumbnailUrl: meta.ogImage || null,
      displayAlt: meta.title || null,
      likes: likes ?? fallbackCounts.likes,
      comments: comments ?? fallbackCounts.comments,
      views: views ?? fallbackCounts.views ?? likes ?? fallbackCounts.likes,
      durationSec,
      timestamp: timestampSeconds ? new Date(timestampSeconds * 1000).toISOString() : null,
      hashtags,
      mentions,
      taggedUsers,
      url,
    };
  }

  private extractMediaSegment(html: string, shortcode: string | null) {
    if (!shortcode) return html;
    const codeIndex = html.indexOf(`"code":"${shortcode}"`);
    if (codeIndex === -1) return html;
    return html.slice(codeIndex, codeIndex + 18000);
  }

  private detectMediaType(url: string, segment: string): 'reel' | 'post' | 'carousel' {
    if (url.includes('/reel/') || /"product_type":"clips"|"media_type":2/.test(segment)) return 'reel';
    if (/"media_type":8|"carousel_media"/.test(segment)) return 'carousel';
    return 'post';
  }

  private extractShortcode(url: string) {
    const match = url.match(/instagram\.com\/(?:p|reel)\/([^/?#]+)/i);
    return match?.[1] ?? null;
  }

  private extractLinksFromHtml(html: string, mode: 'post' | 'reel') {
    const matches = Array.from(
      html.matchAll(/((?:https?:\\u002F\\u002F|https?:\/\/)www\.instagram\.com(?:\\u002F|\/)(?:p|reel)(?:\\u002F|\/)[^"'\\<\s]+)/gi),
    );
    const links = new Set<string>();
    for (const match of matches) {
      const raw = (match[1] ?? '').replace(/\\u002F/g, '/').replace(/\\\//g, '/');
      if (!raw) continue;
      const link = raw.endsWith('/') ? raw : `${raw}/`;
      if (mode === 'reel' && !link.includes('/reel/')) continue;
      links.add(link);
    }
    return Array.from(links);
  }

  private matchValue(text: string, pattern: RegExp) {
    return text.match(pattern)?.[1] ?? null;
  }

  private decodeInstagramString(input: string | null) {
    if (!input) return '';
    return input
      .replace(/\\u0025/g, '%')
      .replace(/\\u0026/g, '&')
      .replace(/\\u003C/g, '<')
      .replace(/\\u003E/g, '>')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\//g, '/')
      .replace(/\\u[0-9a-fA-F]{4}/g, (match) => String.fromCharCode(parseInt(match.slice(2), 16)));
  }

  private parseCompactNumber(value?: string | null) {
    if (!value) return null;
    const normalized = value.replace(/,/g, '').trim().toUpperCase();
    const multiplier = normalized.endsWith('M') ? 1_000_000 : normalized.endsWith('K') ? 1_000 : 1;
    const numeric = Number.parseFloat(normalized.replace(/[MK]/g, ''));
    return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : null;
  }

  private parseNullableInt(value: string | null) {
    if (!value || value === 'null') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseNullableFloat(value: string | null) {
    if (!value || value === 'null') return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseEngagementFromDescription(description: string) {
    const likes = this.parseCountFragment(description.match(/([\d.,MK]+)\s+Likes?/i)?.[1] ?? null);
    const comments = this.parseCountFragment(description.match(/([\d.,MK]+)\s+Comments?/i)?.[1] ?? null);
    const views = this.parseCountFragment(description.match(/([\d.,MK]+)\s+Views?/i)?.[1] ?? null);
    return { likes, comments, views };
  }

  private parseCountFragment(value: string | null) {
    if (!value) return null;
    return this.parseCompactNumber(value);
  }

  private cleanText(value: string) {
    return value ? value.replace(/\\n/g, '\n').trim() : null;
  }

  private async safeGoto(page: Page, url: string, waitUntil: 'domcontentloaded' | 'networkidle') {
    try {
      await page.goto(url, { waitUntil, timeout: 25000 });
      return true;
    } catch {
      return false;
    }
  }

  private async withPage<T>(preferSession: boolean, run: (page: Page, usedSession: boolean) => Promise<T>): Promise<T> {
    const browser = await chromium.launch({ headless: true });
    let context: BrowserContext | null = null;
    try {
      const useSession = preferSession && this.hasSavedSession();
      context = await browser.newContext(useSession ? { storageState: this.storageStatePath } : {});
      const page = await context.newPage();
      return await run(page, useSession);
    } finally {
      await context?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

}
