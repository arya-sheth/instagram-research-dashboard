export type MediaType = 'reel' | 'carousel' | 'image';

export interface InstagramPost {
  id: string;
  postedAt: string;
  mediaType: MediaType;
  contentType: string;
  hookType: string;
  captionType: string;
  durationSec?: number;
  views: number;
  likes: number;
  comments: number;
  thumbnailLabel: string;
  captionPreview: string;
}

export interface InstagramProfile {
  id: string;
  brandName: string;
  handle: string;
  profileUrl: string;
  category: string;
  businessModel: string;
  targetAudience: string;
  bio: string;
  about: string;
  keywords: string[];
  contentPillars: string[];
  hookPatterns: string[];
  captionStyles: string[];
  thumbnailStyles: string[];
  followerCount: number;
  followingCount: number;
  postCount: number;
  verified: boolean;
  posts: InstagramPost[];
  updatedAt: string;
}
