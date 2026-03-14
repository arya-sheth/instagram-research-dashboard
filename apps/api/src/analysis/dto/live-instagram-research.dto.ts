import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class LiveInstagramResearchDto {
  @IsString()
  companyName!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9._]+$/)
  instagramHandle!: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  competitorLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(500)
  recentPostLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  forceRefresh?: number;
}
