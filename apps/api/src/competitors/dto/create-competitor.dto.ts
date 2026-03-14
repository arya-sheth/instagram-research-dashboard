import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

class InstagramPostDto {
  @IsString()
  id!: string;

  @IsString()
  postedAt!: string;

  @IsString()
  mediaType!: 'reel' | 'carousel' | 'image';

  @IsString()
  contentType!: string;

  @IsString()
  hookType!: string;

  @IsString()
  captionType!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  durationSec?: number;

  @IsInt()
  @Min(0)
  views!: number;

  @IsInt()
  @Min(0)
  likes!: number;

  @IsInt()
  @Min(0)
  comments!: number;

  @IsString()
  thumbnailLabel!: string;

  @IsString()
  captionPreview!: string;
}

export class CreateCompetitorDto {
  @IsString()
  brandName!: string;

  @IsString()
  handle!: string;

  @IsUrl()
  profileUrl!: string;

  @IsString()
  category!: string;

  @IsString()
  businessModel!: string;

  @IsString()
  targetAudience!: string;

  @IsString()
  bio!: string;

  @IsString()
  about!: string;

  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  @IsArray()
  @IsString({ each: true })
  contentPillars!: string[];

  @IsArray()
  @IsString({ each: true })
  hookPatterns!: string[];

  @IsArray()
  @IsString({ each: true })
  captionStyles!: string[];

  @IsArray()
  @IsString({ each: true })
  thumbnailStyles!: string[];

  @IsInt()
  @Min(0)
  followerCount!: number;

  @IsInt()
  @Min(0)
  followingCount!: number;

  @IsInt()
  @Min(0)
  postCount!: number;

  @IsBoolean()
  verified!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstagramPostDto)
  posts!: InstagramPostDto[];
}
